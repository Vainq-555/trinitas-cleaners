import prisma from "../utils/prisma.js";
import { ROLES, AVAILABILITY_KIND_DEFAULT } from "../config.js";
import {
  badRequest,
  isValidAvailabilityKind,
  isValidAvailabilityWindow,
  isValidBoundedNote,
} from "../utils/validators.js";

// EMPLOYEE AVAILABILITY (Phase 2B-4) — INFORMATIONAL ONLY.
//
// This is "when I am able to work", NOT an assignment and NOT a booking. It
// never reserves work, never appears on a customer's booking, and never grants
// an employee anything. BookingAssignment remains the single source of truth for
// actual work; a shift request is a request (see controllers/shifts.js).
//
// IDENTITY IS NEVER CLIENT-SUPPLIED. The employee id always comes from
// `req.user.id`, never from a body field, query parameter or route parameter:
// there is no "employeeId" input anywhere in this file, so there is nothing for
// a caller to spoof. Employee A therefore cannot read, edit or delete employee
// B's availability by sending a different id.
//
// Every route below is mounted behind `authenticate` + `requireEmployee`.
// `authenticate` re-reads `disabledAt` on each request, so a disabled employee's
// already-issued session stops working on its very next call.

const availabilityView = (a) => ({
  id: a.id,
  // The employee's own id is echoed back for convenience only; it is always the
  // authenticated user and is never used to widen a query.
  employeeId: a.employeeId,
  date: a.date,
  startTime: a.startTime,
  endTime: a.endTime,
  kind: a.kind,
  note: a.note,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

// Fields a client may set, validated together in `readWindowInput`.
function windowFrom(body) {
  return { date: body?.date, startTime: body?.startTime, endTime: body?.endTime };
}

// Shared create/update validation so the two paths can never disagree about
// what a valid window is. Returns null when the input is acceptable.
function validateInput(res, { date, startTime, endTime, kind, note }) {
  if (!isValidAvailabilityWindow({ date, startTime, endTime })) {
    badRequest(
      res,
      "date must be a YYYY-MM-DD date and startTime/endTime a HH:MM 24-hour window with endTime after startTime",
    );
    return false;
  }
  if (kind !== undefined && !isValidAvailabilityKind(kind)) {
    badRequest(res, "kind must be available or unavailable");
    return false;
  }
  if (!isValidBoundedNote(note)) {
    badRequest(res, "note is too long");
    return false;
  }
  return true;
}

// GET /api/employee/availability — the employee's own windows, server-scoped.
export async function listMyAvailability(req, res) {
  const rows = await prisma.employeeAvailability.findMany({
    // Server-scoped, not client-supplied. There is no "all availability" branch.
    where: { employeeId: req.user.id },
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
    select: {
      id: true, employeeId: true, date: true, startTime: true, endTime: true,
      kind: true, note: true, createdAt: true, updatedAt: true,
    },
  });
  res.json({ availability: rows.map(availabilityView) });
}

// POST /api/employee/availability
export async function createMyAvailability(req, res) {
  const { kind, note } = req.body || {};
  const window = windowFrom(req.body);
  if (!validateInput(res, { ...window, kind, note })) return;

  try {
    // employeeId is the session user, unconditionally.
    const row = await prisma.employeeAvailability.create({
      data: {
        employeeId: req.user.id,
        date: window.date,
        startTime: window.startTime,
        endTime: window.endTime,
        kind: kind === undefined ? AVAILABILITY_KIND_DEFAULT : kind,
        note: note ? String(note).trim() : null,
      },
      select: {
        id: true, employeeId: true, date: true, startTime: true, endTime: true,
        kind: true, note: true, createdAt: true, updatedAt: true,
      },
    });
    res.status(201).json({ availability: availabilityView(row) });
  } catch (error) {
    // The composite unique (employeeId, date, startTime, endTime, kind) makes an
    // identical duplicate impossible. Reported as a 400 rather than a 500,
    // because it is the caller repeating a window, not a server fault.
    if (error?.code === "P2002") {
      return badRequest(res, "You have already added that exact availability window");
    }
    throw error;
  }
}

// PATCH /api/employee/availability/:id
//
// The employeeId is part of the WHERE clause, not something compared after the
// fact: a row belonging to another employee simply does not match, so an update
// can never cross the employee boundary even for a single millisecond.
export async function updateMyAvailability(req, res) {
  const { id } = req.params;
  const { kind, note } = req.body || {};
  const body = req.body || {};
  const patch = {};

  if (body.date !== undefined || body.startTime !== undefined || body.endTime !== undefined) {
    // A partial window edit is completed from the STORED row, so editing only
    // the end time cannot silently clear the date or the start.
    const current = await prisma.employeeAvailability.findFirst({
      where: { id, employeeId: req.user.id },
      select: { date: true, startTime: true, endTime: true, kind: true },
    });
    if (!current) return res.status(404).json({ error: "Availability not found" });
    const merged = {
      date: body.date ?? current.date,
      startTime: body.startTime ?? current.startTime,
      endTime: body.endTime ?? current.endTime,
      kind: kind === undefined ? current.kind : kind,
      note,
    };
    if (!validateInput(res, merged)) return;
    patch.date = merged.date;
    patch.startTime = merged.startTime;
    patch.endTime = merged.endTime;
    patch.kind = merged.kind;
    if (note !== undefined) patch.note = note ? String(note).trim() : null;
  } else {
    if (kind !== undefined) {
      if (!isValidAvailabilityKind(kind)) return badRequest(res, "kind must be available or unavailable");
      patch.kind = kind;
    }
    if (!isValidBoundedNote(note)) return badRequest(res, "note is too long");
    if (note !== undefined) patch.note = note ? String(note).trim() : null;
  }

  if (Object.keys(patch).length === 0) {
    return badRequest(res, "Provide at least one field to update");
  }

  // Scoped in the same statement: employeeId can never be reassigned.
  const result = await prisma.employeeAvailability.updateMany({
    where: { id, employeeId: req.user.id },
    data: patch,
  });
  if (result.count === 0) return res.status(404).json({ error: "Availability not found" });

  const row = await prisma.employeeAvailability.findFirst({
    where: { id, employeeId: req.user.id },
    select: {
      id: true, employeeId: true, date: true, startTime: true, endTime: true,
      kind: true, note: true, createdAt: true, updatedAt: true,
    },
  });
  res.json({ availability: availabilityView(row) });
}

// DELETE /api/employee/availability/:id
export async function deleteMyAvailability(req, res) {
  const { id } = req.params;
  // Same scoped delete: another employee's row is never matched, so deleting it
  // is impossible rather than merely rejected afterwards.
  const result = await prisma.employeeAvailability.deleteMany({
    where: { id, employeeId: req.user.id },
  });
  if (result.count === 0) return res.status(404).json({ error: "Availability not found" });
  res.json({ ok: true });
}

// GET /api/admin/availability — the admin reviewing what employees can work.
//
// ADMIN-ONLY, and deliberately the lightest possible review surface: it returns
// WHEN and HOW LONG each employee is free. It contains no booking, customer,
// payment or Stripe data of any kind, because deciding who to schedule does not
// require it.
export async function adminListAvailability(req, res) {
  // Defense in depth: mounted behind adminOnly, re-checked here.
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ error: "Forbidden: insufficient role" });
  }

  const employeeId = typeof req.query?.employeeId === "string" ? req.query.employeeId : undefined;

  const rows = await prisma.employeeAvailability.findMany({
    // An admin MAY filter to one employee (a legitimate review convenience), but
    // an unfiltered listing is also allowed. This is the admin's own read, so a
    // filter here never grants access to anything an admin cannot already see.
    where: employeeId ? { employeeId } : {},
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
    select: {
      id: true, employeeId: true, date: true, startTime: true, endTime: true,
      kind: true, note: true, createdAt: true, updatedAt: true,
      // Name only, for the admin to tell employees apart. No email, phone,
      // address, password hash, token, booking or payment field.
      employee: { select: { name: true } },
    },
  });

  res.json({
    availability: rows.map((a) => ({
      ...availabilityView(a),
      employeeName: a.employee ? a.employee.name : null,
    })),
  });
}
