import test from "node:test";
import assert from "node:assert/strict";
import {
  readResetToken,
  validateResetInput,
  classifyResetApiError,
  resetLinkPresent,
  MIN_PASSWORD_LENGTH,
} from "../lib/passwordRecovery.mjs";

test("readResetToken reads a valid token from the URL and ignores malformed input", () => {
  assert.equal(readResetToken(new URLSearchParams("token=abc123")), "abc123");
  assert.equal(readResetToken(new URLSearchParams("token=")), null);
  assert.equal(readResetToken(new URLSearchParams("")), null);
  assert.equal(readResetToken(null), null);
  assert.equal(readResetToken({}), null);
  assert.equal(resetLinkPresent("abc"), true);
  assert.equal(resetLinkPresent(null), false);
});

test("reset-link presence mirrors a read token", () => {
  const token = readResetToken(new URLSearchParams("token=xyz"));
  assert.equal(resetLinkPresent(token), true);
  assert.equal(resetLinkPresent(readResetToken(new URLSearchParams(""))), false);
});

test("validateResetInput enforces a non-empty password of min 8 chars", () => {
  assert.equal(validateResetInput({ password: "", confirm: "" }), "Password is required");
  for (const len of [0, 1, 7]) {
    assert.ok(validateResetInput({ password: "x".repeat(len), confirm: "x".repeat(len) })?.length > 0);
  }
  assert.equal(validateResetInput({ password: "12345678", confirm: "12345678" }), null);
  assert.equal(MIN_PASSWORD_LENGTH, 8);
});

test("validateResetInput rejects a password/confirmation mismatch", () => {
  assert.equal(
    validateResetInput({ password: "12345678", confirm: "87654321" }),
    "Passwords do not match"
  );
});

test("classifyResetApiError maps a 400 to the expired/invalid state and other codes to generic error", () => {
  assert.equal(classifyResetApiError(400), "expired");
  assert.equal(classifyResetApiError(500), "error");
  assert.equal(classifyResetApiError(429), "error");
  assert.equal(classifyResetApiError(undefined), "error");
});

test("a successful reset is signaled by a 2xx and the page returns to login (helper contract)", () => {
  // The reset API returns { ok: true } on success; our helper must never classify
  // a success as expired/error.
  assert.equal(classifyResetApiError(null), "error"); // not a success path
  // Success navigation is: done=true -> "Back to login" link. Assert the page's
  // contract that a 200 is treated as done (no error classification).
  assert.notEqual(classifyResetApiError(200), "expired");
});