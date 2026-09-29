import prisma from "../utils/prisma.js";
import {
  badRequest,
  COMMUNITY_LIMIT_DEFAULT,
  COMMUNITY_LIMIT_MAX,
  COMMUNITY_MESSAGE_MAX_LENGTH,
  isValidCommunityLimit,
  isValidCommunityMessage,
} from "../utils/validators.js";
import { createRateLimiter } from "../utils/rateLimit.js";
import { COMMUNITY_AUDIENCE_DEFAULT, ROLES } from "../config.js";

// Express 4 does not catch rejected promises from async handlers. Route the
// rejection to the existing errorHandler instead of terminating the process.
// Handler signature is (req, res, next, db = prisma): Express passes `next` in
// the third slot; tests inject a fake db in that same third slot. A non-function
// third argument is therefore treated as the injected db. (Same as reviews.js.)
const wrap = (fn) => (req, res, next, db = prisma) => {
  if (typeof next !== "function") [db, next] = [next, undefined];
  return Promise.resolve(fn(req, res, next, db)).catch(next);
};

// Community posting is rate-limited per customer (not global), separate from
// the existing admin↔customer messaging and the recovery-flow limiters.
// Exported so the test suite can reset it between cases (_reset is for tests).
export const communityPostLimiter = createRateLimiter({ windowMs: 60000, limit: 10 });

const BLOCKED_ERROR = "You are blocked from posting to the community";
const TOO_MANY_ERROR = "Too many requests. Please try again later.";

const messageInclude = { customer: { select: { id: true, name: true } } };

// Safe community shape: only id, content, createdAt and the author's public
// id/name. Never email/phone/address/status/lastActiveAt/credentials.
const messageShape = (m) => ({
  id: m.id,
  content: m.content,
  createdAt: m.createdAt,
  customer: { id: m.customer?.id ?? null, name: m.customer?.name ?? null },
});

// Moderation shape for /admin/community/users responses. Never exposes the
// rest of the User row.
const userModerationShape = (u) => ({
  id: u.id,
  name: u.name,
  communityBlockedAt: u.communityBlockedAt ?? null,
});

// Opaque cursor: base64url(JSON {t: epochMillis, i: id}). Malformed/unknown
// shapes decode to null so the caller can reject with HTTP 400.
function encodeCursor(createdAt, id) {
  return Buffer.from(JSON.stringify({ t: createdAt.getTime(), i: id }), "utf8").toString("base64url");
}

function decodeCursor(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const t = Number(parsed.t);
  const i = parsed.i;
  if (!Number.isFinite(t) || typeof i !== "string" || i.length === 0) return null;
  return { t, i };
}

function parseLimit(req) {
  const raw = req.query?.limit;
  if (raw === undefined || raw === null || raw === "") return COMMUNITY_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!isValidCommunityLimit(n)) return null;
  return n;
}

