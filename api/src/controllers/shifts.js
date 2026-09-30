import prisma from "../utils/prisma.js";
import {
  ROLES,
  SHIFT_REQUEST_STATUS_DEFAULT,
} from "../config.js";
import { badRequest, isValidBoundedNote } from "../utils/validators.js";
import { applyBookingAssignment } from "./assignments.js";

// AVAILABLE SHIFTS + SHIFT REQUESTS (Phase 2B-4).
//
// A "shift" is NOT a copy of the booking and NOT an assignment. A ShiftOffer
// points at an existing accepted Booking, and every piece of shift detail
// (service, date, location) is read through that relation, so a shift can never
// disagree with the booking it advertises.
//
// A ShiftRequest is a REQUEST. It never assigns anybody. The ONLY thing that
// creates real work is a BookingAssignment, and approving a request calls the
// very same `applyBookingAssignment` used by the pre-existing admin assignment
// endpoint, so there is exactly one implementation of the assignment rules.
//
// IDENTITY: an employee's id always comes from `req.user.id`. There is no
// employeeId, senderId or user id anywhere in the employee request path.

// The employee-facing projection of a shift.
//
// Deliberately narrow. It includes what an employee needs to decide whether they
// can work, and nothing else. In particular it contains NO customer data at all
// (not even a name): an unassigned pool shift is not the employee's business
// yet, and once a request is approved the employee receives the customer name and
// phone through the existing BookingAssignment view, which is where that
// information legitimately belongs. No payment, price, tax, receipt, Stripe,
// email, address, token, or admin-private note can appear here.
const shiftSelect = {
  id: true,
  notes: true,
  closesAt: true,
  publishedAt: true,
  bookingId: true,
  booking: {
    select: {
      id: true,
      date: true,
      status: true,
      scheduledStartAt: true,
      serviceLocationAddressLine1: true,
      serviceLocationAddressLine2: true,
      serviceLocationCity: true,
      serviceLocationState: true,
      serviceLocationPostalCode: true,
      serviceLocationInstructions: true,
      service: { select: { id: true, name: true, description: true } },
    },
  },
};

const shiftView = (s) => ({
  id: s.id,
  notes: s.notes,
  closesAt: s.closesAt,
  publishedAt: s.publishedAt,
  service: s.booking?.service ?? null,
  requestedDate: s.booking?.date ?? null,
  customerScheduledStartAt: s.booking?.scheduledStartAt ?? null,
  location: {
    addressLine1: s.booking?.serviceLocationAddressLine1 ?? null,
    addressLine2: s.booking?.serviceLocationAddressLine2 ?? null,
    city: s.booking?.serviceLocationCity ?? null,
    state: s.booking?.serviceLocationState ?? null,
    postalCode: s.booking?.serviceLocationPostalCode ?? null,
    instructions: s.booking?.serviceLocationInstructions ?? null,
  },
  // The employee is told plainly whether this work is already taken, so a shift
  // that somebody else holds is never presented as claimable.
  assignedEmployeeId: s.assignment?.employeeId ?? null,
});

// ---------------------------------------------------------------------------
// EMPLOYEE
// ---------------------------------------------------------------------------

// GET /api/employee/shifts — published, still-open, claimable shifts.
//
// A shift is visible only when ALL of the following hold, in the query itself
// rather than in JavaScript:
//   * publishedAt IS NOT NULL  -> a closed/unpublished shift is invisible
//   * closesAt  > now OR NULL  -> an expired shift is invisible
//   * booking.status = accepted AND archivedAt IS NULL
//   * booking has NO assignment
// An assigned booking is therefore never listed here at all — not even for the
// assignee. This page is "AVAILABLE shifts": once work is assigned it is no
// longer available, and the employee sees it (with the customer name and phone)
// on My Assigned Services instead. Anyone who requested it and was approved
// finds the outcome on their request status, which is kept across the offer
// being closed.
export async function listMyShifts(req, res) {
  const now = new Date();
  const shifts = await prisma.shiftOffer.findMany({
    where: {
      publishedAt: { not: null },
      OR: [{ closesAt: null }, { closesAt: { gt: now } }],
      booking: {
        status: "accepted",
        archivedAt: null,
        // A shift already assigned to anyone is not claimable, so it is not
        // offered to the pool at all.
        employeeAssignments: { none: {} },
      },
    },
    orderBy: [{ booking: { date: "asc" } }, { id: "asc" }],
    select: { ...shiftSelect },
  });

  // This employee's own request per shift, so the page can show Requested /
  // Approved / Declined without a second request.
  const requests = await prisma.shiftRequest.findMany({
    where: { employeeId: req.user.id, shiftId: { in: shifts.map((s) => s.id) } },
    select: { id: true, shiftId: true, status: true, createdAt: true, decidedAt: true },
  });
  const byShift = new Map(requests.map((r) => [r.shiftId, r]));

  res.json({
    shifts: shifts.map((s) => {
      const own = byShift.get(s.id) ?? null;
      return {
        ...shiftView(s),
        myRequest: own
          ? { id: own.id, status: own.status, createdAt: own.createdAt, decidedAt: own.decidedAt }
          : null,
        // The list above already guarantees "unassigned + published + open", so
        // the only remaining reason not to request is having asked already.
        canRequest: own === null,
      };
    }),
  });
}

