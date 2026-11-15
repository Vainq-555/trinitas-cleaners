import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_RETRY_BASE_MS,
  HEARTBEAT_RETRY_MAX_MS,
  parseRetryAfterMs,
  isRetryableStatus,
  isAuthFailure,
  heartbeatRetryDelayMs,
  heartbeatDelayAfter,
} from "../lib/requestResilience.mjs";

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const HTTP_NOW = Date.UTC(2026, 0, 1, 0, 0, 0);
const retryAfterDelay = (value, { attempt = 0, now = HTTP_NOW } = {}) =>
  heartbeatDelayAfter({
    ok: false,
    status: 429,
    retryAfterMs: parseRetryAfterMs(value, now),
    attempt,
    random: () => 0,
  });

test("parseRetryAfterMs accepts delta-seconds", () => {
  assert.equal(parseRetryAfterMs("0"), 0);
  assert.equal(parseRetryAfterMs("120"), 120_000);
  assert.equal(parseRetryAfterMs(" 30 "), 30_000);
});

test("parseRetryAfterMs accepts an HTTP-date and clamps past dates to zero", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const future = new Date(now + 30_000).toUTCString();
  const past = new Date(now - 30_000).toUTCString();
  assert.equal(parseRetryAfterMs(future, now), 30_000);
  assert.equal(parseRetryAfterMs(past, now), 0);
});

test("parseRetryAfterMs ignores missing and invalid values", () => {
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs(undefined), null);
  assert.equal(parseRetryAfterMs(""), null);
  assert.equal(parseRetryAfterMs("not-a-date"), null);
  assert.equal(parseRetryAfterMs("-5"), null);
});

test("Retry-After: 0 cannot produce a zero-delay heartbeat retry", () => {
  assert.equal(parseRetryAfterMs("0", HTTP_NOW), 0);
  assert.equal(retryAfterDelay("0"), HEARTBEAT_RETRY_BASE_MS);
});

test("a past Retry-After HTTP date cannot produce a zero-delay heartbeat retry", () => {
  const past = new Date(HTTP_NOW - 30_000).toUTCString();
  assert.equal(parseRetryAfterMs(past, HTTP_NOW), 0);
  assert.equal(retryAfterDelay(past), HEARTBEAT_RETRY_BASE_MS);
});

test("a normal Retry-After delta-seconds value is respected", () => {
  assert.equal(retryAfterDelay("120"), 120_000);
});

test("a normal future Retry-After HTTP date is respected", () => {
  const future = new Date(HTTP_NOW + 120_000).toUTCString();
  assert.equal(retryAfterDelay(future), 120_000);
});

test("an excessive Retry-After delta-seconds value is capped", () => {
  assert.equal(retryAfterDelay("999999999"), HEARTBEAT_RETRY_MAX_MS);
});

test("a far-future Retry-After HTTP date is capped", () => {
  const farFuture = new Date(HTTP_NOW + 10 * 365 * 24 * 60 * 60 * 1000).toUTCString();
  assert.equal(retryAfterDelay(farFuture), HEARTBEAT_RETRY_MAX_MS);
});

test("missing and malformed Retry-After values keep the backoff fallback", () => {
  for (const value of [null, undefined, "", "not-a-date", "-5"]) {
    assert.equal(parseRetryAfterMs(value, HTTP_NOW), null);
    assert.equal(retryAfterDelay(value), HEARTBEAT_RETRY_BASE_MS);
  }
});

test("explicit Retry-After delays always stay within heartbeat bounds", () => {
  const values = [
    "0",
    "1",
    "30",
    "120",
    "300",
    "301",
    "999999999",
    new Date(HTTP_NOW - 30_000).toUTCString(),
    new Date(HTTP_NOW + 120_000).toUTCString(),
    new Date(HTTP_NOW + 10 * 365 * 24 * 60 * 60 * 1000).toUTCString(),
  ];

  for (const value of values) {
    const parsed = parseRetryAfterMs(value, HTTP_NOW);
    assert.equal(Number.isFinite(parsed), true);

    const delay = retryAfterDelay(value);
    assert.ok(delay >= HEARTBEAT_RETRY_BASE_MS);
    assert.ok(delay <= HEARTBEAT_RETRY_MAX_MS);
    assert.equal(
      heartbeatRetryDelayMs(0, { retryAfterMs: parsed, random: () => 0 }),
      delay,
    );
  }
});