// Shared feed logic for the customer and admin GET endpoints. Newest first
// with createdAt DESC then id DESC (tie-break for identical timestamps). Uses
// take = limit + 1 to learn whether a next page exists.
//
// PHASE 2B-5 — THE AUDIENCE IS A CALLER-SUPPLIED LITERAL.
//
// `options.audience` is spread straight into the Prisma `where`, and it is the
// ONLY thing that decides which community is read. It is never read from
// req.query, req.body, req.params or anything else the client controls. That is
// the whole reason this function takes it as a parameter with no default: a
// query string like `?audience=employee` cannot widen a customer read, because
// nothing in this function ever looks at a request-supplied audience.
//
// `options.shape` maps a row to the response. The customer feed keeps its
// existing `customer: { id, name }` key so the customer UI is untouched; the
// employee feed maps the same author to `author: { id, name }`.
//
// `options.hideDeleted` adds `deletedAt: null`. It is deliberately NOT set for
// the customer feed: nothing in the codebase can soft-delete a customer-audience
// row (the admin soft-delete endpoint is pinned to the employee audience), so
// filtering it would change a query whose results cannot change.
export async function readCommunityFeed(req, res, db, options) {
  const { audience, shape, hideDeleted = false } = options || {};
  const limit = parseLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${COMMUNITY_LIMIT_MAX}`);
  }

  const before = req.query?.before;
  const where = { audience };
  if (hideDeleted) where.deletedAt = null;
  if (before !== undefined && before !== null && before !== "") {
    const cursor = decodeCursor(before);
    if (!cursor) return badRequest(res, "before must be a valid cursor");
    const t = new Date(cursor.t);
    where.OR = [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: cursor.i } }];
  }

  const rows = await db.communityMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: messageInclude,
  });

  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit);
  const last = messages[messages.length - 1];
  const nextBefore = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  res.json({ messages: messages.map(shape), hasMore, nextBefore });
}

// The customer community's feed configuration. Defined once here so BOTH
// customer-facing reads — the customer's own feed and the admin moderation feed
// — are pinned to the identical audience predicate and can never drift apart.
const CUSTOMER_FEED = { audience: COMMUNITY_AUDIENCE_DEFAULT, shape: messageShape };

// ---- Customer side ----

// GET /api/community/messages (registered in CP3 behind authenticate +
// requireCustomer). Any authenticated customer, blocked or not, may read.
export const listCommunityMessages = wrap(async function listCommunityMessages(req, res, next, db = prisma) {
  return readCommunityFeed(req, res, db, CUSTOMER_FEED);
});

// POST /api/community/messages (registered in CP3 behind authenticate +
// requireCustomer). customerId always comes from req.user.id; a customerId in
// the body is never trusted. Blocked customers are rejected with 403.
export const createCommunityMessage = wrap(async function createCommunityMessage(req, res, next, db = prisma) {
  // Defense in depth: requireCustomer normally keeps admins out, but never
  // let an admin create a CommunityMessage even if middleware order changes.
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can post to the community" });
  }

  const { content } = req.body || {};
  if (typeof content !== "string" || !content.trim()) {
    return badRequest(res, "content is required");
  }
  if (!isValidCommunityMessage(content)) {
    return badRequest(res, `content must be ${COMMUNITY_MESSAGE_MAX_LENGTH} characters or fewer`);
  }

  if (req.user.communityBlockedAt) {
    return res.status(403).json({ error: BLOCKED_ERROR });
  }

  // Per-customer budget, not global. Unsuccessful attempts are not recorded.
  const key = `community:${req.user.id}`;
  if (!communityPostLimiter.allow(key)) {
    return res.status(429).json({ error: TOO_MANY_ERROR });
  }
  communityPostLimiter.record(key);

  const created = await db.communityMessage.create({
    // audience is named explicitly rather than left to the column default, so
    // the customer community can never be written by omitting it. This is the
    // same intent Broadcast.audience records, for the same reason.
    data: {
      customerId: req.user.id,
      content: content.trim(),
      audience: COMMUNITY_AUDIENCE_DEFAULT,
    },
  });

  res.status(201).json({
    message: {
      id: created.id,
      content: created.content,
      createdAt: created.createdAt,
      customer: { id: req.user.id, name: req.user.name ?? null },
    },
  });
});

// ---- Admin side ----

// GET /api/admin/community/messages (registered in CP3 behind authenticate +
// requireAdmin). Same safe shape, same pagination and the same audience pin as
// the customer feed — an admin moderating the community sees the CUSTOMER
// community, never the employee one. The employee moderation feed is a separate
// endpoint (controllers/employeeCommunity.js) with its own audience literal.
export const adminListCommunityMessages = wrap(async function adminListCommunityMessages(req, res, next, db = prisma) {
  return readCommunityFeed(req, res, db, CUSTOMER_FEED);
});

// Shared moderation write: finds the target user, refuses admins, then sets
// communityBlockedAt to `blockedAt` (a timestamp or null). Idempotent by
// design — re-blocking overwrites the timestamp, re-unblocking stays null.
async function setCommunityBlockedAt(req, res, db, blockedAt) {
  const { id } = req.params;
  if (typeof id !== "string" || !id) return res.status(400).json({ error: "User id is required" });

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role === ROLES.ADMIN) {
    return res.status(400).json({ error: "Community moderation applies to customers only" });
  }

  const updated = await db.user.update({ where: { id }, data: { communityBlockedAt: blockedAt } });
  res.json({ ok: true, user: userModerationShape(updated) });
}

export const adminBlockUser = wrap(async function adminBlockUser(req, res, next, db = prisma) {
  return setCommunityBlockedAt(req, res, db, new Date());
});

export const adminUnblockUser = wrap(async function adminUnblockUser(req, res, next, db = prisma) {
  return setCommunityBlockedAt(req, res, db, null);
});

// GET /api/admin/community/users (registered in CP3). Persistent blocked
// status for the admin moderation UI. Customers only, never the full User row.
export const adminListCommunityUsers = wrap(async function adminListCommunityUsers(req, res, next, db = prisma) {
  const users = await db.user.findMany({
    where: { role: ROLES.CUSTOMER },
    select: { id: true, name: true, communityBlockedAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  res.json({ users: users.map(userModerationShape) });
});