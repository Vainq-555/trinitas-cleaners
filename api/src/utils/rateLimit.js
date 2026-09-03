// Lightweight in-memory sliding-window rate limiter (no external dependency).
//
// Deliberately NOT persisted and per-process. That is acceptable for the
// current single-instance scale and avoids a cache/db dependency. The window
// slides forward, so an over-limit caller is throttled only until old hits fall
// out of the window — it never permanently blocks a legitimate user.
//
// Production note: if this ever scales to multiple instances, swap this for a
// shared store (e.g. Redis) behind the same `checkAndRecord` interface.

export function createRateLimiter({ windowMs, limit, now = () => Date.now() }) {
  const hits = new Map();

  function prune(key) {
    const list = hits.get(key);
    if (!list) return;
    const cutoff = now() - windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
  }

  return {
    // Records a hit for `key`, clipped to the window, and returns the count of
    // hits within the window after recording (useful for HTTP 429 handling).
    record(key) {
      prune(key);
      const list = hits.get(key) || [];
      list.push(now());
      hits.set(key, list);
      return list.length;
    },

    // Returns whether a hit for `key` is allowed. When false, the caller should
    // reject the request without recording a new hit (so blocked attempts don't
    // extend the block window against a high-ingress attacker).
    allow(key) {
      prune(key);
      const list = hits.get(key) || [];
      return list.length < limit;
    },

    // Exposed for tests only.
    _reset() {
      hits.clear();
    },
  };
}

// A key-namespaced pair of limiters for the forgot-password flow.
export function createRecoveryRateLimiters({ now } = {}) {
  const byIp = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 5, now });
  const byEmail = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 3, now });
  return {
    byIp,
    byEmail,
    _reset() {
      byIp._reset();
      byEmail._reset();
    },
  };
}