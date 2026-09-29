import prisma from "../utils/prisma.js";
import {
  badRequest,
  isValidBroadcastAudience,
  isValidBroadcastTarget,
  isValidBroadcastType,
} from "../utils/validators.js";
import { BROADCAST_AUDIENCE_DEFAULT } from "../config.js";

// ---- Phase 2B-2 audience separation ----
//
// A legacy row predating the `audience` column would read as NULL, and the
// additive migration backfills every existing row to "customer", so NULL is not
// reachable through the API. If a NULL ever did appear, the equality checks below
// would simply not match it, which fails closed (the row is hidden) rather than
// open.
const CUSTOMER_AUDIENCE = { audience: BROADCAST_AUDIENCE_DEFAULT };

// The only broadcast fields the EMPLOYEE endpoints return. Deliberately excludes
// `userId`, `target` and `audience`: who a message was aimed at and how targeting
// is stored are internal routing details, not content. This schema stores no
// author/admin identity on a Broadcast, so there is none to leak. The `type` is
// kept because it is display metadata (announcement vs notification), the same
// label the customer feed already renders.
const EMPLOYEE_BROADCAST_SELECT = {
  id: true,
  type: true,
  title: true,
  content: true,
  createdAt: true,
};

// THE single definition of "which broadcasts may this user see", shared by every
// read path.
//
// Both the list endpoint and its mark-read endpoint must agree EXACTLY, or a user
// could mutate read state for a message they were never allowed to see — which is
// precisely how the pre-2B-2 customer mark-read endpoint was unsafe. Keeping one
// predicate makes that divergence impossible by construction.
//
// `audience` is always a literal chosen by the CALLER, never taken from the
// request, and `userId` is always `req.user.id` — so this cannot be steered by
// query parameters.
function visibleToUser({ userId, audience }) {
  return {
    AND: [
      // The audience gate. This is what stops an employee announcement from ever
      // matching a customer query, and vice versa.
      { audience },
      // target = "all" means "all of THIS audience" — never "everybody".
      {
        OR: [
          { target: "all" },
          { AND: [{ target: "specific_user" }, { userId }] },
        ],
      },
    ],
  };
}

// ---- Public main site ----
export async function listPublicBroadcasts(req, res) {
  const broadcasts = await prisma.broadcast.findMany({
    // Pinned to the customer audience. `target: "public"` is the public site, so
    // an employee-only message must never be publishable there by accident, and
    // this makes that structural rather than a UI convention.
    // The projection is deliberately unchanged from before Phase 2B-2.
    where: { target: "public", type: "announcement", ...CUSTOMER_AUDIENCE },
    orderBy: { createdAt: "desc" },
  });
  res.json({ broadcasts });
}

// ---- Customers: announcements/notifications targeted at them ----
export async function listMyBroadcasts(req, res) {
  const broadcasts = await prisma.broadcast.findMany({
    // `audience: "customer"` is the load-bearing part of Phase 2B-2: before it,
    // an employee "all" announcement (audience = "employee", target = "all")
    // matched this query and would have been delivered to every customer.
    where: visibleToUser({ userId: req.user.id, audience: BROADCAST_AUDIENCE_DEFAULT }),
    orderBy: { createdAt: "desc" },
  });

  const readSet = await readIdsFor(req.user.id);
  res.json({
    broadcasts: broadcasts.map((b) => ({ ...b, read: readSet.has(b.id) })),
  });
}

export async function markBroadcastRead(req, res) {
  const { id } = req.params;
  // Authorization before mutation (Phase 2B-2). This endpoint takes a target id
  // and previously recorded a read row for ANY id, so a customer could write read
  // state against an announcement aimed at somebody else — including an employee
  // announcement they are not allowed to see. Visibility is now verified against
  // the same predicate the list uses, and an invisible id is reported as 404 so
  // its existence is not confirmed.
  const visible = await prisma.broadcast.findFirst({
    where: { id, ...visibleToUser({ userId: req.user.id, audience: BROADCAST_AUDIENCE_DEFAULT }) },
    select: { id: true },
  });
  if (!visible) return res.status(404).json({ error: "Announcement not found" });

  await recordRead(req.user.id, visible.id);
  res.json({ ok: true });
}

