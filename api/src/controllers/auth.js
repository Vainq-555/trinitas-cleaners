import prisma from "../utils/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signToken } from "../utils/jwt.js";
import { COOKIE_NAME, COOKIE_SECURE, ROLES } from "../config.js";
import { badRequest, isEmail } from "../utils/validators.js";
import { createRecoveryRateLimiters } from "../utils/rateLimit.js";
import { requestPasswordReset, performPasswordReset, isValidNewPassword } from "../utils/passwordRecovery.js";
import { activateWithToken } from "../utils/employeeInvitation.js";

// Lightweight in-memory rate limiter for the recovery flow (see rateLimit.js).
const recoveryLimits = createRecoveryRateLimiters();

// Separate counters for the employee-activation flow, which is also an
// unauthenticated endpoint that sets a credential and so carries the same
// brute-force posture as password recovery.
const activationLimits = createRecoveryRateLimiters();

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  address: u.address,
  role: u.role,
  status: u.status,
  lastActiveAt: u.lastActiveAt,
});

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export async function register(req, res) {
  const { name, email, password, phone, address } = req.body || {};

  if (!name || !isEmail(email) || !password || password.length < 8) {
    return badRequest(res, "Name, a valid email, and a password of 8+ characters are required");
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return badRequest(res, "An account with this email already exists");

  // PUBLIC REGISTRATION IS CUSTOMER-ONLY. The role is server-assigned here and
  // `req.body.role` is never read, so a public registration can never create an
  // employee (or an admin) no matter what the request contains. Employees are
  // created by admins only, via POST /admin/employees.
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      phone: phone || null,
      address: address || null,
      role: ROLES.CUSTOMER,
      status: "online",
      lastActiveAt: new Date(),
    },
  });

  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ token, user: publicUser(user) });
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!isEmail(email) || !password) return badRequest(res, "Email and password are required");

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // A DISABLED account is refused only AFTER the password has verified, and this
  // is deliberate on both sides of that ordering:
  //
  //   - After, so a wrong password (or an unknown email) still fails with the
  //     generic "Invalid email or password". Checking disabledAt first would let
  //     anyone learn which emails belong to a disabled account, just by reading
  //     the difference between the two responses.
  //   - Before the presence write and before the token/cookie, so a disabled
  //     account is never marked online, has lastActiveAt left untouched, and
  //     receives no session at all.
  //
  // The wording matches `authenticate` (middleware/auth.js), which refuses any
  // already-issued token on the very next request, so a disabled account is told
  // the same thing whether it signs in or presents a stale session.
  if (user.disabledAt) return res.status(401).json({ error: "Account is disabled" });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { status: "online", lastActiveAt: new Date() },
  });

  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ token, user: publicUser(updated) });
}

export async function logout(req, res) {
  if (req.user) {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { status: "offline", lastActiveAt: new Date() },
    });
  }
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
}

export async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

// Keeps the session fresh and reports online/offline to admin dashboards.
export async function heartbeat(req, res) {
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { status: "online", lastActiveAt: new Date() },
  });
  res.json({ user: publicUser(user) });
}

// Customer profile editing.
export async function updateProfile(req, res) {
  const { name, phone, address } = req.body || {};
  const data = {};
  if (name !== undefined) {
    if (!name.trim()) return badRequest(res, "Name cannot be empty");
    data.name = name.trim();
  }
  if (phone !== undefined) data.phone = phone || null;
  if (address !== undefined) data.address = address || null;

  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ user: publicUser(user) });
}