// POST /api/employee/shifts/:id/request
export async function requestShift(req, res) {
  const { id } = req.params;
  const note = req.body?.note;
  if (!isValidBoundedNote(note)) return badRequest(res, "note is too long");

  const shift = await prisma.shiftOffer.findUnique({
    where: { id },
    select: {
      id: true,
      publishedAt: true,
      closesAt: true,
      booking: { select: { id: true, status: true, archivedAt: true } },
    },
  });
  if (!shift) return res.status(404).json({ error: "Shift not found" });

  // Hidden / closed: an unpublished shift must not even be confirmable as
  // existing for a request, let alone requestable.
  if (!shift.publishedAt) return res.status(404).json({ error: "Shift not found" });
  if (shift.closesAt && shift.closesAt <= new Date()) {
    return res.status(400).json({ error: "This shift is closed for requests" });
  }
  if (shift.booking?.status !== "accepted" || shift.booking?.archivedAt) {
    return res.status(400).json({ error: "This shift is no longer available" });
  }

  // A shift already assigned to somebody else is not claimable. The assignee may
  // still see it, but cannot "request" their own existing work either.
  // `booking.id` IS the offer's bookingId (ShiftOffer.bookingId is the FK), so
  // this reads the unique assignment for exactly that booking.
  const assignment = await prisma.bookingAssignment.findUnique({
    where: { bookingId: shift.booking.id },
    select: { employeeId: true },
  });
  if (assignment) {
    return res.status(400).json({ error: "This shift has already been assigned" });
  }

  // Duplicate guard. The DB unique (shiftId, employeeId) is the real guard; this
  // check only produces a friendlier message for the ordinary double-click.
  const existing = await prisma.shiftRequest.findUnique({
    where: { shiftId_employeeId: { shiftId: id, employeeId: req.user.id } },
    select: { id: true, status: true },
  });
  if (existing) {
    return res.status(400).json({ error: "You have already requested this shift" });
  }

  try {
    const request = await prisma.shiftRequest.create({
      data: {
        shiftId: id,
        // Session user only.
        employeeId: req.user.id,
        status: SHIFT_REQUEST_STATUS_DEFAULT,
        note: note ? String(note).trim() : null,
      },
      select: { id: true, shiftId: true, employeeId: true, status: true, createdAt: true },
    });
    res.status(201).json({ request });
  } catch (error) {
    // Two clicks at once, or two tabs: the unique constraint still holds.
    if (error?.code === "P2002") {
      return badRequest(res, "You have already requested this shift");
    }
    throw error;
  }
}

