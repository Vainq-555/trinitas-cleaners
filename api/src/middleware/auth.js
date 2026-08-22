import { verifyToken } from "../utils/jwt.js";
import { COOKIE_NAME, ROLES, ONLINE_TTL_MS } from "../config.js";
import prisma from "../utils/prisma.js";

// Reads the JWT from an httpOnly cookie (preferred) or Authorization header.
export function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

// Loads the current user and records "last active" (drives online/offline).
export async function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "Session expired or invalid" });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return res.status(401).json({ error: "Account no longer exists" });

  req.user = user;

  // Heartbeat: refresh lastActiveAt in the background without blocking.
  const idle = user.lastActiveAt ? Date.now() - user.lastActiveAt.getTime() : Infinity;
  if (idle > ONLINE_TTL_MS / 2) {
    prisma.user
      .update({ where: { id: user.id }, data: { status: "online", lastActiveAt: new Date() } })
      .catch(() => {});
  }

  next();
}

// RBAC: requireRole("admin") — strictly separates admin and customer routes.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    next();
  };
}

export const requireAdmin = requireRole(ROLES.ADMIN);
export const requireCustomer = requireRole(ROLES.CUSTOMER);