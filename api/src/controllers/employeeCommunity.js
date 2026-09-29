import prisma from "../utils/prisma.js";
import {
  badRequest,
  COMMUNITY_MESSAGE_MAX_LENGTH,
  isValidCommunityMessage,
} from "../utils/validators.js";
import { readCommunityFeed } from "./community.js";
import { createRateLimiter } from "../utils/rateLimit.js";
import { COMMUNITY_EMPLOYEE_AUDIENCE, ROLES } from "../config.js";

// Express 4 does not catch rejected promises from async handlers, so every
// handler routes its rejection to the error middleware. Handler signature is
// (req, res, next, db = prisma): Express passes `next` in the third slot, and a
// non-function third argument is therefore the injected db used by the tests.
// Identical convention to community.js and groups.js.
const wrap = (fn) => (req, res, next, db = prisma) => {
  if (typeof next !== "function") [db, next] = [next, undefined];
  return Promise.resolve(fn(req, res, next, db)).catch(next);
};

// ---------------------------------------------------------------------------
// Employee community (Phase 2B-5).
//
// ONE shared employee-only community, served from the SAME CommunityMessage
// table as the customer community and separated by the stored `audience` column
// rather than by a route guard's accident.
//
// SECURITY CONTRACT (each rule is enforced in code and asserted in
// test/employeeCommunity.test.js):
//
//   1. Both employee routes sit behind `authenticate` + `requireEmployee`, and
//      every handler additionally re-checks the role itself, so a future
//      middleware-order change cannot expose the community.
//   2. THE AUDIENCE IS A LITERAL. `EMPLOYEE_FEED` below is a module constant. No
//      handler, and no function it calls, ever reads an audience from req.query,
//      req.body, req.params or client state. `?audience=customer` on an employee
//      route cannot widen it, and `?audience=employee` on a customer route
//      cannot widen that either (see community.js readCommunityFeed).
//   3. The author is ALWAYS `req.user.id`. A `customerId`/`authorId` in the body
//      is ignored, so an employee cannot post as a colleague or as a customer.
//   4. The author is projected with `select` of id + name ONLY — never
//      email/phone/address/passwordHash/stripeCustomerId/disabledAt. The same
//      projection the customer feed has always used.
//   5. Moderation endpoints verify `target.role === ROLES.EMPLOYEE`, so an
//      admin cannot block a CUSTOMER (or an admin) through this surface.
//   6. Admins moderate but never author: there is no admin create route, and
//      `createEmployeeCommunityMessage` refuses a non-employee outright.
//
// NOT IN SCOPE, deliberately: no employee groups, profiles, reactions,
// attachments or realtime; and nothing here touches employee->admin or
// employee->customer messaging (controllers/messages.js is left alone).
// ---------------------------------------------------------------------------

// A SEPARATE limiter from the customer community's `communityPostLimiter`, with
// its own key namespace. Sharing one limiter would let a customer's posting
// budget and an employee's contend for the same window. Keyed per EMPLOYEE id,
// so one employee exhausting their budget never throttles another.
export const employeeCommunityPostLimiter = createRateLimiter({ windowMs: 60000, limit: 10 });

// Admin moderation actions (soft delete) are throttled separately and keyed per
// ADMIN id, matching the group-admin limiter's shape in groups.js.
export const adminEmployeeCommunityActionLimiter = createRateLimiter({ windowMs: 60000, limit: 30 });

const BLOCKED_ERROR = "You are blocked from posting to the employee community";
const TOO_MANY_ERROR = "Too many requests. Please try again later.";
const NOT_FOUND_MESSAGE = "Message not found";
const NOT_FOUND_EMPLOYEE = "Employee not found";

// The employee-facing row shape.
//
// `author` rather than `customer`, for two reasons: it keeps the customer
// feed's existing `customer` key untouched, and it prevents the employee UI
// from linking an author to /dashboard/profile/[userId] — a requireCustomer page
// that would 403 for every employee.
//
// The author is read from the `customer` relation because that is the AUTHOR
// foreign key for both audiences (see the schema); for an employee row it points
// at an employee. Its `select` is id + name only.
const employeeMessageShape = (m) => ({
  id: m.id,
  content: m.content,
  createdAt: m.createdAt,
  author: { id: m.customer?.id ?? null, name: m.customer?.name ?? null },
});