// "Delete Account" — removes the customer and their bookings/receipts (cascade).
export async function deleteAccount(req, res) {
  if (req.user.role === ROLES.ADMIN) {
    return badRequest(res, "Admins cannot delete themselves through this endpoint");
  }
  // Employee accounts are ADMIN-CONTROLLED: an admin disables/reactivates them
  // (never deletes), and their User row is the anchor for their assignment
  // history. An employee may not remove their own record here, which also stops
  // an employee from cascading away history that must be preserved.
  if (req.user.role === ROLES.EMPLOYEE) {
    return badRequest(res, "Employee accounts cannot be deleted; an administrator manages employee access");
  }
  // A FORMER employee is protected exactly the same way, even though their role is
  // now "customer" and so no longer matches the check above.
  //
  // Why this is a separate check rather than a role check: an approved resignation
  // transitions the role to "customer", so role alone can no longer tell "a person
  // who was never an employee" from "an employee whose employment has ended".
  // Inferring it from the role would forbid self-deletion for every ordinary
  // customer, so it is NOT done. The approved resignation request is the actual
  // source of truth for "this account carries employment records that must
  // survive", and the role transition deliberately added no User column that could
  // answer the question on its own.
  //
  // Without this, the role flip would quietly reopen self-deletion for someone whose
  // User row is the anchor for their assignment history: deleting it cascades that
  // history away, which is exactly what the employee rule above exists to prevent.
  //
  // Existence only — the index is (employeeId, status), and the projection is a
  // single id, so this is an index-only lookup rather than a history read. No
  // ordering is needed: the question is whether ANY approved request exists, so
  // which one is newest is irrelevant. `employeeId` is `req.user.id` and nothing is
  // read from the body, query or path, so this can only ever describe the caller's
  // OWN employment history and cannot be pointed at another account.
  const approvedResignation = await prisma.employeeResignationRequest.findFirst({
    where: { employeeId: req.user.id, status: "approved" },
    select: { id: true },
  });
  if (approvedResignation) {
    return badRequest(res, "This account cannot be deleted; an administrator manages employee records");
  }
  await prisma.user.delete({ where: { id: req.user.id } });
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
}

// POST /api/auth/forgot-password
// Enumeration-safe: returns the same message whether or not the email exists.
// Rate-limited per IP and per normalized email (sliding window; no permanent
// block). Never returns or logs the raw token.
export async function forgotPassword(req, res) {
  const { email } = req.body || {};

  if (!isEmail(email)) {
    // Keep the response shape consistent with the public message.
    return badRequest(res, "Email and password are required");
  }

  const normalized = email.trim().toLowerCase();
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  if (!recoveryLimits.byIp.allow(ip)) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }
  if (!recoveryLimits.byEmail.allow(normalized)) {
    return res.status(429).json({ error: "Too many requests for this email. Please try again later." });
  }

  recoveryLimits.byIp.record(ip);
  recoveryLimits.byEmail.record(normalized);

  // requestPasswordReset never rejects for account existence and always returns
  // the same public message regardless of delivery outcome.
  const result = await requestPasswordReset(normalized);
  res.json({ message: result.message });
}

// POST /api/auth/reset-password
// Redeems a single-use raw token. Safe fail messages only; never reveals
// whether a token was previously valid, never leaks tokens or passwords.
export async function resetPassword(req, res) {
  const { token, password } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }
  if (!isValidNewPassword(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (req.body.confirm && password !== req.body.confirm) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  const result = await performPasswordReset(token, password);
  if (!result.ok) {
    // Invalid / expired / already-used tokens all fail identically.
    return res.status(result.status || 400).json({ error: "Invalid or expired reset link" });
  }

  res.json({ ok: true });
}

// POST /api/auth/employee-activation
// Redeems a single-use employee invitation token and lets the invitee set their
// own first password. This is the ONLY way an employee account gains a usable
// password — the admin never sets, sees or receives it.
//
// The subject account is resolved from the token record alone: the request
// carries no user id, so it cannot activate anyone but the invitee. Unknown,
// expired, already-used, wrong-role and disabled cases all fail identically, so
// the response never reveals whether an account exists. Rate-limited per IP like
// the recovery flow. The employee is not logged in automatically; they sign in
// with the password they just chose.
export async function activateEmployeeAccount(req, res) {
  const { token, password } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: "Invalid or expired invitation link" });
  }
  if (!isValidNewPassword(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (req.body.confirm && password !== req.body.confirm) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (!activationLimits.byIp.allow(ip)) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }
  activationLimits.byIp.record(ip);

  const result = await activateWithToken(token, password);
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: "Invalid or expired invitation link" });
  }

  res.json({ ok: true });
}
