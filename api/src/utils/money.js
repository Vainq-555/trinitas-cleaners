// New financial calculations use integer cents. These conversions are only
// compatibility boundaries for the existing Float API/schema fields.
export function dollarsToCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Money value must be a finite non-negative number");
  }
  const text = String(value);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("Money value must have at most two decimal places");
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0") || 0);
}

export function centsToLegacyDollars(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error("Invalid cents");
  return cents / 100;
}

export function formatCents(cents) {
  if (!Number.isInteger(cents)) throw new Error("Invalid cents");
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function percentageToBasisPoints(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Percentage must be between 0 and 100");
  }
  const text = String(value);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > 2) throw new Error("Percentage must have at most two decimals");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0") || 0);
}

export function basisPointsToLegacyRate(basisPoints) {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) return 0;
  return basisPoints / 10000;
}
