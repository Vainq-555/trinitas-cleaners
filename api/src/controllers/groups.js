import prisma from "../utils/prisma.js";
import { badRequest } from "../utils/validators.js";
import { createRateLimiter } from "../utils/rateLimit.js";
import { ROLES, ONLINE_TTL_MS } from "../config.js";

// Express 4 does not catch rejected promises from async handlers. Route the
// rejection to the existing errorHandler instead of terminating the process.
// Handler signature is (req, res, next, db = prisma): Express passes `next` in
// the third slot; tests inject a fake db in that same third slot. A non-function
// third argument is therefore treated as the injected db. (Same as community.js.)
const wrap = (fn) => (req, res, next, db = prisma) => {
  if (typeof next !== "function") [db, next] = [next, undefined];
  return Promise.resolve(fn(req, res, next, db)).catch(next);
};

// G1b supports public groups only. private/invite_only are validated app-side
// (see the audit roadmap); the DB column stays a free string.
export const GROUP_TYPE_PUBLIC = "public";
export const GROUP_NAME_MAX = 100;
export const GROUP_DESC_MAX = 500;
export const GROUP_LIMIT_DEFAULT = 50;
export const GROUP_LIMIT_MAX = 100;
export const GROUP_MESSAGE_MAX = 1000;

const BLOCKED_ERROR = "You are blocked from community groups";
const TOO_MANY_ERROR = "Too many requests. Please try again later.";
const NOT_FOUND_ERROR = "Group not found";
const OWNER_LEAVE_ERROR =
  "Owners cannot leave a group. Transfer ownership or dissolve the group first.";
const REMOVE_SELF_ERROR =
  "Owners cannot remove themselves. Transfer ownership or dissolve the group first.";
const ADMIN_REMOVE_OWNER_ERROR =
  "Group owners cannot be removed. Dissolve the group instead.";

// Create budget: 3 groups per customer per 60 minutes. Membership budget: 30
// join/leave operations per customer per 10 minutes. Group messages have two
// independent budgets: 10 messages per group per 60 seconds (flood protection)
// and 30 messages per customer per 60 seconds (global send budget). All are
// keyed by namespace, mirroring the community post limiter. Exported so the
// test suite can reset them between cases (_reset is for tests).
export const groupCreateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 3 });
export const groupMembershipLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 30 });
export const groupMessagePerGroupLimiter = createRateLimiter({ windowMs: 60 * 1000, limit: 10 });
export const groupMessagePerCustomerLimiter = createRateLimiter({ windowMs: 60 * 1000, limit: 30 });

// Admin write budget: 60 moderation actions per admin per 10 minutes, shared
// across remove-member / delete-message / dissolve. Keyed by admin id (each
// admin gets their own budget). Exported so tests can reset it (_reset).
export const adminGroupActionLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 60 });

// Opaque cursor: base64url(JSON {t: epochMillis, i: id}). Malformed/unknown
// shapes decode to null so the caller can reject with HTTP 400. Same shape and
// ordering contract as the Community V1 feed (createdAt DESC, id DESC).
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

function parseGroupLimit(req) {
  const raw = req.query?.limit;
  if (raw === undefined || raw === null || raw === "") return GROUP_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > GROUP_LIMIT_MAX) return null;
  return n;
}

// Caller identity always comes from req.user (set by authenticate). Body/query
// user ids are never trusted for authorization; groupId always from req.params.

// Safe shapes. Never a raw Prisma Group/User row: no ownerId, no dissolvedAt,
// no email/phone/address/status/lastActiveAt/communityBlockedAt and no owner
// beyond the public identity reused by the Community feed (id + name).
const ownerShape = (o) => ({ id: o?.id ?? null, name: o?.name ?? null });

const groupShape = (g, memberCount, joined) => ({
  id: g.id,
  name: g.name,
  description: g.description ?? null,
  type: g.type,
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
  memberCount,
  joined,
});

const groupDetailShape = (g, memberCount, joined) => ({
  ...groupShape(g, memberCount, joined),
  owner: ownerShape(g.owner),
});

