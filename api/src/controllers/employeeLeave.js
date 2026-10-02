import prisma from "../utils/prisma.js";
import {
  LEAVE_KIND,
  LEAVE_REQUEST_STATUS,
  LEAVE_REQUEST_STATUS_DEFAULT,
  ROLES,
} from "../config.js";
import {
  badRequest,
  isValidBoundedNote,
  isValidLeaveKind,
  isValidLeaveRange,
} from "../utils/validators.js";
import { isValidDateString } from "../utils/schedule.js";

// EMPLOYEE LEAVE REQUESTS.
//
// A leave request is a REQUEST FOR TIME OFF that only an admin may decide. It is
// deliberately a separate system from EmployeeAvailability: availability is the
// employee's own stated PREFERENCE ("when I can work"), while leave is a formal
// request carrying a decision. Neither is written from the other, so there is no
// second source of truth for "is this employee off on that day" — approving leave
// does not invent an availability preference the employee never stated.
//
// Leave NEVER creates, changes or removes work. BookingAssignment remains the only
// source of truth for an actual assignment, exactly as it is for a shift request,
// and no handler in this file writes to it.
//
// IDENTITY: an employee's id always comes from `req.user.id`. There is no
// employeeId, userId or decidedById read from the request body, query string or
// path anywhere in this file — a client cannot file leave for, or decide leave on
// behalf of, anybody else, and the admin recorded on a decision is the
// authenticated session admin, never a client-supplied value.

// The employee-facing projection of a leave request.
//
// It contains exactly what the requesting employee needs and nothing else. In
// particular there is NO decidedBy name, no other employee's data, and no
// customer, payment, address, token or private admin note here: an employee sees
// their own dates, their own note, the status, and when it was decided.
const leaveSelect = {
  id: true,
  employeeId: true,
  startsOn: true,
  endsOn: true,
  kind: true,
  note: true,
  status: true,
  decidedAt: true,
  decidedById: true,
  createdAt: true,
  updatedAt: true,
};

const leaveView = (r) => ({
  id: r.id,
  employeeId: r.employeeId,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  kind: r.kind ?? null,
  note: r.note ?? null,
  status: r.status,
  decidedAt: r.decidedAt ?? null,
  createdAt: r.createdAt,
});

// The admin projection. An admin legitimately needs to know WHO asked before
// deciding, so the employee's NAME and the deciding admin's name are included here
// (and only here). Still no email, phone, address, password hash or token, and no
// customer or payment data — this queue is about time off, not about bookings.
const adminLeaveSelect = {
  ...leaveSelect,
  employee: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
};

const adminLeaveView = (r) => ({
  ...leaveView(r),
  employeeName: r.employee?.name ?? null,
  decidedById: r.decidedById ?? null,
  decidedByName: r.decidedBy?.name ?? null,
});

