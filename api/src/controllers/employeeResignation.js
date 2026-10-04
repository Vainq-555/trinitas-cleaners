import prisma from "../utils/prisma.js";
import { badRequest, isValidBoundedNote } from "../utils/validators.js";
import {
  ROLES,
  RESIGNATION_REQUEST_STATUS,
  RESIGNATION_REQUEST_STATUS_DEFAULT,
  SHIFT_REQUEST_STATUS_DEFAULT,
} from "../config.js";

// EMPLOYEE RESIGNATION REQUESTS — submission only.
//
// A resignation is an employee's request to END the employment relationship. It is
// deliberately its own system: it is not leave (a request for time off) and not
// availability (a stated work preference). A resignation request is a statement of
// intent that only an admin may decide, so it follows the same shape as
// EmployeeLeaveRequest without sharing any of its tables, status, or decisions.
//
// SUBMISSION + THE ADMIN DECISION. The admin side (list, approve) lives below.
//
// Approval, decline, orphan acknowledgement, the finalization role transition and
// rehire are handled here; REHIRE remains out of scope, because reinstating an
// employment relationship is not something an approval may do on its own.
//
// IDENTITY: the employee is `req.user.id`, unconditionally. `employeeId` is never
// read from the body, query string or path, so an employee cannot resign on
// another employee's behalf, and no client-supplied value can reach the row.
//
// NOT A COMPETING SOURCE OF TRUTH: this handler creates no BookingAssignment, no
// shift, no leave request and no availability row, and it writes nothing to User.
// A resignation request is a request; it is not an assignment, a cancellation, or a
// role change. The route's `authenticate` guard already refuses a disabled
// account, so a disabled employee's existing session stops being authorized on its
// next request — this handler adds no second employee-status system of its own.

// The employee-facing projection of a resignation request.
//
// It contains exactly what the requesting employee needs and nothing else: their
// own request id, their own note, the status, and when it was created. In
// particular there is NO decidedBy identity, NO orphan* acknowledgement fields and
// NO other employee's data — those are admin-side facts, and an employee has no
// legitimate need for them.
const resignationSelect = {
  id: true,
  employeeId: true,
  note: true,
  status: true,
  decidedAt: true,
  createdAt: true,
};

const resignationView = (r) => ({
  id: r.id,
  employeeId: r.employeeId,
  note: r.note ?? null,
  status: r.status,
  decidedAt: r.decidedAt ?? null,
  createdAt: r.createdAt,
});

// POST /api/employee/resignation
//
// Creates exactly one EmployeeResignationRequest for the authenticated employee.
//
// The only field read from the request is `note`. Everything else — the employee
// and the status — is server-owned, so a caller cannot file a resignation as
// somebody else or pre-decide their own request.
export async function createMyResignationRequest(req, res) {
  const { note } = req.body || {};

  if (!isValidBoundedNote(note)) {
    return badRequest(res, "note is too long");
  }

  // Trimmed FIRST, then emptied to NULL. A note that is absent, or present but
  // blank/whitespace-only, is stored as NULL rather than as "" — so a row never
  // carries meaningless blank text, and "no note" has exactly one representation
  // (matching the schema's own note that NULL is a valid request).
  const trimmedNote = typeof note === "string" ? note.trim() : "";

  let created;
  try {
    created = await prisma.employeeResignationRequest.create({
      data: {
        // Session user only. Never a body field.
        employeeId: req.user.id,
        note: trimmedNote ? trimmedNote : null,
        // `status` is deliberately NOT set here: the schema default applies, so a
        // resignation can only ever enter the table as "requested" and no caller can
        // file one as already approved or declined. See config.js
        // RESIGNATION_REQUEST_STATUS_DEFAULT.
      },
      select: resignationSelect,
    });
  } catch (error) {
    // "At most ONE open request per employee" is enforced by the DATABASE, not by a
    // read-then-write check in this handler. The partial unique index
    //     EmployeeResignationRequest_employeeId_requested_key
    //       ON "EmployeeResignationRequest"("employeeId") WHERE "status" = 'requested'
    // is the primary guard, which is what makes concurrent submissions safe: a
    // SELECT-then-INSERT would let two simultaneous clicks both see "no pending
    // request" and both insert. There is deliberately no prior SELECT here for that
    // reason.
    //
    // Only this one specific error is a duplicate. Anything else — a missing table,
    // a foreign key violation, a dropped connection — is a genuine fault and is
    // re-thrown to the central error handler rather than being dressed up as a
    // conflict the employee did not cause.
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "You already have a pending resignation request" });
    }
    throw error;
  }

  res.status(201).json({ resignation: resignationView(created) });
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------

