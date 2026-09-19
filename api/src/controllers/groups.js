import { randomBytes } from "node:crypto";
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

// Group types are string-validated app-side against this closed set (the DB
// column stays a free string). public is the G1b default; private (hidden from
// discovery, join by code) and invite_only (visible with a code-gated join) are
// G1f. A group's type is chosen at creation and is immutable afterward.
export const GROUP_TYPE_PUBLIC = "public";
export const GROUP_TYPE_PRIVATE = "private";
export const GROUP_TYPE_INVITE_ONLY = "invite_only";
export const GROUP_TYPES = [GROUP_TYPE_PUBLIC, GROUP_TYPE_PRIVATE, GROUP_TYPE_INVITE_ONLY];
export const GROUP_NAME_MAX = 100;
export const GROUP_DESC_MAX = 500;
export const GROUP_LIMIT_DEFAULT = 50;
export const GROUP_LIMIT_MAX = 100;
export const GROUP_MESSAGE_MAX = 1000;

const BLOCKED_ERROR = "You are blocked from community groups";
const TOO_MANY_ERROR = "Too many requests. Please try again later.";
const NOT_FOUND_ERROR = "Group not found";
const INVITE_CODE_TYPE_ERROR = "Invite codes only apply to private and invite_only groups";
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
// no inviteCode, no email/phone/address/status/lastActiveAt/communityBlockedAt
// and no owner beyond the public identity reused by the Community feed
// (id + name). requiresInvite is derived from the immutable type so the UI can
// show the "By invitation only" gate without ever receiving the code itself.
const ownerShape = (o) => ({ id: o?.id ?? null, name: o?.name ?? null });