// GET /api/employee/shifts/requests — this employee's own requests across all
// shifts, including shifts that have since closed (so a decision is still
// visible). Server-scoped like every other employee read.
export async function listMyShiftRequests(req, res) {
  const requests = await prisma.shiftRequest.findMany({
    where: { employeeId: req.user.id },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true, status: true, note: true, createdAt: true, decidedAt: true,
      shift: {
        select: {
          id: true, publishedAt: true, closesAt: true,
          booking: {
            select: {
              date: true, scheduledStartAt: true,
              service: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  res.json({
    requests: requests.map((r) => ({
      id: r.id,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      shiftId: r.shift.id,
      service: r.shift?.booking?.service ?? null,
      requestedDate: r.shift?.booking?.date ?? null,
      scheduledStartAt: r.shift?.booking?.scheduledStartAt ?? null,
      // An unpublished shift is no longer an "available shift", so the employee
      // is told it closed rather than being shown a stale offer.
      shiftOpen: Boolean(r.shift?.publishedAt) && (!r.shift?.closesAt || r.shift.closesAt > new Date()),
    })),
  });
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------

function requireAdminActor(req, res) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    res.status(403).json({ error: "Forbidden: insufficient role" });
    return false;
  }
  return true;
}

// The admin view of a shift: the same booking detail plus WHO is asking.
// An admin legitimately needs requester names to decide, so employeeName is
// included here (and ONLY here). Customer data stays out of it: an admin already
// has the booking elsewhere, and this view does not need to duplicate it.
const adminShiftSelect = {
  id: true, bookingId: true, notes: true, closesAt: true, publishedAt: true,
  createdById: true, createdAt: true, updatedAt: true,
  booking: {
    select: {
      id: true, date: true, status: true, archivedAt: true, scheduledStartAt: true,
      serviceLocationAddressLine1: true, serviceLocationAddressLine2: true,
      serviceLocationCity: true, serviceLocationState: true,
      serviceLocationPostalCode: true, serviceLocationInstructions: true,
      service: { select: { id: true, name: true } },
      employeeAssignments: {
        select: {
          employeeId: true, scheduledStartAt: true, visibleToEmployee: true,
          employee: { select: { id: true, name: true } },
        },
      },
    },
  },
  requests: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true, employeeId: true, status: true, note: true, createdAt: true, decidedAt: true,
      // Name only. No email, phone, address, password hash or token.
      employee: { select: { id: true, name: true } },
    },
  },
};

const adminShiftView = (s) => ({
  id: s.id,
  bookingId: s.bookingId,
  notes: s.notes,
  closesAt: s.closesAt,
  publishedAt: s.publishedAt,
  published: Boolean(s.publishedAt),
  createdAt: s.createdAt,
  serviceName: s.booking?.service?.name ?? null,
  requestedDate: s.booking?.date ?? null,
  customerScheduledStartAt: s.booking?.scheduledStartAt ?? null,
  bookingStatus: s.booking?.status ?? null,
  location: {
    addressLine1: s.booking?.serviceLocationAddressLine1 ?? null,
    city: s.booking?.serviceLocationCity ?? null,
    state: s.booking?.serviceLocationState ?? null,
    postalCode: s.booking?.serviceLocationPostalCode ?? null,
    instructions: s.booking?.serviceLocationInstructions ?? null,
  },
  assignment: (s.booking?.employeeAssignments ?? [])[0]
    ? {
        employeeId: s.booking.employeeAssignments[0].employeeId,
        employeeName: s.booking.employeeAssignments[0].employee?.name ?? null,
        scheduledStartAt: s.booking.employeeAssignments[0].scheduledStartAt,
        visibleToEmployee: s.booking.employeeAssignments[0].visibleToEmployee,
      }
    : null,
  requests: (s.requests ?? []).map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee?.name ?? null,
    status: r.status,
    note: r.note,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
  })),
});

// GET /api/admin/shifts
export async function adminListShifts(req, res) {
  if (!requireAdminActor(req, res)) return;
  const shifts = await prisma.shiftOffer.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: adminShiftSelect,
  });
  res.json({ shifts: shifts.map(adminShiftView) });
}

// GET /api/admin/shifts/candidates — accepted, unarchived, un-offered bookings
// that could be published. Reuses Booking rather than duplicating it, and returns
// only the fields needed to choose one. Deliberately omits customer email and
// every payment/Stripe/price field.
export async function adminListShiftCandidates(req, res) {
  if (!requireAdminActor(req, res)) return;

  const bookings = await prisma.booking.findMany({
    where: {
      status: "accepted",
      archivedAt: null,
      shiftOffer: null,
    },
    orderBy: [{ date: "asc" }],
    select: {
      id: true, date: true, scheduledStartAt: true,
      service: { select: { id: true, name: true } },
      serviceLocationCity: true, serviceLocationState: true,
    },
  });

  res.json({
    candidates: bookings.map((b) => ({
      id: b.id,
      serviceName: b.service?.name ?? null,
      requestedDate: b.date,
      scheduledStartAt: b.scheduledStartAt,
      city: b.serviceLocationCity,
      state: b.serviceLocationState,
    })),
  });
}