// Coarse online/offline from the existing auth heartbeat. Never exposes the
// raw lastActiveAt timestamp. Mirrors profiles.js: `online` is included ONLY
// when the user opted in via their CommunityProfile.showOnline.
const isOnline = (user) =>
  Boolean(user?.lastActiveAt) && Date.now() - user.lastActiveAt.getTime() < ONLINE_TTL_MS;

// Public member identity. The CommunityProfile displayName/avatarUrl are used
// when a profile exists, falling back to the username and no avatar. The online
// presence key is omitted (not false) when the member opted out, mirroring
// profiles.js publicShape. Members always have id + name — never email/phone/
// address/role/status/lastActiveAt/communityBlockedAt.
const publicName = (u) => u?.communityProfile?.displayName ?? u?.name ?? null;
const publicAvatar = (u) => u?.communityProfile?.avatarUrl ?? null;

const senderShape = (s) => ({
  id: s?.id ?? null,
  name: publicName(s),
  avatarUrl: publicAvatar(s),
  ...(s?.communityProfile?.showOnline ? { online: isOnline(s) } : {}),
});

const memberShape = (m) => ({
  userId: m.userId,
  joinedAt: m.joinedAt,
  user: senderShape(m.user),
});

// Group message shape. A soft-deleted message keeps its id/createdAt/sender but
// its content is hidden (null). deletedById is reserved for admin moderation and
// is never exposed to customers (customer self-delete leaves it null).
const messageShape = (gm) => ({
  id: gm.id,
  content: gm.deletedAt ? null : gm.content,
  createdAt: gm.createdAt,
  deleted: Boolean(gm.deletedAt),
  sender: senderShape(gm.sender),
});

// Admin group shape: the public group identity plus the moderation state an
// admin needs (dissolvedAt/status) and the owner's public identity. Never a raw
// Group row and never owner/member account fields.
const adminGroupShape = (g, memberCount) => ({
  id: g.id,
  name: g.name,
  description: g.description ?? null,
  type: g.type,
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
  dissolvedAt: g.dissolvedAt ?? null,
  status: g.dissolvedAt ? "dissolved" : "active",
  memberCount,
  owner: ownerShape(g.owner),
});

// Admin message shape: the customer-safe message shape plus moderation
// attribution (who soft-deleted it, when). deletedById/deletedAt are only ever
// returned on admin endpoints; the customer message shape never includes them.
const adminMessageShape = (gm) => ({
  ...messageShape(gm),
  deletedById: gm.deletedById ?? null,
  deletedAt: gm.deletedAt ?? null,
});

// Fields the PATCH /update endpoint refuses to touch. id/createdAt/updatedAt
// are system-managed; ownerId/type/dissolvedAt are immutable without dedicated
// endpoints (transfer/dissolve), and private/invite_only types are a later
// roadmap item, so `type` can never be set through update yet.
const IMMUTABLE_GROUP_FIELDS = ["id", "ownerId", "type", "dissolvedAt", "createdAt", "updatedAt"];

// Sender/profile include clauses use the same safe projection everywhere. The
// Controller uses only senderShape on the results, so no sensitive field can
// leak even though lastActiveAt/communityProfile are needed for presence.
const senderInclude = {
  sender: {
    select: {
      id: true,
      name: true,
      lastActiveAt: true,
      communityProfile: { select: { displayName: true, avatarUrl: true, showOnline: true } },
    },
  },
};

const memberInclude = {
  user: {
    select: {
      id: true,
      name: true,
      lastActiveAt: true,
      communityProfile: { select: { displayName: true, avatarUrl: true, showOnline: true } },
    },
  },
};

function groupParam(req, res) {
  const { groupId } = req.params;
  if (typeof groupId !== "string" || !groupId) {
    badRequest(res, "groupId is required");
    return null;
  }
  return groupId;
}

// Active group = public AND not dissolved. Dissolved and non-public groups are
// uniformly 404 for every customer endpoint, exactly like G1b.
function fetchActiveGroup(db, groupId) {
  return db.group.findFirst({ where: { id: groupId, type: GROUP_TYPE_PUBLIC, dissolvedAt: null } });
}

async function isActiveMember(db, groupId, userId) {
  const rows = await db.groupMember.findMany({ where: { groupId, userId } });
  return rows.length > 0;
}