const groupShape = (g, memberCount, joined) => ({
  id: g.id,
  name: g.name,
  description: g.description ?? null,
  type: g.type,
  requiresInvite: g.type === GROUP_TYPE_INVITE_ONLY,
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
// Group row, never owner/member account fields and never the invite code
// (admins moderate all types through G1d but never receive customer codes).
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
// endpoints (type is fixed at creation per G1f — there is no type-change
// endpoint — while ownership changes by transfer and the lifecycle ends by
// dissolve). inviteCode is managed only through the dedicated G1f endpoints.
const IMMUTABLE_GROUP_FIELDS = ["id", "ownerId", "type", "inviteCode", "dissolvedAt", "createdAt", "updatedAt"];

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

// Active group = not dissolved (any type). Non-public groups are only reachable
// through the downstream member/owner gates: members read group resources via
// requireActiveMember, while everyone else still gets the uniform 404.
function fetchActiveGroup(db, groupId) {
  return db.group.findFirst({ where: { id: groupId, dissolvedAt: null } });
}

// Owner-scoped lookup for the owner-only management actions (update, remove
// member, transfer, dissolve). Public groups stay visible to every caller so a
// non-owner keeps getting the historical 403; private and invite_only groups
// are only found for their OWNER, so a non-owner probing them gets the same 404
// as a missing group — no existence oracle for non-public groups.
function fetchOwnableGroup(db, groupId, ownerId) {
  return db.group.findFirst({
    where: {
      id: groupId,
      dissolvedAt: null,
      OR: [{ type: GROUP_TYPE_PUBLIC }, { ownerId }],
    },
  });
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

// GET /api/community/groups — discovery of public and invite_only groups that
// are not dissolved. private groups are never listed (they are reachable only
// by code once a member; before joining they don't appear anywhere). invite_only
// groups list with a requiresInvite flag so the UI can show the code-gated join
// without ever seeing the code. Cursor pagination (createdAt DESC, id DESC)
// with the same take = limit + 1 window as the Community feed. memberCount and
// joined are derived server-side from real membership rows keyed by req.user.id
// — never from the query string.
export const listGroups = wrap(async function listGroups(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can view groups" });
  }

  const limit = parseGroupLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${GROUP_LIMIT_MAX}`);
  }

  const before = req.query?.before;
  const where = {
    type: { in: [GROUP_TYPE_PUBLIC, GROUP_TYPE_INVITE_ONLY] },
    dissolvedAt: null,
  };
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

  const cleanType = typeof type === "string" ? type : null;
  if (!GROUP_TYPES.includes(cleanType)) {
    return badRequest(res, 'type must be "public", "private" or "invite_only"');
  }

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

  if (req.user.communityBlockedAt) {
    return res.status(403).json({ error: BLOCKED_ERROR });
  }

  // Unsuccessful validation/auth/blocked requests never reach the limiter.
  const key = `group:create:${req.user.id}`;
  if (!groupCreateLimiter.allow(key)) return res.status(429).json({ error: TOO_MANY_ERROR });
  groupCreateLimiter.record(key);

  const group = await db.$transaction(async (tx) => {
    const g = await tx.group.create({
      data: { ownerId: req.user.id, name: groupName, description: groupDescription, type: cleanType },
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

// GET /api/community/groups/:groupId — safe group detail. Nonexistent and
// dissolved groups behave as a uniform 404. public groups are readable by every
// authenticated customer (existing behavior). private groups (never listed) and
// invite_only groups are readable only by their members: a non-member gets the
// same 404 as a missing group, so membership is never disclosed.
export const getGroup = wrap(async function getGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can view groups" });
  }

  const { groupId } = req.params;
  if (typeof groupId !== "string" || !groupId) return badRequest(res, "groupId is required");

  const group = await db.group.findFirst({
    where: { id: groupId, dissolvedAt: null },
    include: { owner: { select: { id: true, name: true } } },
  });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.type !== GROUP_TYPE_PUBLIC) {
    if (await requireActiveMember(req, res, db, groupId)) return;
  }

  const [members, myMemberships] = await Promise.all([
    db.groupMember.findMany({ where: { groupId } }),
    db.groupMember.findMany({ where: { userId: req.user.id, groupId } }),
  ]);

  res.json({ group: groupDetailShape(group, members.length, myMemberships.length > 0) });
});

// POST /api/community/groups/:groupId/join — idempotent. The composite primary
// key (groupId, userId) is the final duplicate guard; P2002 on create means we
// were already a member and is treated as success. Blocked customers are
// rejected before any membership work. public groups join freely (G1c). For
// private and invite_only groups the body MUST carry the group's current invite
// code; a missing or wrong code is the same uniform 404 as a missing group, so
// no membership or group state is ever disclosed. (join-with-code, the new G1f
// endpoint, is the discover-by-code path.)
export const joinGroup = wrap(async function joinGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can join groups" });
  }

  const { groupId } = req.params;
  if (typeof groupId !== "string" || !groupId) return badRequest(res, "groupId is required");

  if (req.user.communityBlockedAt) {
    return res.status(403).json({ error: BLOCKED_ERROR });
  }

  const group = await db.group.findFirst({ where: { id: groupId, dissolvedAt: null } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.type !== GROUP_TYPE_PUBLIC) {
    const code = req.body?.code;
    if (typeof code !== "string" || !group.inviteCode || code !== group.inviteCode) {
      return res.status(404).json({ error: NOT_FOUND_ERROR });
    }
  }

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
// leave (transfer/dissolve are the way out). Blocked customers CAN leave groups
// they belong to. P2025 on delete means we were not a member and is treated as
// success. Leaving is allowed on any active group type: a member of a private
// or invite_only group can withdraw exactly like a public-group member, and a
// non-member (already a member or not) gets the same idempotent success.
export const leaveGroup = wrap(async function leaveGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can leave groups" });
  }

  const { groupId } = req.params;
  if (typeof groupId !== "string" || !groupId) return badRequest(res, "groupId is required");

  const group = await fetchActiveGroup(db, groupId);
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

  const group = await fetchOwnableGroup(db, groupId, req.user.id);
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
// blocked owner may still manage the group. Works for any active type the
// caller owns (public, private or invite_only).
export const removeGroupMember = wrap(async function removeGroupMember(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can manage group members" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const { userId } = req.params;
  if (typeof userId !== "string" || !userId.trim()) return badRequest(res, "userId is required");

  const group = await fetchOwnableGroup(db, groupId, req.user.id);
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
// transfer. Works for any active type the caller owns.
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

  const group = await fetchOwnableGroup(db, groupId, req.user.id);
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
// blocked owner may still dissolve. Works for any active type the caller owns.
export const dissolveGroup = wrap(async function dissolveGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can dissolve groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await fetchOwnableGroup(db, groupId, req.user.id);
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

// ---- G1f non-public groups: invite codes & join-by-code ----

// 12-character URL-safe code from 9 random bytes (72 bits of entropy). Long
// enough that guessing is infeasible, short enough to copy by hand. The code is
// stored directly on the group row (nullable, unique) so join-by-code can
// resolve a group from the code in one lookup. It never leaves the server
// except through the owner-only invite-code endpoints below.
function newInviteCode() {
  return randomBytes(9).toString("base64url");
}

// GET /api/community/groups/:groupId/invite-code — owner-only read of the
// group's invite code. private/invite_only groups only: requesting the code for
// a public group is a 400 (nothing to hide — public groups never hold codes),
// and any NON-OWNER (member or not) gets the same 404 as a missing group so the
// code is never confirmed to exist. The code is never part of discovery,
// detail, member, message or admin payloads — this dedicated endpoint is the
// only channel.
export const getInviteCode = wrap(async function getInviteCode(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can view group invite codes" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await db.group.findFirst({ where: { id: groupId, dissolvedAt: null } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.type === GROUP_TYPE_PUBLIC) return badRequest(res, INVITE_CODE_TYPE_ERROR);
  if (group.ownerId !== req.user.id) return res.status(404).json({ error: NOT_FOUND_ERROR });

  res.json({ groupId, inviteCode: group.inviteCode ?? null });
});

// POST /api/community/groups/:groupId/invite-code — generate a new code, or
// rotate the existing one (the old code stops working immediately because
// join-by-code matches the current stored value). Ownership checks mirror
// getInviteCode. The membership budget is untouched: this is owner-only and its
// own low-traffic operation.
export const generateInviteCode = wrap(async function generateInviteCode(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can manage group invite codes" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await db.group.findFirst({ where: { id: groupId, dissolvedAt: null } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.type === GROUP_TYPE_PUBLIC) return badRequest(res, INVITE_CODE_TYPE_ERROR);
  if (group.ownerId !== req.user.id) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const code = newInviteCode();
  const updated = await db.group.update({ where: { id: groupId }, data: { inviteCode: code } });

  res.json({ ok: true, groupId, inviteCode: updated.inviteCode });
});

// DELETE /api/community/groups/:groupId/invite-code — disable the code. The
// stored code becomes null so join-by-code can no longer resolve the group;
// current members keep their membership. Idempotent: disabling when no code
// exists is a success. Ownership checks mirror getInviteCode.
export const disableInviteCode = wrap(async function disableInviteCode(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can manage group invite codes" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await db.group.findFirst({ where: { id: groupId, dissolvedAt: null } });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  if (group.type === GROUP_TYPE_PUBLIC) return badRequest(res, INVITE_CODE_TYPE_ERROR);
  if (group.ownerId !== req.user.id) return res.status(404).json({ error: NOT_FOUND_ERROR });

  await db.group.update({ where: { id: groupId }, data: { inviteCode: null } });

  res.json({ ok: true, groupId, inviteCode: null });
});

// POST /api/community/groups/join-with-code — join a non-public group by its
// invite code. The group is resolved FROM the code (never from a groupId), so
// an unknown or disabled code returns the same 404 as a missing group. Blocked
// customers are rejected before any lookup (no code probing). Membership
// keying, idempotency (P2002) and the per-customer membership limiter are
// shared with joinGroup. The response carries the joined group's public
// identity so the UI can land the user without a second round-trip.
export const joinGroupWithCode = wrap(async function joinGroupWithCode(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    return res.status(403).json({ error: "Only customers can join groups" });
  }

  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest(res, "Request body must be a JSON object");
  }

  const { code } = body;
  if (typeof code !== "string" || !code.trim()) return badRequest(res, "code is required");

  if (req.user.communityBlockedAt) {
    return res.status(403).json({ error: BLOCKED_ERROR });
  }

  const group = await db.group.findFirst({
    where: {
      inviteCode: code.trim(),
      type: { in: [GROUP_TYPE_PRIVATE, GROUP_TYPE_INVITE_ONLY] },
      dissolvedAt: null,
    },
  });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const key = `group:membership:${req.user.id}`;
  if (!groupMembershipLimiter.allow(key)) return res.status(429).json({ error: TOO_MANY_ERROR });

  try {
    await db.groupMember.create({ data: { groupId: group.id, userId: req.user.id } });
  } catch (error) {
    if (error.code !== "P2002") throw error;
  }

  groupMembershipLimiter.record(key);
  res.json({
    ok: true,
    groupId: group.id,
    joined: true,
    group: { id: group.id, name: group.name, type: group.type },
  });
});

// ---- Admin side ----

// GET /api/admin/community/groups — admin discovery of all groups (public,
// private and invite_only), active and dissolved. Unlike the customer feed,
// dissolved groups stay visible with status "dissolved" so admins can still
// moderate them, and non-public groups appear so admins can moderate them too.
// Admins never see a group's invite code: adminGroupShape picks explicit fields
// and there is no admin invite-code route. Same cursor window as the customer
// discovery feed.
export const adminListGroups = wrap(async function adminListGroups(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const limit = parseGroupLimit(req);
  if (limit === null) {
    return badRequest(res, `limit must be an integer from 1 to ${GROUP_LIMIT_MAX}`);
  }

  const before = req.query?.before;
  const where = {};
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

// GET /api/admin/community/groups/:groupId — admin detail of any group
// (public, private or invite_only), including dissolved ones (customers see a
// 404 for dissolved groups and for non-public groups they don't belong to).
export const adminGetGroup = wrap(async function adminGetGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await db.group.findFirst({
    where: { id: groupId },
    include: { owner: { select: { id: true, name: true } } },
  });
  if (!group) return res.status(404).json({ error: NOT_FOUND_ERROR });

  const members = await db.groupMember.findMany({ where: { groupId } });

  res.json({ group: adminGroupShape(group, members.length) });
});

// GET /api/admin/community/groups/:groupId/members — admin roster for any group
// (public, private or invite_only; active or dissolved). Same safe member
// serialization as the customer roster.
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

  const group = await db.group.findFirst({ where: { id: groupId } });
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

// GET /api/admin/community/groups/:groupId/messages — admin feed for any group
// (public, private or invite_only; active or dissolved). The customer-safe
// message shape is extended with moderation attribution (deletedById/deletedAt)
// that only admins receive.
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

  const group = await db.group.findFirst({ where: { id: groupId } });
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
// member from any group (member cannot be the owner). Only the membership row
// is deleted (never any message). The owner cannot be removed this way (400):
// ownership only moves by transfer or ends by dissolve, both owner actions. Idempotent: removing a
// non-member is a success. Body/query userId is never trusted.
export const adminRemoveGroupMember = wrap(async function adminRemoveGroupMember(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const { userId } = req.params;
  if (typeof userId !== "string" || !userId.trim()) return badRequest(res, "userId is required");

  const group = await db.group.findFirst({ where: { id: groupId } });
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

  const group = await db.group.findFirst({ where: { id: groupId } });
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

// POST /api/admin/community/groups/:groupId/dissolve — admin ends any group
// (public, private or invite_only). Same soft dissolve as the owner path: only
// dissolvedAt is set, all rows are preserved and the group stays inspectable by
// admins. Idempotent — an already-dissolved group returns ok:true (unlike the
// customer 404, because admins can see dissolved groups). Nonexistent groups
// still 404.
export const adminDissolveGroup = wrap(async function adminDissolveGroup(req, res, next, db = prisma) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Only admins can manage community groups" });
  }

  const groupId = groupParam(req, res);
  if (!groupId) return;

  const group = await db.group.findFirst({ where: { id: groupId } });
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