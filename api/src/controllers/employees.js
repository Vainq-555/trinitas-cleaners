import prisma from "../utils/prisma.js";
import { ROLES } from "../config.js";
import { badRequest, isEmail, isValidPhone } from "../utils/validators.js";
import { createUnusablePasswordHash, issueInvitation } from "../utils/employeeInvitation.js";

// ADMIN-ONLY employee account management (Phase 2A foundation).
//
// Every route in this file is mounted behind `authenticate` + `requireAdmin`.
// Nothing here is reachable by a customer or by an employee, and the handlers
// additionally verify the TARGET is an employee before acting, so an employee
// (or customer) id can never be driven through the admin endpoints even by a
// future caller that forgets the guard.

// Whitelisted administrative projection. passwordHash is never selected, so it
// cannot be returned even by accident; neither is any invitation token/hash, or
// any customer, booking, receipt or payment data.
const employeeSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  lastActiveAt: true,
  createdAt: true,
  disabledAt: true,
};

const adminEmployeeView = (e) => ({
  id: e.id,
  name: e.name,
  email: e.email,
  phone: e.phone,
  role: e.role,
  status: e.status,
  lastActiveAt: e.lastActiveAt,
  createdAt: e.createdAt,
  disabledAt: e.disabledAt,
  // Historical assignment count. Kept as a number only — the assignment rows
  // themselves are not exposed here, and a disabled employee's count is
  // preserved so their work history stays visible and intact.
  assignmentCount: e._count ? e._count.employeeAssignments : null,
});

const defaultDeps = { issueInvitation };

// Defense in depth for the admin-only actions. These routes are already mounted
// behind `authenticate` + `requireAdmin`, but the handlers re-check the CALLER's
// role too, so an employee (or customer) can never drive an admin action even if
// a handler is ever reached directly. Returns true when the request may proceed.
function requireAdminActor(req, res) {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    res.status(403).json({ error: "Forbidden: insufficient role" });
    return false;
  }
  return true;
}

// GET /api/admin/employees
export async function adminListEmployees(req, res) {
  const employees = await prisma.user.findMany({
    // EXPLICIT role filter only. Never "not customer" or "not admin", which
    // would silently sweep in any future role.
    where: { role: ROLES.EMPLOYEE },
    // Active employees lead, disabled employees sink. Postgres defaults to
    // NULLS LAST for ASC, so "nulls: first" is explicit and required here:
    // without it the disabled accounts would be listed first.
    orderBy: [{ disabledAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: { ...employeeSelect, _count: { select: { employeeAssignments: true } } },
  });
  res.json({ employees: employees.map(adminEmployeeView) });
}

// POST /api/admin/employees — create an employee account and issue its
// single-use invitation. Employees are NEVER self-created: this is the only way
// an employee account comes into existence.
//
// `deps` is dependency-injected as the FOURTH parameter (the same style as
// sendBookingConfirmationEmail in utils/mail.js). Express only ever passes
// (req, res, next), so production always gets the real default deps; tests build
// their own with a stubbed invitation issuer and never touch a mail provider.
export async function adminCreateEmployee(req, res, _next, deps = defaultDeps) {
  const { issueInvitation: issue } = deps;
  if (!requireAdminActor(req, res)) return;
  const { name, email, phone } = req.body || {};

  if (typeof name !== "string" || !name.trim()) {
    return badRequest(res, "Name is required");
  }
  if (!isEmail(email)) {
    return badRequest(res, "A valid email is required");
  }
  if (phone !== undefined && phone !== null && phone !== "" && !isValidPhone(phone)) {
    return badRequest(res, "Enter a valid phone number");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (exists) return badRequest(res, "An account with this email already exists");

  // The role is hard-coded. `role` is never read from the request, so a caller
  // can neither create an admin nor escalate anything through this endpoint.
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      // The employee gets NO usable password: this is the hash of 256 bits of
      // random data. They must set their own password via the invitation, so the
      // admin can never know or choose it.
      passwordHash: await createUnusablePasswordHash(),
      phone: phone || null,
      role: ROLES.EMPLOYEE,
      status: "offline",
      lastActiveAt: null,
      disabledAt: null,
    },
    select: employeeSelect,
  });

  const result = await issue(user);
  if (!result.ok) {
    // Roll the brand-new account back so a failed send cannot leave an
    // unreachable employee behind. This deletes only rows created moments ago by
    // this very request — it is NOT the disable/reactivate path, and a brand-new
    // employee has no booking, receipt, assignment or history to lose. A failed
    // cleanup is tolerated: either way the account holds no usable password and
    // no valid invitation, so it cannot be logged into.
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    return res.status(502).json({
      error: "Invitation email could not be sent; the employee account has no usable password and no active invitation",
    });
  }

  // The raw invitation token is NEVER returned — only its expiry, which the
  // admin needs and which grants nothing on its own.
  res.status(201).json({ employee: adminEmployeeView(user), invitationExpiresAt: result.expiresAt });
}

// POST /api/admin/employees/:id/disable
//
// Sets User.disabledAt. NEVER deletes the user, and never cascades: identity,
// booking assignments and all history remain intact. Because `authenticate`
// re-reads the user and rejects a disabled account, every existing session for
// that employee stops being authorized on its next request.
export async function adminDisableEmployee(req, res) {
  if (!requireAdminActor(req, res)) return;
  const { id } = req.params;
  const employee = await prisma.user.findUnique({ where: { id }, select: employeeSelect });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  if (employee.role !== ROLES.EMPLOYEE) {
    return badRequest(res, "Target user is not an employee");
  }
  if (employee.disabledAt) {
    // Idempotent: already disabled, nothing changes.
    return res.json({ employee: adminEmployeeView(employee) });
  }

  const disabledAt = new Date();
  // `status` is touched only to keep PRESENCE truthful (a disabled employee is
  // not online). It is never used as the account lifecycle — that is disabledAt.
  const updated = await prisma.user.update({
    where: { id },
    data: { disabledAt, status: "offline" },
    select: employeeSelect,
  });

  // Invalidate any outstanding invitation, so a disabled employee cannot
  // activate their account while disabled.
  await prisma.employeeInvitation.updateMany({
    where: { userId: id, usedAt: null },
    data: { usedAt: disabledAt },
  });

  res.json({ employee: adminEmployeeView(updated) });
}

// POST /api/admin/employees/:id/reactivate
//
// Clears User.disabledAt. Never deletes the user, never re-creates it, and never
// touches assignments or history — the SAME account and employee identity resume.
export async function adminReactivateEmployee(req, res) {
  if (!requireAdminActor(req, res)) return;
  const { id } = req.params;
  const employee = await prisma.user.findUnique({ where: { id }, select: employeeSelect });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  if (employee.role !== ROLES.EMPLOYEE) {
    return badRequest(res, "Target user is not an employee");
  }
  if (!employee.disabledAt) {
    // Idempotent: already active, nothing changes.
    return res.json({ employee: adminEmployeeView(employee) });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { disabledAt: null },
    select: employeeSelect,
  });

  res.json({ employee: adminEmployeeView(updated) });
}