// Non-members get the SAME 404 as a missing group. This keeps every group-scoped
// resource from answering whether a group exists or who belongs to it.
async function requireActiveMember(req, res, db, groupId) {
  if (await isActiveMember(db, groupId, req.user.id)) return null;
  res.status(404).json({ error: NOT_FOUND_ERROR });
  return NOT_FOUND_ERROR;
}

// ---- Customer side ----

// GET /api/community/groups — discovery of public, non-dissolved groups only.
// Cursor pagination (createdAt DESC, id DESC) with the same take = limit + 1
// window as the Community feed. memberCount and joined are derived server-side
// from real membership rows keyed by req.user.id — never from the query string.
export const listGroups = wrap(async function listGroups(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can view groups" });
  }

  const limit = parseGroupLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${GROUP_LIMIT_MAX}`);
  }

  const before = req.query?.before;
  const where = { type: GROUP_TYPE_PUBLIC, dissolvedAt: null };
  if (before !== undefined && before !== null && before !== "") {
    const cursor = decodeCursor(before);
    if (!cursor) return badRequest(res, "before must be a valid cursor");
    const t = new Date(cursor.t);
    where.OR = [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: cursor.i } }];
  }

  const rows = await db.group.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const groups = rows.slice(0, limit);

  let joinedIds = new Set();
  let memberCounts = new Map();
  if (groups.length) {
    const ids = groups.map((g) => g.id);
    const [allMemberships, myMemberships] = await Promise.all([
      db.groupMember.findMany({ where: { groupId: { in: ids } } }),
      db.groupMember.findMany({ where: { userId: req.user.id, groupId: { in: ids } } }),
    ]);
    for (const m of allMemberships) memberCounts.set(m.groupId, (memberCounts.get(m.groupId) ?? 0) + 1);
    for (const m of myMemberships) joinedIds.add(m.groupId);
  }

  const items = groups.map((g) => groupShape(g, memberCounts.get(g.id) ?? 0, joinedIds.has(g.id)));
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  res.json({ items, hasMore, nextCursor });
});

// POST /api/community/groups — create a public group. The owner is always
// req.user.id; a body ownerId is ignored. Group + the owner's GroupMember are
// created atomically so the creator is always the first member.
export const createGroup = wrap(async function createGroup(req, res, next, db = prisma) {
  // Defense in depth: requireCustomer normally keeps admins out.
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can create groups" });
  }

  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest(res, "Request body must be a JSON object");
  }

  const { name, description, type } = body;

  if (typeof name !== "string" || !name.trim()) return badRequest(res, "name is required");
  const groupName = name.trim();
  if (groupName.length > GROUP_NAME_MAX) {
    return badRequest(res, `name must be ${GROUP_NAME_MAX} characters or fewer`);
  }

  let groupDescription = null;
  if (description !== undefined && description !== null && description !== "") {
    if (typeof description !== "string") return badRequest(res, "description must be a string");
    groupDescription = description.trim() || null;
    if (groupDescription && groupDescription.length > GROUP_DESC_MAX) {
      return badRequest(res, `description must be ${GROUP_DESC_MAX} characters or fewer`);
    }
  }

  if (type !== GROUP_TYPE_PUBLIC) return badRequest(res, 'type must be "public"');

  if (req.user.communityBlockedAt) {
    return res.status(403).json({ error: BLOCKED_ERROR });
  }

  // Unsuccessful validation/auth/blocked requests never reach the limiter.
  const key = `group:create:${req.user.id}`;
  if (!groupCreateLimiter.allow(key)) return res.status(429).json({ error: TOO_MANY_ERROR });
  groupCreateLimiter.record(key);

  const group = await db.$transaction(async (tx) => {
    const g = await tx.group.create({
      data: { ownerId: req.user.id, name: groupName, description: groupDescription, type: GROUP_TYPE_PUBLIC },
    });
    await tx.groupMember.create({ data: { groupId: g.id, userId: req.user.id } });
    return g;
  });

  res.status(201).json({
    group: {
      ...groupShape(group, 1, true),
      owner: { id: req.user.id, name: req.user.name ?? null },
    },
  });
});

// GET /api/community/groups/:groupId — safe group detail. Nonexistent,
// dissolved and non-public groups all behave as a uniform 404.
export const getGroup = wrap(async function getGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can view groups" });
  }

  const { groupId } = req.params;
  if (typeof groupId !== "string" || !groupId) return badRequest(res, "groupId is required");

  const group = await db.group.findFirst({
    where: { id: groupId, type: GROUP_TYPE_PUBLIC, dissolvedAt: null },
    include: { owner: { select: { id: true, name: true } } },
  });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const [members, myMemberships] = await Promise.all([
    db.groupMember.findMany({ where: { groupId } }),
    db.groupMember.findMany({ where: { userId: req.user.id, groupId } }),
  ]);

  res.json({ group: groupDetailShape(group, members.length, myMemberships.length > 0) });
});

// POST /api/community/groups/:groupId/join — idempotent. The composite primary
// key (groupId, userId) is the final duplicate guard; P2002 on create means we
// were already a member and is treated as success. Blocked customers are
// rejected before any membership work.
export const joinGroup = wrap(async function joinGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can join groups" });
  }

  const { groupId } = req.params;
  if (typeof groupId !== "string" || !groupId) return badRequest(res, "groupId is required");

  if (req.user.communityBlockedAt) {
    return res.status(403).json({ error: BLOCKED_ERROR });
  }

  const group = await db.group.findFirst({ where: { id: groupId, type: GROUP_TYPE_PUBLIC, dissolvedAt: null } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const key = `group:membership:${req.user.id}`;
  if (!groupMembershipLimiter.allow(key)) return res.status(429).json({ error: TOO_MANY_ERROR });

  try {
    await db.groupMember.create({ data: { groupId, userId: req.user.id } });
  } catch (error) {
    if (error.code !== "P2002") throw error;
  }

  groupMembershipLimiter.record(key);
  res.json({ ok: true, groupId, joined: true });
});

// POST /api/community/groups/:groupId/leave — idempotent. The owner cannot
// leave (transfer/dissolve are G1b+ and unimplemented). Blocked customers CAN
// leave groups they belong to. P2025 on delete means we were not a member and
// is treated as success.
export const leaveGroup = wrap(async function leaveGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can leave groups" });
  }

  const { groupId } = req.params;
  if (typeof groupId !== "string" || !groupId) return badRequest(res, "groupId is required");

  const group = await db.group.findFirst({ where: { id: groupId, type: GROUP_TYPE_PUBLIC, dissolvedAt: null } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.ownerId === req.user.id) {
    return res.status(400).json({ error: OWNER_LEAVE_ERROR });
  }

  const key = `group:membership:${req.user.id}`;
  if (!groupMembershipLimiter.allow(key)) return res.status(429).json({ error: TOO_MANY_ERROR });

  try {
    await db.groupMember.delete({ where: { groupId_userId: { groupId, userId: req.user.id } } });
  } catch (error) {
    if (error.code !== "P2025") throw error;
  }

  groupMembershipLimiter.record(key);
  res.json({ ok: true, groupId, left: true });
});

// GET /api/community/groups/:groupId/members — roster for members only. Any
// active member (including the owner and blocked customers) may read. Non-
// members receive the same 404 as a missing group. Cursor pagination on
// (joinedAt DESC, userId DESC).
export const listGroupMembers = wrap(async function listGroupMembers(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can view group members" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const limit = parseGroupLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${GROUP_LIMIT_MAX}`);
  }

  const group = await fetchActiveGroup(db, groupId);
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (await requireActiveMember(req, res, db, groupId)) return;

  const where = { groupId };
  const before = req.query?.before;
  if (before !== undefined && before !== null && before !== "") {
    const cursor = decodeCursor(before);
    if (!cursor) return badRequest(res, "before must be a valid cursor");
    const d = new Date(cursor.t);
    where.OR = [{ joinedAt: { lt: d } }, { joinedAt: d, userId: { lt: cursor.i } }];
  }

  const rows = await db.groupMember.findMany({
    where,
    orderBy: [{ joinedAt: "desc" }, { userId: "desc" }],
    take: limit + 1,
    include: memberInclude,
  });

  const hasMore = rows.length > limit;
  const members = rows.slice(0, limit);
  const last = members[members.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.joinedAt, last.userId) : null;

  res.json({ members: members.map(memberShape), hasMore, nextCursor });
});