// Same defence in depth as every other admin handler in this codebase: the route is
// already behind `adminOnly`, and the role is re-checked here from the
// server-side session so a handler can never be reached as an admin by any other
// means.
function requireAdminActor(req, res) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    res.status(403).json({ error: "Forbidden: insufficient role" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// EMPLOYEE
// ---------------------------------------------------------------------------

// GET /api/employee/leave — this employee's own requests, newest first, including
// decided ones so the outcome stays visible.
//
// Server-scoped in the query itself, not filtered afterwards: there is no
// "all leave" branch and no client-supplied scope, so a row belonging to another
// employee is never even read.
export async function listMyLeaveRequests(req, res) {
  const requests = await prisma.employeeLeaveRequest.findMany({
    where: { employeeId: req.user.id },
    orderBy: [{ createdAt: "desc" }],
    select: leaveSelect,
  });
  res.json({ leave: requests.map(leaveView) });
}

// POST /api/employee/leave
//
// The employee identity is `req.user.id`, unconditionally. Any `employeeId` in the
// body is not merely ignored — it is never read, so it cannot be used to file a
// request against somebody else's account.
export async function createMyLeaveRequest(req, res) {
  const { startsOn, endsOn, kind, note } = req.body || {};

  if (startsOn === undefined || startsOn === null || startsOn === "") {
    return badRequest(res, "A start date is required");
  }
  if (endsOn === undefined || endsOn === null || endsOn === "") {
    return badRequest(res, "An end date is required");
  }
  // The range is checked by the shared validator, then the reason is narrowed so
  // the employee is told WHICH part to fix rather than a bare "invalid date".
  if (!isValidLeaveRange({ startsOn, endsOn })) {
    if (!isValidDateString(startsOn)) {
      return badRequest(res, "Start date must be a real calendar date (YYYY-MM-DD)");
    }
    if (!isValidDateString(endsOn)) {
      return badRequest(res, "End date must be a real calendar date (YYYY-MM-DD)");
    }
    // Both ends are well-formed here, so the only remaining failure is the order.
    return badRequest(res, "The end date cannot be before the start date");
  }
  if (!isValidLeaveKind(kind)) {
    return badRequest(res, `kind must be one of: ${LEAVE_KIND.join(", ")}`);
  }
  if (!isValidBoundedNote(note)) {
    return badRequest(res, "note is too long");
  }

  const created = await prisma.employeeLeaveRequest.create({
    data: {
      // Session user only. Never a body field.
      employeeId: req.user.id,
      startsOn,
      endsOn,
      kind: kind ? String(kind).trim() : null,
      note: note ? String(note).trim() : null,
      status: LEAVE_REQUEST_STATUS_DEFAULT,
    },
    select: leaveSelect,
  });
  res.status(201).json({ leave: leaveView(created) });
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------

// GET /api/admin/leave — the admin queue, PENDING FIRST so a fresh request is the
// first thing seen, then decided ones newest-first.
//
// An optional `?status=` narrows the view to one state. An unrecognised value is
// refused rather than ignored: silently listing everything would let a typo hide
// every pending request from the admin who meant to see only those.
export async function adminListLeaveRequests(req, res) {
  if (!requireAdminActor(req, res)) return;
  const requested = req.query?.status;
  if (requested !== undefined && !LEAVE_REQUEST_STATUS.includes(requested)) {
    return badRequest(res, `status must be one of: ${LEAVE_REQUEST_STATUS.join(", ")}`);
  }

  const where = requested ? { status: requested } : {};
  const requests = await prisma.employeeLeaveRequest.findMany({
    where,
    // Newest first in the database; PENDING FIRST is applied below in JS.
    orderBy: [{ createdAt: "desc" }],
    select: adminLeaveSelect,
  });

  // Pending first, then newest first — the same rule sortLeaveForAdmin applies in
  // the browser, so the API and the page can never disagree about what is urgent.
  //
  // This is deliberately done here rather than in the query: `status` is a plain
  // string, so ordering by it sorts ALPHABETICALLY ("approved" < "declined" <
  // "requested") and would bury every pending request at the BOTTOM of the queue.
  // Ranking on `status` also stays correct if a row were ever inconsistent.
  const sorted = sortLeavePendingFirst(requests);

  // The counts describe the whole queue, never just the filtered slice, so the
  // admin can see how much is waiting while looking at one status. With no filter
  // they come from the rows already fetched; with a filter, one aggregate supplies
  // the totals rather than a second full read.
  const counts = { requested: 0, approved: 0, declined: 0 };
  if (requested) {
    const grouped = await prisma.employeeLeaveRequest.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (counts[g.status] !== undefined) counts[g.status] = g._count._all;
    }
  } else {
    for (const r of sorted) {
      if (counts[r.status] !== undefined) counts[r.status] += 1;
    }
  }

  res.json({
    leave: sorted.map(adminLeaveView),
    counts,
    filter: requested ?? null,
  });
}

// Stable partition: everything still awaiting a decision first, then the decided
// rows, each group left in the newest-first order the query returned. A sort on
// status is not stable for this purpose, which is why the grouping is explicit.
function sortLeavePendingFirst(requests) {
  const pending = [];
  const decided = [];
  for (const r of requests) {
    (r.status === LEAVE_REQUEST_STATUS_DEFAULT ? pending : decided).push(r);
  }
  return [...pending, ...decided];
}

// Decides one request. Shared by approve and decline so both are held to exactly
// the same rules, and so there is only one place a decision can be written.
//
// * Only a 'requested' row may be decided. A decided request is refused rather
//   than re-decided, so a decision can never be silently overwritten and an
//   employee's outcome can never change after the fact.
// * The write is a conditional `updateMany` on `status = 'requested'`, so two
//   admins deciding at the same moment cannot both win: the second update matches
//   no row and is refused the same way a re-decision is.
// * `decidedById` is the AUTHENTICATED session admin. There is no client field
//   that can change whose decision this is.
async function decideLeaveRequest(req, res, decision) {
  if (!requireAdminActor(req, res)) return;
  const { id } = req.params;

  const existing = await prisma.employeeLeaveRequest.findUnique({
    where: { id },
    select: { id: true, status: true, decidedAt: true, decidedById: true },
  });
  if (!existing) return res.status(404).json({ error: "Leave request not found" });
  if (existing.status !== LEAVE_REQUEST_STATUS_DEFAULT) {
    return badRequest(res, `This request was already ${existing.status}`);
  }

  const now = new Date();
  const decided = await prisma.employeeLeaveRequest.updateMany({
    where: { id, status: LEAVE_REQUEST_STATUS_DEFAULT },
    data: { status: decision, decidedAt: now, decidedById: req.user.id },
  });
  // Lost the race to a concurrent decision: report it as the already-decided case
  // rather than pretending this request succeeded.
  if (decided.count !== 1) {
    return badRequest(res, "This request was already decided");
  }

  const row = await prisma.employeeLeaveRequest.findUnique({
    where: { id },
    select: adminLeaveSelect,
  });
  res.json({ leave: adminLeaveView(row) });
}

// POST /api/admin/leave/:id/approve
//
// Approving leave records a DECISION only. It does not create, cancel or reassign
// any booking, assignment or shift, and it does not write an availability row.
export async function adminApproveLeaveRequest(req, res) {
  return decideLeaveRequest(req, res, "approved");
}

// POST /api/admin/leave/:id/decline
export async function adminDeclineLeaveRequest(req, res) {
  return decideLeaveRequest(req, res, "declined");
}
