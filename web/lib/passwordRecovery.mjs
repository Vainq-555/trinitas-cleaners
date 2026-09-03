// Pure helpers for the password-recovery pages. Extracted into a plain .mjs
// module so the UI logic is unit-testable with the project's existing
// `node --test` harness (which does not include a React test renderer).

export const MIN_PASSWORD_LENGTH = 8;

// Reads the single-use reset token from the URL query params and returns it, or
// null when absent/malformed. Never stored in persistent browser storage.
export function readResetToken(searchParams) {
  const token = searchParams?.get?.("token") ?? "";
  const value = typeof token === "string" ? token.trim() : "";
  return value.length > 0 ? value : null;
}

// Validates the new-password + confirmation fields. Returns an error message or
// null when valid. Mirrors the backend's password policy (min 8 chars, non-empty).
export function validateResetInput({ password, confirm }) {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (confirm !== password) {
    return "Passwords do not match";
  }
  return null;
}

// Maps an API error to a recoverable page state.
//   "expired" -> invalid/expired/used link (show the expired card)
//   "error"   -> transient generic error (show message, allow retry)
export function classifyResetApiError(status) {
  return status === 400 ? "expired" : "error";
}

// Resets the raw token variable is consumed by the caller only; this helper
// keeps the "token present?" decision in one place for the page.
export function resetLinkPresent(token) {
  return token !== null && token.length > 0;
}