// GET /api/community/groups/:groupId/messages — group feed, members only.
// Non-members get a uniform 404. Blocked customers may still read (same rule as
// Community V1). Newest first with createdAt DESC, id DESC and the same opaque
// cursor window as the discovery feed. Soft-deleted messages appear with the
// content hidden.
export const listGroupMessages = wrap(async function listGroupMessages(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can view group messages" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const limit = parseGroupLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${GROUP_LIMIT_MAX}`);
  }

  const group = await fetchActiveGroup(db, groupId);
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (await requireActiveMember(req, res, db, groupId)) return;

  const where = { groupId };
  const before = req.query?.before;
  if (before !== undefined && before !== null && before !== "") {
    const cursor = decodeCursor(before);
    if (!cursor) return badRequest(res, "before must be a valid cursor");
    const d = new Date(cursor.t);
    where.OR = [{ createdAt: { lt: d } }, { createdAt: d, id: { lt: cursor.i } }];
  }

  const rows = await db.groupMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: senderInclude,
  });

  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit);
  const last = messages[messages.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  res.json({ messages: messages.map(messageShape), hasMore, nextCursor });
});

// POST /api/community/groups/:groupId/messages — send a group message. This is
// the ONE group action with a blocked check, and it runs AFTER the membership
// check: a blocked non-member sees 404, a blocked member sees 403. senderId
// always comes from req.user; a body senderId is never trusted. Both rate
// budgets must be available; each is recorded only on a successful create.
export const sendGroupMessage = wrap(async function sendGroupMessage(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can send group messages" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest(res, "Request body must be a JSON object");
  }

  const { content } = body;
  if (typeof content !== "string" || !content.trim()) return badRequest(res, "content is required");
  if (content.trim().length > GROUP_MESSAGE_MAX) {
    return badRequest(res, `content must be ${GROUP_MESSAGE_MAX} characters or fewer`);
  }

  const group = await fetchActiveGroup(db, groupId);
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (await requireActiveMember(req, res, db, groupId)) return;

  if (req.user.communityBlockedAt) {
    return res.status(403).json({ error: BLOCKED_ERROR });
  }

  const groupKey = `group:message:group:${groupId}`;
  const customerKey = `group:message:send:${req.user.id}`;
  if (
    !groupMessagePerGroupLimiter.allow(groupKey) ||
    !groupMessagePerCustomerLimiter.allow(customerKey)
  ) {
    return res.status(429).json({ error: TOO_MANY_ERROR });
  }

  const created = await db.groupMessage.create({
    data: { groupId, senderId: req.user.id, content: content.trim() },
    include: senderInclude,
  });

  groupMessagePerGroupLimiter.record(groupKey);
  groupMessagePerCustomerLimiter.record(customerKey);

  res.status(201).json({ message: messageShape(created) });
});

