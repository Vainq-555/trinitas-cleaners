export const HEARTBEAT_INTERVAL_MS = 60_000;
export const HEARTBEAT_RETRY_BASE_MS = 60_000;
export const HEARTBEAT_RETRY_MAX_MS = 5 * 60_000;

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

// Retry-After is either delta-seconds or an HTTP-date. Invalid values are ignored.
export function parseRetryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  // Reject signed numbers before Date.parse, which treats "-5" as a year.
  if (/^[+-]/.test(text)) return null;

  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

export function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(status);
}

export function isAuthFailure(status) {
  return status === 401 || status === 403;
}

// Keep an explicit Retry-After inside the same range as our own backoff. This
// prevents zero/past values from tight-looping and oversized values from
// overflowing platform timers, which can turn a long delay into an immediate one.
function clampRetryAfterMs(retryAfterMs) {
  return Math.min(HEARTBEAT_RETRY_MAX_MS, Math.max(HEARTBEAT_RETRY_BASE_MS, retryAfterMs));
}

// Bounded exponential backoff with jitter. A valid server-provided Retry-After
// value is respected within the heartbeat bounds instead of the exponential delay.
export function heartbeatRetryDelayMs(
  attempt,
  {
    retryAfterMs = null,
    random = Math.random,
    baseMs = HEARTBEAT_RETRY_BASE_MS,
    maxMs = HEARTBEAT_RETRY_MAX_MS,
  } = {},
) {
  if (Number.isFinite(retryAfterMs)) return clampRetryAfterMs(retryAfterMs);

  const safeAttempt = Math.max(0, Math.min(10, Math.floor(Number(attempt) || 0)));
  const exponential = Math.min(maxMs, baseMs * 2 ** safeAttempt);
  const jitter = Math.floor(random() * Math.min(5_000, exponential));
  return Math.min(maxMs, exponential + jitter);
}

// Null means "stop": the session is no longer valid, so retrying cannot help.
export function heartbeatDelayAfter({
  ok,
  status,
  attempt,
  retryAfterMs = null,
  random = Math.random,
}) {
  if (ok) return HEARTBEAT_INTERVAL_MS;
  if (isAuthFailure(status)) return null;
  if (Number.isFinite(retryAfterMs)) return clampRetryAfterMs(retryAfterMs);
  if (status === undefined || status === null || isRetryableStatus(status)) {
    return heartbeatRetryDelayMs(attempt, { random });
  }
  return HEARTBEAT_INTERVAL_MS;
}
