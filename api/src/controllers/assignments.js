import prisma from "../utils/prisma.js";
import { ROLES } from "../config.js";
import { badRequest, isDate } from "../utils/validators.js";

// Booking → employee ASSIGNMENT (Phase 2A foundation).
//
// The customer's Booking row is NEVER modified by an assignment:
//   * Booking.customerId keeps pointing at the customer, always;
//   * Booking.scheduledStartAt (the customer's requested schedule) is never
//     overwritten — the employee's own start is BookingAssignment
//     .scheduledStartAt.
// This file writes only to BookingAssignment, so no existing customer booking is
// ever rewritten and no customer/admin record is touched.

// Admin view of an assignment. Includes the admin-operational fields plus the
// customer's name/phone (which an admin legitimately already sees) and the
// service/location needed to make the assignment.
const adminAssignmentView = (a) => ({
  id: a.id,
  bookingId: a.bookingId,
  employeeId: a.employeeId,
  assignedById: a.assignedById,
  assignedAt: a.assignedAt,
  scheduledStartAt: a.scheduledStartAt,
  visibleToEmployee: a.visibleToEmployee,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  booking: a.booking
    ? {
        id: a.booking.id,
        status: a.booking.status,
        // Shown read-only so an admin can see that the customer's own requested
        // time is preserved and distinct from the employee schedule.
        customerScheduledStartAt: a.booking.scheduledStartAt,
        customerId: a.booking.customerId,
        customerName: a.booking.customer ? a.booking.customer.name : null,
        serviceName: a.booking.service ? a.booking.service.name : null,
      }
    : null,
});

// Shared booking→employee assignment rules (Phase 2B-4).
//
// This is the SINGLE implementation of "how a booking becomes assigned to an
// employee". It is called by the existing admin endpoint AND by the Phase 2B-4
// shift-approval path, deliberately, so that approving a shift request cannot
// drift from the established assignment rules or become a second, laxer
// assignment system.
//
// The rules, unchanged from Phase 2A:
//   * only an ACCEPTED, non-archived booking is assignable;
//   * the target must be an existing, enabled employee;
//   * bookingId is unique, so a booking is never handed to two employees at once;
//   * Booking.customerId and Booking.scheduledStartAt are NEVER written — the
//     employee's own start lives on BookingAssignment.scheduledStartAt;
//   * on reassignment an omitted visibility flag is left exactly as it was, so
//     an admin's deliberate "hidden" decision is never silently undone.
//
// Returns `{ ok: true, assignment, previousEmployeeId }` or
// `{ ok: false, status, error }`. It performs NO authorization: every caller is
// behind `authenticate` + `requireAdmin` and re-checks the caller's own role.
export async function applyBookingAssignment({
  bookingId,
  employeeId,
  scheduledStartAt,
  visibleToEmployee,
  adminId,
}) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, archivedAt: true, customerId: true, scheduledStartAt: true },
  });
  if (!booking) return { ok: false, status: 404, error: "Booking not found" };

  // Only accepted work is assignable. A pending or declined booking is not
  // confirmed work, so it must not reach an employee's assignment view.
  if (booking.status !== "accepted") {
    return { ok: false, status: 400, error: "Only an accepted booking can be assigned to an employee" };
  }
  if (booking.archivedAt) {
    return { ok: false, status: 400, error: "An archived booking cannot be assigned to an employee" };
  }

  const employee = await prisma.user.findUnique({
    where: { id: employeeId },
    select: { id: true, role: true, disabledAt: true },
  });
  if (!employee) return { ok: false, status: 404, error: "Employee not found" };
  if (employee.role !== ROLES.EMPLOYEE) {
    return { ok: false, status: 400, error: "Target user is not an employee" };
  }
  if (employee.disabledAt) {
    return { ok: false, status: 400, error: "Employee account is disabled" };
  }

  // Visibility is EXPLICIT. On a genuinely new assignment an omitted flag keeps
  // the documented default (visible). On a REASSIGNMENT an omitted flag is left
  // alone entirely, so an admin who hid an assignment cannot have that decision
  // silently undone — and so a newly assigned employee is never handed a
  // customer address/phone the admin deliberately withheld. Publishing to a new
  // employee is always an explicit `visibleToEmployee: true`.
  const visibilityPatch = visibleToEmployee === undefined ? {} : { visibleToEmployee };

  // Read-only proof that the customer relationship is untouched: customerId and
  // the customer's own scheduledStartAt are carried through verbatim.
  const assignment = await prisma.bookingAssignment.upsert({
    // bookingId is unique (at most one assigned employee per booking), so
    // re-assigning replaces the record instead of ever handing the same booking
    // to two employees at once.
    where: { bookingId },
    create: {
      bookingId,
      employeeId,
      assignedById: adminId,
      assignedAt: new Date(),
      scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
      visibleToEmployee: visibleToEmployee === undefined ? true : visibleToEmployee,
    },
    update: {
      employeeId,
      assignedById: adminId,
      assignedAt: new Date(),
      // Deliberately NOT inherited by the new employee: a stale start time from
      // a previous assignee is worse than none, so it is reset.
      scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
      ...visibilityPatch,
    },
    select: {
      id: true,
      bookingId: true,
      employeeId: true,
      assignedById: true,
      assignedAt: true,
      scheduledStartAt: true,
      visibleToEmployee: true,
      createdAt: true,
      updatedAt: true,
      booking: {
        select: {
          id: true,
          status: true,
          scheduledStartAt: true,
          customerId: true,
          customer: { select: { name: true } },
          service: { select: { name: true } },
        },
      },
    },
  });

  return {
    ok: true,
    assignment,
  };
}

