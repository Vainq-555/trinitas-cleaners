/**
 * Shared admin cash-payment UI logic.
 *
 * The backend is the single source of truth for amounts and state. These helpers
 * never compute taxes, never apply a fallback rate, and never fabricate totals.
 */

// Which payment actions an admin can take for a booking, based purely on state
// the backend has already validated. No amounts are calculated here.
export function cashActionsFor(booking) {
  const payment = booking?.payment || {};
  const isCash = payment.method === "cash";
  const status = payment.status || null;
  const hasAuthoritativeTotal = Number.isInteger(booking?.finalAmountCents);

  let canCollect = false;
  let canRefund = false;
  let isRefunded = false;
  let needsQuote = false;

  if (isCash) {
    if (status === "unpaid" && hasAuthoritativeTotal) canCollect = true;
    else if (status === "unpaid" && !hasAuthoritativeTotal) needsQuote = true;
    if (status === "paid") canRefund = true;
    if (status === "refunded") isRefunded = true;
  }

  const action = isRefunded ? "none" : needsQuote ? "needs-quote" : canCollect ? "collect" : canRefund ? "refund" : "none";
  return { isCash, status, action, canCollect, canRefund, isRefunded, needsQuote, hasAuthoritativeTotal };
}

// The only body the cash-collect endpoint accepts is the authoritative
// integer-cent amount already stored on the booking. Returns null when that
// amount is unavailable so the UI can never POST a fabricated value.
export function collectPayload(booking) {
  if (!Number.isInteger(booking?.finalAmountCents)) return null;
  return { finalAmountCents: booking.finalAmountCents };
}

// Maps backend errors to admin-facing guidance. Never triggers a fallback.
export function classifyCashError(err) {
  const status = err?.status;
  const data = err?.data || {};

  if (status === 409 && data?.code === "PAYMENT_AMOUNT_MISMATCH") {
    return {
      kind: "STALE_QUOTE",
      refresh: true,
      message: "This booking's total has changed since it was displayed. The authoritative total has been reloaded.",
    };
  }
  if (status === 422 && data?.code === "TAX_ADDRESS_REQUIRED") {
    return {
      kind: "TAX_ADDRESS_REQUIRED",
      refresh: false,
      message: "This booking needs a complete tax address before payment can be collected.",
    };
  }
  if (status === 503) {
    return {
      kind: "TAX_UNAVAILABLE",
      refresh: false,
      message: "Stripe Tax is temporarily unavailable. Try again — no fallback rate is used.",
    };
  }
  if (status === 409) {
    return {
      kind: "STATE_CHANGED",
      refresh: true,
      message: data?.error || "This payment's state changed. The booking has been reloaded.",
    };
  }
  return { kind: "ERROR", refresh: false, message: err?.message || "Something went wrong. Please try again." };
}

// Summary cards shown on the reconciliation page. Labels map 1:1 to backend
// summary keys so nothing is derived or recomputed here.
export const RECONCILIATION_CARD_KEYS = [
  "totalCashRecords",
  "unpaidCash",
  "needsTaxQuote",
  "readyForCollection",
  "paid",
  "refunded",
  "missingReceipts",
  "receiptMismatches",
  "receiptsUnverifiable",
];

export function reconciliationCards(summary = {}) {
  return RECONCILIATION_CARD_KEYS.map((key) => ({ key, value: summary[key] ?? 0 }));
}

// Project a backend reconciliation record to a display-safe subset. Email and any
// non-whitelisted fields are deliberately stripped so credentials never render.
const SAFE_RECORD_FIELDS = [
  "bookingId",
  "bookingStatus",
  "bookingDate",
  "customerName",
  "serviceName",
  "paymentStatus",
  "amountPaidCents",
  "taxableSubtotalCents",
  "taxCents",
  "finalAmountCents",
  "receiptCount",
  "category",
  "flags",
];

export function safeReconciliationRecords(records = []) {
  return records.map((record) => {
    const row = { receipt: null };
    for (const field of SAFE_RECORD_FIELDS) {
      if (field in record) row[field] = record[field];
    }
    if (record.receipt) {
      row.receipt = {
        id: record.receipt.id,
        total: record.receipt.total ?? null,
        taxCents: record.receipt.taxCents ?? null,
        finalAmountCents: record.receipt.finalAmountCents ?? null,
        reconcile: record.receipt.reconcile?.status ?? null,
      };
    }
    return row;
  });
}

export const RECONCILIATION_CATEGORY_LABELS = {
  NEEDS_TAX_QUOTE: "Needs tax quote",
  UNPAID_CASH: "Unpaid",
  MISSING_RECEIPT: "Missing receipt",
  RECEIPT_MISMATCH: "Receipt mismatch",
  READY_FOR_COLLECTION: "Ready to collect",
  PAID: "Paid",
  REFUNDED: "Refunded",
};