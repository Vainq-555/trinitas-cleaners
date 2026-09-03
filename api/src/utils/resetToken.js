import crypto from "node:crypto";

// Password-recovery token utilities (pure, testable, no DB / no network).
//
// Security contract:
//   - rawToken is a cryptographically random 256-bit value using crypto.randomBytes.
//   - ONLY the SHA-256 hex digest of the raw token is ever persisted.
//   - the raw token exists ONLY inside the emailed reset URL.
//   - the raw token is never returned from any API response and never logged.
//
// The raw token is base64url-encoded for safe inclusion in a URL query param.

// Tokens are valid for 60 minutes (within the 30–60 min recommended window).
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function generateResetToken() {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { rawToken: raw, tokenHash: hashResetToken(raw) };
}

export function hashResetToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

export function isResetTokenExpired(expiresAt) {
  const deadline = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isNaN(deadline) || deadline <= Date.now();
}