// DELETE /api/community/groups/:groupId/messages/:messageId — soft-delete by
// the sender only. The row is kept (content is hidden downstream), deletedAt is
// set and deletedById stays null (that column is reserved for admin
// moderation). Deleting twice is idempotent. A blocked sender may still delete
// their own message — same withdrawal-rights rule as leaveGroup. Members only;
// non-members get a uniform 404.
export const deleteGroupMessage = wrap(async function deleteGroupMessage(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can delete group messages" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const { messageId } = req.params;
  if (typeof messageId !== "string" || !messageId) return badRequest(res, "messageId is required");

  const group = await fetchActiveGroup(db, groupId);
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (await requireActiveMember(req, res, db, groupId)) return;

  const message = await db.groupMessage.findFirst({
    where: { id: messageId, groupId },
    include: senderInclude,
  });
  if (!message) return res.status(404).json({ error: "Message not found" });

  if (message.senderId !== req.user.id) {
    return res.status(403).json({ error: "Only the sender can delete this message" });
  }

  const updated = message.deletedAt
    ? message
    : await db.groupMessage.update({
        where: { id: messageId },
        data: { deletedAt: new Date() },
        include: senderInclude,
      });

  res.json({ ok: true, message: messageShape(updated) });
});

// PATCH /api/community/groups/:groupId — owner updates the group's public
// name/description. Only name and description are editable in G1c; every other
// key (id, ownerId, type, dissolvedAt, createdAt, updatedAt) is explicitly
// rejected with 400. A blocked owner may still manage the group.
export const updateGroup = wrap(async function updateGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can update groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest(res, "Request body must be a JSON object");
  }

  const forbidden = IMMUTABLE_GROUP_FIELDS.filter((f) =>
    Object.prototype.hasOwnProperty.call(body, f),
  );
  if (forbidden.length) {
    return badRequest(res, `The following fields cannot be changed: ${forbidden.join(", ")}`);
  }

  const group = await fetchActiveGroup(db, groupId);
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only the group owner can update this group" });
  }

  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
  if (!hasName && !hasDescription) {
    return badRequest(res, "At least one of name or description is required");
  }

  const data = {};
  if (hasName) {
    const { name } = body;
    if (typeof name !== "string" || !name.trim()) return badRequest(res, "name is required");
    const groupName = name.trim();
    if (groupName.length > GROUP_NAME_MAX) {
      return badRequest(res, `name must be ${GROUP_NAME_MAX} characters or fewer`);
    }
    data.name = groupName;
  }
  if (hasDescription) {
    const { description } = body;
    if (description === undefined || description === null || description === "") {
      data.description = null;
    } else {
      if (typeof description !== "string") return badRequest(res, "description must be a string");
      const clean = description.trim();
      if (clean && clean.length > GROUP_DESC_MAX) {
        return badRequest(res, `description must be ${GROUP_DESC_MAX} characters or fewer`);
      }
      data.description = clean || null;
    }
  }

  const updated = await db.group.update({
    where: { id: groupId },
    data,
    include: { owner: { select: { id: true, name: true } } },
  });

  const members = await db.groupMember.findMany({ where: { groupId } });

  // The owner is always a member, so joined is always true for the caller.
  res.json({ group: groupDetailShape(updated, members.length, true) });
});