// The admin projection. An admin legitimately needs to know WHO resigned before
// deciding, and needs the whole audit trail, so the employee's name, the deciding
// admin and the orphan acknowledgement are included here — and only here. Still no
// email, phone, address, password hash, invitation token, or customer/payment data.
const adminResignationSelect = {
  ...resignationSelect,
  decidedById: true,
  orphanedAssignmentCount: true,
  orphanReason: true,
  orphanAcknowledgedAt: true,
  orphanAcknowledgedById: true,
  employee: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  orphanAcknowledgedBy: { select: { id: true, name: true } },
};

const adminResignationView = (r) => ({
  ...resignationView(r),
  employeeName: r.employee?.name ?? null,
  decidedById: r.decidedById ?? null,
  decidedByName: r.decidedBy?.name ?? null,
  orphanedAssignmentCount: r.orphanedAssignmentCount ?? null,
  orphanReason: r.orphanReason ?? null,
  orphanAcknowledgedAt: r.orphanAcknowledgedAt ?? null,
  orphanAcknowledgedById: r.orphanAcknowledgedById ?? null,
});

// Same defence in depth as every other admin handler here: the route is already
// behind `adminOnly`, and the caller's role is re-checked from the server-side
// session so the handler can never be reached as an admin by any other means.
function requireAdminActor(req, res) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    res.status(403).json({ error: "Forbidden: insufficient role" });
    return false;
  }
  return true;
}

// Stable partition: everything still awaiting a decision first, then the decided
// rows, each group left in the newest-first order the query returned. `status` is a
// plain string, so ordering by it in SQL would sort ALPHABETICALLY and bury every
// pending request at the bottom — the same reason employeeLeave.js sorts in JS.
function sortResignationPendingFirst(requests) {
  const pending = [];
  const decided = [];
  for (const r of requests) {
    (r.status === RESIGNATION_REQUEST_STATUS_DEFAULT ? pending : decided).push(r);
  }
  return [...pending, ...decided];
}

// GET /api/admin/resignation — the admin queue, PENDING FIRST.
//
// An optional `?status=` narrows the view; an unrecognised value is refused rather
// than ignored, so a typo can never silently hide every pending request.
export async function adminListResignationRequests(req, res) {
  if (!requireAdminActor(req, res)) return;
  const requested = req.query?.status;
  if (requested !== undefined && !RESIGNATION_REQUEST_STATUS.includes(requested)) {
    return badRequest(res, `status must be one of: ${RESIGNATION_REQUEST_STATUS.join(", ")}`);
  }

  const where = requested ? { status: requested } : {};
  const requests = await prisma.employeeResignationRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: adminResignationSelect,
  });
  const sorted = sortResignationPendingFirst(requests);

  // The counts always describe the whole queue, never just the filtered slice.
  const counts = { requested: 0, approved: 0, declined: 0 };
  if (requested) {
    const grouped = await prisma.employeeResignationRequest.groupBy({
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
    resignations: sorted.map(adminResignationView),
    counts,
    filter: requested ?? null,
  });
}