test("retryable statuses are limited to transient upstream failures", () => {
  for (const status of [408, 429, 502, 503, 504]) {
    assert.equal(isRetryableStatus(status), true);
  }
  for (const status of [400, 401, 403, 404, 500]) {
    assert.equal(isRetryableStatus(status), false);
  }
  assert.equal(isAuthFailure(401), true);
  assert.equal(isAuthFailure(403), true);
  assert.equal(isAuthFailure(429), false);
});

test("heartbeat retry delay grows exponentially and stays bounded", () => {
  assert.equal(heartbeatRetryDelayMs(0, { random: () => 0 }), HEARTBEAT_RETRY_BASE_MS);
  assert.equal(heartbeatRetryDelayMs(1, { random: () => 0 }), HEARTBEAT_RETRY_BASE_MS * 2);
  assert.equal(heartbeatRetryDelayMs(2, { random: () => 0 }), HEARTBEAT_RETRY_BASE_MS * 4);
  assert.equal(heartbeatRetryDelayMs(10, { random: () => 0 }), HEARTBEAT_RETRY_MAX_MS);
  assert.equal(heartbeatRetryDelayMs(100, { random: () => 0 }), HEARTBEAT_RETRY_MAX_MS);
});

test("heartbeat retry delay adds bounded jitter", () => {
  const low = heartbeatRetryDelayMs(0, { random: () => 0 });
  const high = heartbeatRetryDelayMs(0, { random: () => 0.999999 });
  assert.equal(low, HEARTBEAT_RETRY_BASE_MS);
  assert.ok(high > low);
  assert.ok(high <= HEARTBEAT_RETRY_BASE_MS + 5_000);
});

test("a server Retry-After value takes precedence over exponential backoff", () => {
  assert.equal(
    heartbeatRetryDelayMs(3, { retryAfterMs: 120_000, random: () => 0.5 }),
    120_000,
  );
  assert.equal(
    heartbeatDelayAfter({ ok: false, status: 429, retryAfterMs: 90_000, attempt: 2 }),
    90_000,
  );
});

test("heartbeat delay decisions stop on auth failure and back off transient errors", () => {
  assert.equal(
    heartbeatDelayAfter({ ok: true, attempt: 4, random: () => 0 }),
    HEARTBEAT_INTERVAL_MS,
  );
  assert.equal(
    heartbeatDelayAfter({ ok: false, status: 401, attempt: 0 }),
    null,
  );
  assert.equal(
    heartbeatDelayAfter({ ok: false, status: 403, attempt: 0 }),
    null,
  );
  assert.equal(
    heartbeatDelayAfter({ ok: false, status: 429, attempt: 0, random: () => 0 }),
    HEARTBEAT_RETRY_BASE_MS,
  );
  assert.equal(
    heartbeatDelayAfter({ ok: false, status: undefined, attempt: 1, random: () => 0 }),
    HEARTBEAT_RETRY_BASE_MS * 2,
  );
  assert.equal(
    heartbeatDelayAfter({ ok: false, status: 500, attempt: 1, random: () => 0 }),
    HEARTBEAT_INTERVAL_MS,
  );
});

test("auth provider no longer starts an overlapping fixed heartbeat", () => {
  const auth = source("../lib/auth.jsx");
  assert.doesNotMatch(auth, /setInterval\s*\(/);
  assert.match(auth, /heartbeatDelayAfter/);
  assert.match(auth, /if \(!user\) return undefined;/);
  assert.match(auth, /heartbeatInFlightRef/);
  assert.match(auth, /clearTimeout/);
});

test("api wrapper exposes Retry-After without retrying automatically", () => {
  const api = source("../lib/api.js");
  assert.match(api, /parseRetryAfterMs/);
  assert.match(api, /err\.retryAfterMs/);
  assert.match(api, /Retries are deliberately NOT automatic/);
  assert.doesNotMatch(api, /while\s*\(|for\s*\(/);
});