// The admin moderation shape. Identical to the employee shape plus `deletedAt`,
// so an admin can SEE which posts they have already removed. Still id + name for
// the author — moderation does not widen the author projection.
const adminEmployeeMessageShape = (m) => ({
  ...employeeMessageShape(m),
  deletedAt: m.deletedAt ?? null,
});

// THE employee feed configuration: a module constant, never request-derived.
// hideDeleted hides soft-deleted posts from employees while leaving them visible
// to the admin moderation feed.
const EMPLOYEE_FEED = {
  audience: COMMUNITY_EMPLOYEE_AUDIENCE,
  shape: employeeMessageShape,
  hideDeleted: true,
};

// ---- Employee side ----

// GET /api/employee/community/messages (authenticate + requireEmployee).
// Employees read the employee community only: the audience pin in
// readCommunityFeed means a customer post cannot appear here, and there is no
// parameter this endpoint accepts that could change that.
export const listMyEmployeeCommunityMessages = wrap(async function listMyEmployeeCommunityMessages(
  req,
  res,
  next,
  db = prisma,
) {
  return readCommunityFeed(req, res, db, EMPLOYEE_FEED);
});

// POST /api/employee/community/messages (authenticate + requireEmployee).
// The author always comes from req.user.id; a customerId or authorId in the
// body is never trusted. A blocked employee is rejected with 403 but may still
// read (there is no read-side block).
export const createEmployeeCommunityMessage = wrap(async function createEmployeeCommunityMessage(
  req,
  res,
  next,
  db = prisma,
) {
  // Defense in depth: requireEmployee normally keeps customers and admins out,
  // but never let either author a post here even if middleware order changes.
  // An ADMIN is refused too — admins moderate the community, they do not post in
  // it, matching the customer community's long-standing rule.
  if (!req.user || req.user.role !== ROLES.EMPLOYEE) {
    return res.status(403).json({ error: "Only employees can post to the employee community" });
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

  // Per-EMPLOYEE budget, namespaced away from the customer community's key so
  // the two surfaces can never contend. Unsuccessful attempts are not recorded.
  const key = `employeeCommunity:${req.user.id}`;
  if (!employeeCommunityPostLimiter.allow(key)) {
    return res.status(429).json({ error: TOO_MANY_ERROR });
  }
  employeeCommunityPostLimiter.record(key);

  const created = await db.communityMessage.create({
    data: {
      customerId: req.user.id,
      content: content.trim(),
      // Named explicitly, never defaulted, so the audience of a write is as
      // explicit as the audience of a read.
      audience: COMMUNITY_EMPLOYEE_AUDIENCE,
    },
  });

  res.status(201).json({
    message: employeeMessageShape({ ...created, customer: { id: req.user.id, name: req.user.name ?? null } }),
  });
});

// ---- Admin side (moderation only; admins never author) ----

// Every admin handler re-checks the role itself, so the community is never
// reachable even if a route were ever registered without `adminOnly`.
function requireAdminUser(req, res) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    res.status(403).json({ error: "Only admins can manage the employee community" });
    return false;
  }
  return true;
}

// GET /api/admin/community/employee/messages (adminOnly).
// The employee-audience feed, pinned to its own literal — an admin cannot use
// this endpoint to read the CUSTOMER community any more than they can use the
// customer endpoint to read this one. Soft-deleted posts ARE included, because
// an admin moderating the feed needs to see what has already been removed.
export const adminListEmployeeCommunityMessages = wrap(async function adminListEmployeeCommunityMessages(
  req,
  res,
  next,
  db = prisma,
) {
  if (!requireAdminUser(req, res)) return undefined;
  return readCommunityFeed(req, res, db, {
    audience: COMMUNITY_EMPLOYEE_AUDIENCE,
    shape: adminEmployeeMessageShape,
  });
});