// DELETE /api/community/groups/:groupId/members/:userId — owner removes a
// member. The owner cannot remove themselves (400; transfer or dissolve first).
// Idempotent: removing a non-member is a success, mirroring leaveGroup. A
// blocked owner may still manage the group.
export const removeGroupMember = wrap(async function removeGroupMember(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can manage group members" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const { userId } = req.params;
  if (typeof userId !== "string" || !userId.trim()) return badRequest(res, "userId is required");

  const group = await fetchActiveGroup(db, groupId);
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only the group owner can remove members" });
  }

  if (userId === group.ownerId) {
    return res.status(400).json({ error: REMOVE_SELF_ERROR });
  }

  try {
    await db.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
  } catch (error) {
    if (error.code !== "P2025") throw error;
  }

  res.json({ ok: true, groupId, memberId: userId, removed: true });
});

// POST /api/community/groups/:groupId/transfer — atomically move ownership.
// The target must be a customer who is an ACTIVE member and not blocked. The
// previous owner stays a member (no membership change). The target is taken
// from the body, never from any header/query. A blocked owner may still
// transfer.
export const transferGroupOwner = wrap(async function transferGroupOwner(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can transfer group ownership" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest(res, "Request body must be a JSON object");
  }

  const { userId } = body;
  if (typeof userId !== "string" || !userId.trim()) return badRequest(res, "userId is required");

  const group = await fetchActiveGroup(db, groupId);
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only the group owner can transfer ownership" });
  }

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role !== ROLES.CUSTOMER) {
    return res.status(400).json({ error: "Ownership can only be transferred to a customer" });
  }
  if (target.communityBlockedAt) {
    return res.status(400).json({ error: "The new owner cannot be blocked from community groups" });
  }

  const membership = await isActiveMember(db, groupId, target.id);
  if (!membership) {
    return res.status(400).json({ error: "The new owner must be a member of the group" });
  }

  const updated = await db.group.update({
    where: { id: groupId },
    data: { ownerId: target.id },
    include: { owner: { select: { id: true, name: true } } },
  });

  const members = await db.groupMember.findMany({ where: { groupId } });

  // The new owner is a member, so joined is true; owner identity comes from the
  // validated target row, proving who the group now belongs to.
  res.json({
    group: { ...groupShape(updated, members.length, true), owner: ownerShape(target) },
  });
});