// POST /api/admin/shifts — publish (or stage) an offer for an existing booking.
export async function adminCreateShift(req, res) {
  if (!requireAdminActor(req, res)) return;
  const { bookingId, notes, closesAt, published } = req.body || {};

  if (!bookingId || typeof bookingId !== "string") {
    return badRequest(res, "bookingId is required");
  }
  if (!isValidBoundedNote(notes)) return badRequest(res, "notes is too long");
  if (closesAt !== undefined && closesAt !== null && Number.isNaN(Date.parse(closesAt))) {
    return badRequest(res, "closesAt must be a valid date");
  }
  if (published !== undefined && typeof published !== "boolean") {
    return badRequest(res, "published must be true or false");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, archivedAt: true },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.status !== "accepted") {
    return badRequest(res, "Only an accepted booking can be offered as a shift");
  }
  if (booking.archivedAt) return badRequest(res, "An archived booking cannot be offered as a shift");

  try {
    const shift = await prisma.shiftOffer.create({
      data: {
        bookingId,
        notes: notes ? String(notes).trim() : null,
        closesAt: closesAt ? new Date(closesAt) : null,
        // Default to published; an admin can stage an unpublished offer by
        // passing published: false. Either way the state is stored server-side.
        publishedAt: published === false ? null : new Date(),
        createdById: req.user.id,
      },
      select: adminShiftSelect,
    });
    res.status(201).json({ shift: adminShiftView(shift) });
  } catch (error) {
    // bookingId is unique: the same work is never offered twice.
    if (error?.code === "P2002") {
      return badRequest(res, "This booking is already offered as a shift");
    }
    throw error;
  }
}

// PATCH /api/admin/shifts/:id — edit the offer, or close/unpublish it.
export async function adminUpdateShift(req, res) {
  if (!requireAdminActor(req, res)) return;
  const { id } = req.params;
  const { notes, closesAt, published } = req.body || {};
  const patch = {};

  if (notes !== undefined) {
    if (!isValidBoundedNote(notes)) return badRequest(res, "notes is too long");
    patch.notes = notes ? String(notes).trim() : null;
  }
  if (closesAt !== undefined) {
    if (closesAt !== null && Number.isNaN(Date.parse(closesAt))) {
      return badRequest(res, "closesAt must be a valid date");
    }
    patch.closesAt = closesAt ? new Date(closesAt) : null;
  }
  if (published !== undefined) {
    if (typeof published !== "boolean") return badRequest(res, "published must be true or false");
    // Closing is stored as publishedAt = null, which is exactly the condition
    // that makes a shift invisible to employees.
    patch.publishedAt = published ? new Date() : null;
  }
  if (Object.keys(patch).length === 0) {
    return badRequest(res, "Provide at least one field to update");
  }

  const result = await prisma.shiftOffer.updateMany({ where: { id }, data: patch });
  if (result.count === 0) return res.status(404).json({ error: "Shift not found" });

  const shift = await prisma.shiftOffer.findUnique({ where: { id }, select: adminShiftSelect });
  res.json({ shift: adminShiftView(shift) });
}