// ---- Employees: announcements aimed at employees (Phase 2B-2) ----
//
// `authenticate` + `requireEmployee` guard the route. This function adds the
// audience scoping and never accepts a user id from the request: the only
// identity used is req.user.id, so there is no way to ask for another
// employee's announcements.
export async function listMyEmployeeBroadcasts(req, res) {
  const broadcasts = await prisma.broadcast.findMany({
    where: visibleToUser({ userId: req.user.id, audience: "employee" }),
    orderBy: { createdAt: "desc" },
    select: EMPLOYEE_BROADCAST_SELECT,
  });

  const readSet = await readIdsFor(req.user.id);
  res.json({
    broadcasts: broadcasts.map((b) => ({ ...b, read: readSet.has(b.id) })),
  });
}

export async function markEmployeeBroadcastRead(req, res) {
  const { id } = req.params;
  // Verified against the employee's own audience, so an employee cannot mark a
  // customer announcement read, nor an announcement aimed at a different
  // employee, by passing its id.
  const visible = await prisma.broadcast.findFirst({
    where: { id, ...visibleToUser({ userId: req.user.id, audience: "employee" }) },
    select: { id: true },
  });
  if (!visible) return res.status(404).json({ error: "Announcement not found" });

  await recordRead(req.user.id, visible.id);
  res.json({ ok: true });
}

// Read ids for a user. Only the ids — never a read timestamp or another user's
// read state.
async function readIdsFor(userId) {
  const reads = await prisma.userBroadcastRead.findMany({
    where: { userId },
    select: { broadcastId: true },
  });
  return new Set(reads.map((r) => r.broadcastId));
}

// Idempotent read recording. UserBroadcastRead is @@id([userId, broadcastId]),
// so a duplicate is impossible at the storage level; the findUnique guard keeps a
// repeated request (double tap, retry) from surfacing a unique-constraint error
// as a 500, and a lost race is swallowed for the same reason.
async function recordRead(userId, broadcastId) {
  const existing = await prisma.userBroadcastRead.findUnique({
    where: { userId_broadcastId: { userId, broadcastId } },
  });
  if (existing) return false;
  try {
    await prisma.userBroadcastRead.create({ data: { userId, broadcastId } });
  } catch {
    // Lost the race against a concurrent identical request: the row exists,
    // which is the desired end state.
  }
  return true;
}

// ---- Admin: publish notifications / announcements ----
export async function adminCreateBroadcast(req, res) {
  const { type, target, title, content, userId, audience } = req.body || {};

  if (!isValidBroadcastType(type)) return badRequest(res, "type must be notification | announcement");
  if (!isValidBroadcastTarget(target)) {
    return badRequest(res, "target must be public | all | specific_user");
  }
  if (!content?.trim()) return badRequest(res, "content is required");

  // An explicit audience is required, and validated. It can never be inferred
  // from `target`: "all" is "all of this audience", not "everybody".
  if (audience == null || audience === "") {
    return badRequest(res, "audience is required and must be customer | employee");
  }
  if (!isValidBroadcastAudience(audience)) {
    return badRequest(res, "audience must be customer | employee");
  }
  // The public site is customer-facing; an employee-only message must not be
  // publishable there.
  if (target === "public" && audience !== "customer") {
    return badRequest(res, "an employee announcement cannot target the public site");
  }

  if (target === "specific_user") {
    if (!userId) {
      return badRequest(res, `userId is required when targeting a specific ${audience === "employee" ? "employee" : "customer"}`);
    }
    // The targeted account must actually be a member of the stated audience, so
    // a customer id can never be delivered as an employee announcement (or the
    // reverse). Verified server-side against the role, never trusted from the UI.
    const target_user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!target_user) return badRequest(res, "the targeted account does not exist");
    if (target_user.role !== audience) {
      return badRequest(
        res,
        `the targeted account is a ${target_user.role}, not a ${audience}: refusing to deliver across audiences`,
      );
    }
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      type,
      target,
      audience,
      title: title || null,
      content: content.trim(),
      userId: target === "specific_user" ? userId : null,
    },
  });
  res.status(201).json({ broadcast });
}

export async function adminListBroadcasts(req, res) {
  const broadcasts = await prisma.broadcast.findMany({
    orderBy: { createdAt: "desc" },
    // Admins may see the full record, including the audience, so the broadcast
    // list can label each row's audience unambiguously. Still no read state.
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json({ broadcasts });
}

export async function adminDeleteBroadcast(req, res) {
  const { id } = req.params;
  await prisma.broadcast.delete({ where: { id } }).catch(() => {});
  res.json({ ok: true });
}