import { parseRetryAfterMs } from "./requestResilience.mjs";

const BASE = "/api";

// Thin wrapper around fetch that keeps cookies same-origin via the Next rewrite.
// Returns parsed JSON. Throws { status, error } on non-2xx.
// Retries are deliberately NOT automatic: callers decide whether an operation is
// safe to retry, so login and other non-idempotent requests are never replayed.
export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const fallback =
      res.status === 429
        ? "The service is temporarily busy. Please wait a moment and try again."
        : `Request failed (${res.status})`;
    const err = new Error(data?.error || fallback);
    err.status = res.status;
    err.data = data;
    err.retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    throw err;
  }
  return data;
}

export const money = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const moneyCents = (cents) =>
  (Number.isInteger(cents) ? cents / 100 : 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