// POST /api/admin/bookings/:id/assignment
//
// Admin assigns an ACCEPTED booking to an employee. Mounted behind
// `authenticate` + `requireAdmin`, so an employee or customer can never call it;
// the handler also re-checks the target role, because an assignment must never
// be pointable at a customer or an admin.
export async function adminAssignBooking(req, res) {
  // Defense in depth: the route is already `adminOnly`, but the handler re-checks
  // the caller's role so an employee or customer can never create an assignment
  // even if the handler is reached directly.
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Forbidden: insufficient role" });
  }
  const { id } = req.params;
  const { employeeId, scheduledStartAt, visibleToEmployee } = req.body || {};

  if (!employeeId || typeof employeeId !== "string") {
    return badRequest(res, "employeeId is required");
  }
  if (scheduledStartAt !== undefined && scheduledStartAt !== null && !isDate(scheduledStartAt)) {
    return badRequest(res, "scheduledStartAt must be a valid date");
  }
  if (visibleToEmployee !== undefined && typeof visibleToEmployee !== "boolean") {
    return badRequest(res, "visibleToEmployee must be true or false");
  }

  const result = await applyBookingAssignment({
    bookingId: id,
    employeeId,
    scheduledStartAt,
    visibleToEmployee,
    adminId: req.user.id,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  res.status(201).json({ assignment: adminAssignmentView(result.assignment) });
}

// GET /api/employee/assignments
//
// The employee's own work, SERVER-SCOPED. Mounted behind `authenticate` +
// `requireEmployee`. The scope is taken from the authenticated user id and is
// never taken from the query, body or a parameter, so an employee cannot widen
// it, cannot filter it away, and can never see another employee's assignments —
// there is no "all assignments" branch here and assignments are never fetched
// and filtered in JavaScript.
export async function listMyAssignments(req, res) {
  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      employeeId: req.user.id, // server-scoped, not client-supplied
      visibleToEmployee: true,
      // Only confirmed, active work. A pending or declined booking can never
      // leak into an employee's view.
      booking: { status: "accepted", archivedAt: null },
    },
    // Employee SCHEDULE order (the employee's own start time, earliest first),
    // so the work list reads as "what is coming up" rather than "what was most
    // recently handed out". Only the ordering changed in Phase 2B-1 — the
    // server-scoped `where` clause and the projection are untouched.
    orderBy: [
      // An assignment with no admin-set start time has no schedule position, so
      // it sinks below every scheduled assignment rather than sorting as "now".
      { scheduledStartAt: { sort: "asc", nulls: "last" } },
      // Fall back to the customer's requested date so undated assignments still
      // have a meaningful, date-based order.
      { booking: { date: "asc" } },
      // Deterministic tie-breakers, so equal times never reshuffle between loads.
      { assignedAt: "desc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      assignedAt: true,
      // The EMPLOYEE's own schedule (admin-set) — the customer's requested time
      // is intentionally not exposed here.
      scheduledStartAt: true,
      booking: {
        select: {
          id: true,
          date: true,
          // Service location (where the work happens) + the customer's own
          // instructions for it.
          serviceLocationAddressLine1: true,
          serviceLocationAddressLine2: true,
          serviceLocationCity: true,
          serviceLocationState: true,
          serviceLocationPostalCode: true,
          serviceLocationCountry: true,
          serviceLocationInstructions: true,
          service: { select: { id: true, name: true, description: true } },
          // Deliberately narrow: name and phone only. No email, address, id
          // relationship, password, Stripe id, receipt, tax or pricing field is
          // selected, and no unrelated customer bookings are joined in.
          customer: { select: { name: true, phone: true } },
        },
      },
    },
  });

  res.json({
    assignments: assignments.map((a) => ({
      id: a.id,
      assignedAt: a.assignedAt,
      // Employee-assigned start date/time.
      scheduledStartAt: a.scheduledStartAt,
      booking: {
        id: a.booking.id,
        requestedDate: a.booking.date,
        service: a.booking.service,
        location: {
          addressLine1: a.booking.serviceLocationAddressLine1,
          addressLine2: a.booking.serviceLocationAddressLine2,
          city: a.booking.serviceLocationCity,
          state: a.booking.serviceLocationState,
          postalCode: a.booking.serviceLocationPostalCode,
          country: a.booking.serviceLocationCountry,
          instructions: a.booking.serviceLocationInstructions,
        },
        customer: a.booking.customer,
      },
    })),
  });
}
