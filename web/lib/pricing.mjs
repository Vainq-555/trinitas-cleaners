// Pure, browser-free monthly pricing helpers for the admin Pricing Control page.
// Conversion mirrors the backend rule: monthly pricing is stored as integer
// cents, and a monthly save NEVER carries the one-time basePrice/price lanes.

// Converts a dollar amount string/number to integer cents, or null when absent
// or not a valid non-negative number. Uses Math.round like the task spec.
export function monthlyDollarsToCents(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// Inverse display helper: integer cents -> "180" / "0.05", else "".
export function centsToDollars(cents) {
  if (!Number.isInteger(cents) || cents < 0) return "";
  return String(cents / 100);
}

// Global monthly body for PUT /admin/services/:id/price/global.
// Returns null when the input is invalid or an "active" save has no price.
// The body contains ONLY monthlyPriceCents/monthlyActive — never basePrice.
export function globalMonthlyBody(dollars, active) {
  const hasInput = String(dollars ?? "").trim() !== "";
  const cents = monthlyDollarsToCents(dollars);
  if (cents === null && hasInput) return null;
  if (active && cents === null) return null;
  return { monthlyActive: active, ...(cents !== null ? { monthlyPriceCents: cents } : {}) };
}

// Set body for PUT /admin/services/:id/price/customer — monthly lane only.
// Returns null on invalid input; carries no one-time `price` key.
export function customerMonthlyBody(customerId, dollars) {
  if (!customerId) return null;
  const cents = monthlyDollarsToCents(dollars);
  if (cents === null) return null;
  return { customerId, monthlyPriceCents: cents };
}

// Clear-only-the-monthly-override body for the same PUT (never DELETE, which
// would remove the customer's one-time override too).
export function customerMonthlyClearBody(customerId) {
  if (!customerId) return null;
  return { customerId, monthlyPriceCents: null };
}