// POST /api/admin/resignation/:id/approve
//
// Approving a resignation ENDS the employment relationship. Three writes happen in
// ONE interactive transaction, so the account can never be left half-resigned:
//
//   1. the request itself becomes "approved" (conditional, so two admins racing
//      cannot both win);
//   2. User.role becomes "customer" and presence goes "offline" — the person stays
//      a normal customer who can keep booking. `disabledAt` is deliberately NOT
//      touched: disabling is a separate, admin-controlled access lifecycle;
//   3. every still-PENDING ShiftRequest belonging to that employee is declined
//      (see below).
//
// The employee is read from the STORED request row, never from the body, so no
// client field can decide whose employment ends. `decidedById` is the
// authenticated session admin.
export async function adminApproveResignationRequest(req, res) {
  if (!requireAdminActor(req, res)) return;
  const { id } = req.params;

  const existing = await prisma.employeeResignationRequest.findUnique({
    where: { id },
    select: { id: true, employeeId: true, status: true },
  });
  if (!existing) return res.status(404).json({ error: "Resignation request not found" });
  // A decided request is refused rather than re-decided, so an employee's outcome
  // can never change after the fact.
  if (existing.status !== RESIGNATION_REQUEST_STATUS_DEFAULT) {
    return badRequest(res, `This request was already ${existing.status}`);
  }

  // From the STORED row. There is no employeeId, userId or decidedById parameter
  // or body field anywhere in this handler.
  const employeeId = existing.employeeId;

  // Outstanding work. BookingAssignment is the ONLY source of truth for real work,
  // so the assignments that would be left with nobody holding them are counted here
  // and surfaced to the admin rather than abandoned silently.
  const orphaned = await prisma.bookingAssignment.findMany({
    where: { employeeId, booking: { status: "accepted", archivedAt: null } },
    select: { id: true, bookingId: true },
    orderBy: { assignedAt: "asc" },
  });
  const orphanedCount = orphaned.length;

  let orphanReason = null;
  if (orphanedCount > 0) {
    // Explicit, NOT silent: the admin is told what would be abandoned and must opt
    // in. Without this the approval is refused, so real work is never dropped
    // behind the admin's back.
    if (req.body?.confirmOrphanedAssignments !== true) {
      return res.status(409).json({
        error: "This employee still holds accepted bookings. Confirm abandoning them to proceed.",
        code: "ORPHANED_ASSIGNMENTS",
        orphanedAssignmentCount: orphanedCount,
        orphanedBookingIds: orphaned.map((o) => o.bookingId),
      });
    }
    // WHY the work was abandoned is required whenever the override is used, and
    // WHO/WHEN acknowledged it is recorded. An override with no reason is not an
    // audit trail.
    orphanReason = typeof req.body?.orphanReason === "string" ? req.body.orphanReason.trim() : "";
    if (!orphanReason) return badRequest(res, "A reason is required to abandon outstanding assignments");
    if (!isValidBoundedNote(orphanReason)) return badRequest(res, "orphanReason is too long");
  }

  const now = new Date();
  const adminId = req.user.id;
  const override = orphanedCount > 0;
  let declinedShiftRequests = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // (1) Conditional claim on the request itself: `status = 'requested'` in the
      // WHERE is the race guard, so a concurrent approval matches no row and the
      // whole transaction rolls back rather than double-deciding.
      const claimed = await tx.employeeResignationRequest.updateMany({
        where: { id, status: RESIGNATION_REQUEST_STATUS_DEFAULT },
        data: {
          status: "approved",
          decidedAt: now,
          decidedById: adminId,
          // NULL means no override was used at all, which is distinguishable from
          // an override recorded as 0.
          orphanedAssignmentCount: override ? orphanedCount : null,
          orphanReason,
          orphanAcknowledgedAt: override ? now : null,
          orphanAcknowledgedById: override ? adminId : null,
        },
      });
      if (claimed.count !== 1) {
        const lost = new Error("resignation already decided");
        lost.code = "RESIGNATION_ALREADY_DECIDED";
        throw lost;
      }

      // (2) The role transition. `disabledAt` is NOT in this payload: approving a
      // resignation must not deny a person who is now an ordinary customer, and
      // admin-controlled disabling stays a separate decision (see employees.js).
      await tx.user.update({
        where: { id: employeeId },
        data: { role: ROLES.CUSTOMER, status: "offline" },
        select: { id: true },
      });

      // (3) Every still-pending ShiftRequest for THIS employee is declined.
      //
      // Why: approval flips role to "customer", and `applyBookingAssignment`
      // refuses any target that is not an employee — so a pending request could
      // never be approved again and would sit as a permanently un-actionable
      // "requested" row that still claims the employee wants the work. Declining
      // them records the truth instead.
      //
      // Scoped by BOTH employeeId and status in the WHERE clause, so another
      // employee's requests are unreachable and already-decided rows are never
      // rewritten. This is a targeted conditional UPDATE, never a broad update
      // followed by filtering in JS. `note` is not written: it is the employee's
      // own message, not a decline reason.
      //
      // `decidedById` is the approving admin, which is the same attribution the
      // existing manual decline in shifts.js uses for the requests it auto-declines
      // when a shift is filled. The count is returned so the admin can see exactly
      // what was declined rather than discovering it later.
      const declined = await tx.shiftRequest.updateMany({
        where: { employeeId, status: SHIFT_REQUEST_STATUS_DEFAULT },
        data: { status: "declined", decidedAt: now, decidedById: adminId },
      });
      declinedShiftRequests = declined.count;
    });
  } catch (error) {
    // Lost the race to a concurrent approval: report it as the already-decided case
    // rather than pretending this approval succeeded. The transaction has rolled
    // back, so no role change and no shift-request decline survives it.
    if (error?.code === "RESIGNATION_ALREADY_DECIDED") {
      return badRequest(res, "This request was already decided");
    }
    // The employee's User row vanished between the read and the write. Nothing was
    // committed: the resignation stays "requested" and no shift request was
    // touched, so the admin may safely retry.
    if (error?.code === "P2025") {
      return res.status(404).json({ error: "Employee not found" });
    }
    // A missing table, a dropped connection, any other genuine fault: re-thrown to
    // the central error handler rather than dressed up as a decision problem.
    throw error;
  }

  const row = await prisma.employeeResignationRequest.findUnique({
    where: { id },
    select: adminResignationSelect,
  });
  res.json({
    resignation: adminResignationView(row),
    // Explicit, so the admin learns what the approval did to shift requests.
    declinedShiftRequests,
  });
}