// POST /api/community/groups/:groupId/dissolve — owner soft-publishes the end
// of a group. No rows are deleted; dissolvedAt makes the group disappear from
// every customer endpoint (404 thereafter), so a second dissolve is a 404. A
// blocked owner may still dissolve.
export const dissolveGroup = wrap(async function dissolveGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can dissolve groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await fetchActiveGroup(db, groupId);
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only the group owner can dissolve this group" });
  }

  await db.group.update({
    where: { id: groupId },
    data: { dissolvedAt: new Date() },
  });

  res.json({ ok: true, groupId, dissolved: true });
});

// ---- Admin side ----

// GET /api/admin/community/groups — admin discovery of public groups, active
// and dissolved. Unlike the customer feed, dissolved groups stay visible with
// status "dissolved" so admins can still moderate them. Same cursor window as
// the customer discovery feed.
export const adminListGroups = wrap(async function adminListGroups(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const limit = parseGroupLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${GROUP_LIMIT_MAX}`);
  }

  const before = req.query?.before;
  const where = { type: GROUP_TYPE_PUBLIC };
  if (before !== undefined && before !== null && before !== "") {
    const cursor = decodeCursor(before);
    if (!cursor) return badRequest(res, "before must be a valid cursor");
    const d = new Date(cursor.t);
    where.OR = [{ createdAt: { lt: d } }, { createdAt: d, id: { lt: cursor.i } }];
  }

  const rows = await db.group.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: { owner: { select: { id: true, name: true } } },
  });

  const hasMore = rows.length > limit;
  const groups = rows.slice(0, limit);

  let memberCounts = new Map();
  if (groups.length) {
    const ids = groups.map((g) => g.id);
    const allMemberships = await db.groupMember.findMany({ where: { groupId: { in: ids } } });
    for (const m of allMemberships) memberCounts.set(m.groupId, (memberCounts.get(m.groupId) ?? 0) + 1);
  }

  const items = groups.map((g) => adminGroupShape(g, memberCounts.get(g.id) ?? 0));
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  res.json({ items, hasMore, nextCursor });
});

// GET /api/admin/community/groups/:groupId — admin detail of any public group,
// including dissolved ones (customers see a 404 for dissolved groups).
export const adminGetGroup = wrap(async function adminGetGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await db.group.findFirst({
    where: { id: groupId, type: GROUP_TYPE_PUBLIC },
    include: { owner: { select: { id: true, name: true } } },
  });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const members = await db.groupMember.findMany({ where: { groupId } });

  res.json({ group: adminGroupShape(group, members.length) });
});

// GET /api/admin/community/groups/:groupId/members — admin roster for any
// public group (active or dissolved). Same safe member serialization as the
// customer roster.
export const adminListGroupMembers = wrap(async function adminListGroupMembers(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const limit = parseGroupLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${GROUP_LIMIT_MAX}`);
  }

  const group = await db.group.findFirst({ where: { id: groupId, type: GROUP_TYPE_PUBLIC } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const where = { groupId };
  const before = req.query?.before;
  if (before !== undefined && before !== null && before !== "") {
    const cursor = decodeCursor(before);
    if (!cursor) return badRequest(res, "before must be a valid cursor");
    const d = new Date(cursor.t);
    where.OR = [{ joinedAt: { lt: d } }, { joinedAt: d, userId: { lt: cursor.i } }];
  }

  const rows = await db.groupMember.findMany({
    where,
    orderBy: [{ joinedAt: "desc" }, { userId: "desc" }],
    take: limit + 1,
    include: memberInclude,
  });

  const hasMore = rows.length > limit;
  const members = rows.slice(0, limit);
  const last = members[members.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.joinedAt, last.userId) : null;

  res.json({ members: members.map(memberShape), hasMore, nextCursor });
});