// DELETE /api/admin/community/employee/messages/:messageId (adminOnly).
// Soft delete: sets deletedAt/deletedById instead of removing the row, so the
// post disappears from the employee feed while the moderation record survives.
//
// The lookup is scoped by audience, so a CUSTOMER message id resolves to the
// same 404 as a nonexistent id — the response never confirms that some other
// audience's message exists, which is what a 403 (or a bare id lookup) would
// leak. Soft delete is idempotent: deleting an already-deleted post is a no-op
// that still reports success.
export const adminDeleteEmployeeCommunityMessage = wrap(async function adminDeleteEmployeeCommunityMessage(
  req,
  res,
  next,
  db = prisma,
) {
  if (!requireAdminUser(req, res)) return undefined;

  const { messageId } = req.params;
  if (typeof messageId !== "string" || !messageId) return badRequest(res, "messageId is required");

  const message = await db.communityMessage.findFirst({
    where: { id: messageId, audience: COMMUNITY_EMPLOYEE_AUDIENCE },
    select: { id: true, deletedAt: true },
  });
  // 404, not 403: identical response for "no such message" and "a message in
  // another audience", so this endpoint is not an existence oracle.
  if (!message) return res.status(404).json({ error: NOT_FOUND_MESSAGE });

  const key = `employeeCommunity:admin:${req.user.id}`;
  if (!adminEmployeeCommunityActionLimiter.allow(key)) {
    return res.status(429).json({ error: TOO_MANY_ERROR });
  }
  adminEmployeeCommunityActionLimiter.record(key);

  const updated = message.deletedAt
    ? message
    : await db.communityMessage.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedById: req.user.id },
        select: { id: true, deletedAt: true },
      });

  res.json({ ok: true, message: { id: updated.id, deletedAt: updated.deletedAt ?? null } });
});

// Shared employee posting-block write: find the target, refuse anyone who is
// not an employee, then set/clear User.communityBlockedAt (the SAME column the
// customer community already uses — no new column, no change to customer
// behavior). Idempotent by design.
async function setEmployeeCommunityBlockedAt(req, res, db, blockedAt) {
  if (!requireAdminUser(req, res)) return;

  const { id } = req.params;
  if (typeof id !== "string" || !id) return badRequest(res, "User id is required");

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true },
  });
  // 404 for an unknown id AND for a non-employee. The customer community's
  // helper answers 400 for a non-customer, but for THIS surface a 404 is
  // strictly better: it confirms nothing about whether the id is a customer, an
  // admin or another employee.
  if (!target || target.role !== ROLES.EMPLOYEE) {
    return res.status(404).json({ error: NOT_FOUND_EMPLOYEE });
  }

  const updated = await db.user.update({
    where: { id },
    data: { communityBlockedAt: blockedAt },
    select: { id: true, name: true, communityBlockedAt: true },
  });
  res.json({
    ok: true,
    user: { id: updated.id, name: updated.name, communityBlockedAt: updated.communityBlockedAt ?? null },
  });
}

export const adminBlockEmployee = wrap(async function adminBlockEmployee(req, res, next, db = prisma) {
  return setEmployeeCommunityBlockedAt(req, res, db, new Date());
});

export const adminUnblockEmployee = wrap(async function adminUnblockEmployee(req, res, next, db = prisma) {
  return setEmployeeCommunityBlockedAt(req, res, db, null);
});

// GET /api/admin/community/employee/users (adminOnly). Persistent blocked state
// for the moderation UI. Scoped to role = employee, and a three-field select —
// never the full User row.
export const adminListEmployeeCommunityUsers = wrap(async function adminListEmployeeCommunityUsers(
  req,
  res,
  next,
  db = prisma,
) {
  if (!requireAdminUser(req, res)) return undefined;

  const users = await db.user.findMany({
    where: { role: ROLES.EMPLOYEE },
    select: { id: true, name: true, communityBlockedAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  res.json({
    users: users.map((u) => ({ id: u.id, name: u.name, communityBlockedAt: u.communityBlockedAt ?? null })),
  });
});
