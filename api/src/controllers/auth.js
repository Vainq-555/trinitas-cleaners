import prisma from "../utils/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signToken } from "../utils/jwt.js";
import { COOKIE_NAME, COOKIE_SECURE, ROLES } from "../config.js";
import { badRequest, isEmail } from "../utils/validators.js";
import { createRecoveryRateLimiters } from "../utils/rateLimit.js";
import { requestPasswordReset, performPasswordReset, isValidNewPassword } from "../utils/passwordRecovery.js";

// Lightweight in-memory rate limiter for the recovery flow (see rateLimit.js).
const recoveryLimits = createRecoveryRateLimiters();

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