// GET /api/admin/community/groups/:groupId/messages — admin feed for any public
// group (active or dissolved). The customer-safe message shape is extended with
// moderation attribution (deletedById/deletedAt) that only admins receive.
export const adminListGroupMessages = wrap(async function adminListGroupMessages(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const limit = parseGroupLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${GROUP_LIMIT_MAX}`);
  }

  const group = await db.group.findFirst({ where: { id: groupId, type: GROUP_TYPE_PUBLIC } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const where = { groupId };
  const before = req.query?.before;
  if (before !== undefined && before !== null && before !== "") {
    const cursor = decodeCursor(before);
    if (!cursor) return badRequest(res, "before must be a valid cursor");
    const d = new Date(cursor.t);
    where.OR = [{ createdAt: { lt: d } }, { createdAt: d, id: { lt: cursor.i } }];
  }

  const rows = await db.groupMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: senderInclude,
  });

  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit);
  const last = messages[messages.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  res.json({ messages: messages.map(adminMessageShape), hasMore, nextCursor });
});

// DELETE /api/admin/community/groups/:groupId/members/:userId — admin removes a
// member from a public group. Only the membership row is deleted (never any
// message). The owner cannot be removed this way (400): ownership only moves by
// transfer or ends by dissolve, both owner actions. Idempotent: removing a
// non-member is a success. Body/query userId is never trusted.
export const adminRemoveGroupMember = wrap(async function adminRemoveGroupMember(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const { userId } = req.params;
  if (typeof userId !== "string" || !userId.trim()) return badRequest(res, "userId is required");

  const group = await db.group.findFirst({ where: { id: groupId, type: GROUP_TYPE_PUBLIC } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (userId === group.ownerId) {
    return res.status(400).json({ error: ADMIN_REMOVE_OWNER_ERROR });
  }

  const key = `group:admin:${req.user.id}`;
  if (!adminGroupActionLimiter.allow(key)) return res.status(429).json({ error: TOO_MANY_ERROR });

  try {
    await db.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
  } catch (error) {
    if (error.code !== "P2025") throw error;
  }

  adminGroupActionLimiter.record(key);
  res.json({ ok: true, groupId, memberId: userId, removed: true });
});

// DELETE /api/admin/community/groups/:groupId/messages/:messageId — admin
// soft-deletes a group message. The row is kept and content is hidden, deletedAt
// is set and deletedById records which admin moderated it. Idempotent on a
// twice-deleted message; cross-group messageIds 404. Body messageId is never
// trusted.
export const adminDeleteGroupMessage = wrap(async function adminDeleteGroupMessage(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const { messageId } = req.params;
  if (typeof messageId !== "string" || !messageId) return badRequest(res, "messageId is required");

  const group = await db.group.findFirst({ where: { id: groupId, type: GROUP_TYPE_PUBLIC } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const message = await db.groupMessage.findFirst({
    where: { id: messageId, groupId },
    include: senderInclude,
  });
  if (!message) return res.status(404).json({ error: "Message not found" });

  const key = `group:admin:${req.user.id}`;
  if (!adminGroupActionLimiter.allow(key)) return res.status(429).json({ error: TOO_MANY_ERROR });

  const updated = message.deletedAt
    ? message
    : await db.groupMessage.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedById: req.user.id },
        include: senderInclude,
      });

  adminGroupActionLimiter.record(key);
  res.json({ ok: true, message: adminMessageShape(updated) });
});

// POST /api/admin/community/groups/:groupId/dissolve — admin ends a public
// group. Same soft dissolve as the owner path: only dissolvedAt is set, all
// rows are preserved and the group stays inspectable by admins. Idempotent — an
// already-dissolved group returns ok:true (unlike the customer 404, because
// admins can see dissolved groups). Nonexistent groups still 404.
export const adminDissolveGroup = wrap(async function adminDissolveGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await db.group.findFirst({ where: { id: groupId, type: GROUP_TYPE_PUBLIC } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const key = `group:admin:${req.user.id}`;
  if (!adminGroupActionLimiter.allow(key)) return res.status(429).json({ error: TOO_MANY_ERROR });

  if (!group.dissolvedAt) {
    await db.group.update({
      where: { id: groupId },
      data: { dissolvedAt: new Date() },
    });
  }

  adminGroupActionLimiter.record(key);
  res.json({ ok: true, groupId, dissolved: true });
});