// POST /api/admin/shifts/:id/request/:requestId/approve
//
// THE INTEGRATION POINT. Approving does two things, in this order:
//   1. It runs the EXISTING assignment rules via applyBookingAssignment (the same
//      function behind POST /admin/bookings/:id/assignment): accepted + not
//      archived + target is an enabled employee + bookingId stays 1:1. If those
//      rules refuse, no request is marked approved — the request is left pending.
//   2. Only after a real assignment exists is the request marked approved and the
//      other pending requests for the same shift are declined.
//
// So a request can never look approved while nobody is actually assigned, and
// BookingAssignment stays the only thing that represents work.
export async function adminApproveShiftRequest(req, res) {
  if (!requireAdminActor(req, res)) return;
  const { id, requestId } = req.params;

  const request = await prisma.shiftRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, shiftId: true, employeeId: true, status: true,
      shift: {
        select: {
          id: true, bookingId: true, publishedAt: true,
          booking: { select: { id: true, scheduledStartAt: true } },
        },
      },
    },
  });
  if (!request || request.shiftId !== id) {
    return res.status(404).json({ error: "Shift request not found" });
  }
  // Re-deciding a settled request would rewrite history (and could hand the same
  // work out twice through a second decision path).
  if (request.status !== SHIFT_REQUEST_STATUS_DEFAULT) {
    return badRequest(res, `This request was already ${request.status}`);
  }

  // Explicit, NOT silent: if the booking already has an assignee, the admin is
  // told who holds it and must opt in. Without `confirmReassignment` the request
  // is refused, so an existing assignment is never replaced behind the admin's
  // back.
  const existingAssignment = await prisma.bookingAssignment.findUnique({
    where: { bookingId: request.shift.bookingId },
    select: { employeeId: true, employee: { select: { name: true } } },
  });
  if (existingAssignment && existingAssignment.employeeId !== request.employeeId) {
    if (req.body?.confirmReassignment !== true) {
      return res.status(409).json({
        error: "This shift is already assigned to another employee. Confirm the reassignment to proceed.",
        assignedEmployeeId: existingAssignment.employeeId,
        assignedEmployeeName: existingAssignment.employee?.name ?? null,
      });
    }
  }

  const result = await applyBookingAssignment({
    bookingId: request.shift.bookingId,
    // The employee is the REQUESTING employee, taken from the stored request —
    // never from a client body field.
    employeeId: request.employeeId,
    // Keep the booking's own requested time as the employee's start, so the
    // existing scheduledStartAt behavior is preserved rather than reinvented.
    scheduledStartAt: request.shift.booking?.scheduledStartAt ?? null,
    // The requester must be able to SEE the assignment they just won, so this is
    // published explicitly rather than relying on a default.
    visibleToEmployee: true,
    adminId: req.user.id,
  });
  if (!result.ok) {
    // The request stays pending: a failed assignment never leaves a "ghost
    // approval" behind.
    return res.status(result.status).json({ error: result.error });
  }

  const now = new Date();
  const [, declined] = await prisma.$transaction([
    prisma.shiftRequest.update({
      where: { id: requestId },
      data: { status: "approved", decidedAt: now, decidedById: req.user.id },
      select: { id: true, status: true, decidedAt: true },
    }),
    // The shift now has an employee, so every other pending request for it is
    // declined in the same transaction — the pool can never hold two open claims.
    prisma.shiftRequest.updateMany({
      where: { shiftId: id, status: SHIFT_REQUEST_STATUS_DEFAULT, id: { not: requestId } },
      data: { status: "declined", decidedAt: now, decidedById: req.user.id },
    }),
  ]);

  // The shift is no longer an open offer: close it so it leaves the pool.
  await prisma.shiftOffer.updateMany({ where: { id }, data: { publishedAt: null } });

  res.json({
    approved: { id: requestId, status: "approved", decidedAt: now },
    declinedOthers: declined.count,
    assignment: {
      id: result.assignment.id,
      bookingId: result.assignment.bookingId,
      employeeId: result.assignment.employeeId,
      scheduledStartAt: result.assignment.scheduledStartAt,
      visibleToEmployee: result.assignment.visibleToEmployee,
    },
    reassignedFrom: existingAssignment && existingAssignment.employeeId !== request.employeeId
      ? existingAssignment.employeeId
      : null,
  });
}

// POST /api/admin/shifts/:id/request/:requestId/decline
export async function adminDeclineShiftRequest(req, res) {
  if (!requireAdminActor(req, res)) return;
  const { id, requestId } = req.params;

  const request = await prisma.shiftRequest.findUnique({
    where: { id: requestId },
    select: { id: true, shiftId: true, employeeId: true, status: true },
  });
  if (!request || request.shiftId !== id) {
    return res.status(404).json({ error: "Shift request not found" });
  }
  if (request.status !== SHIFT_REQUEST_STATUS_DEFAULT) {
    return badRequest(res, `This request was already ${request.status}`);
  }

  const now = new Date();
  const updated = await prisma.shiftRequest.update({
    where: { id: requestId },
    data: { status: "declined", decidedAt: now, decidedById: req.user.id },
    select: { id: true, status: true, decidedAt: true },
  });
  res.json({ request: updated });
}
