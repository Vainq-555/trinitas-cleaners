import test from "node:test";
import assert from "node:assert/strict";
import {
  cashActionsFor,
  classifyCashError,
  collectPayload,
  reconciliationCards,
  safeReconciliationRecords,
  RECONCILIATION_CATEGORY_LABELS,
} from "../lib/cashAdmin.mjs";

const cashBooking = (overrides = {}) => ({
  id: "b1",
  finalAmountCents: 4290,
  payment: { method: "cash", status: "unpaid" },
  ...overrides,
});

test("unpaid cash booking with an authoritative total shows the collect action", () => {
  const actions = cashActionsFor(cashBooking());
  assert.equal(actions.isCash, true);
  assert.equal(actions.canCollect, true);
  assert.equal(actions.action, "collect");
  assert.equal(actions.canRefund, false);
  assert.equal(actions.needsQuote, false);
});

test("paid cash booking shows the refund action", () => {
  const actions = cashActionsFor(cashBooking({ payment: { method: "cash", status: "paid" } }));
  assert.equal(actions.canRefund, true);
  assert.equal(actions.action, "refund");
  assert.equal(actions.canCollect, false);
});

test("refunded cash booking shows no collect or refund action", () => {
  const actions = cashActionsFor(cashBooking({ payment: { method: "cash", status: "refunded" } }));
  assert.equal(actions.isRefunded, true);
  assert.equal(actions.action, "none");
  assert.equal(actions.canCollect, false);
  assert.equal(actions.canRefund, false);
});

test("unpaid cash booking without an authoritative total flags needs-quote and never fabricates a total", () => {
  const actions = cashActionsFor(cashBooking({ finalAmountCents: null }));
  assert.equal(actions.needsQuote, true);
  assert.equal(actions.action, "needs-quote");
  assert.equal(actions.canCollect, false);
  // No fabricated payload can be produced.
  assert.equal(collectPayload(cashBooking({ finalAmountCents: null })), null);
});

test("collect payload uses the authoritative backend value and never computes", () => {
  const booking = cashBooking({ finalAmountCents: 4290 });
  const payload = collectPayload(booking);
  assert.deepEqual(payload, { finalAmountCents: 4290 });
});

test("online payments never surface cash actions and remain untouched", () => {
  const onlinePaid = cashBooking({ payment: { method: "online", status: "paid" } });
  const onlineUnpaid = cashBooking({ payment: { method: "online", status: "pending" } });
  for (const b of [onlinePaid, onlineUnpaid]) {
    const actions = cashActionsFor(b);
    assert.equal(actions.isCash, false);
    assert.equal(actions.action, "none");
    assert.equal(actions.canCollect, false);
    assert.equal(actions.canRefund, false);
  }
});

test("409 PAYMENT_AMOUNT_MISMATCH is mapped to a stale-quote error that refreshes", () => {
  const { kind, refresh, message } = classifyCashError({
    status: 409,
    data: { code: "PAYMENT_AMOUNT_MISMATCH", expectedFinalAmountCents: 4300 },
  });
  assert.equal(kind, "STALE_QUOTE");
  assert.equal(refresh, true);
  assert.ok(message.length > 0);
});

test("422 TAX_ADDRESS_REQUIRED is surfaced without refreshing the amount", () => {
  const { kind, refresh, message } = classifyCashError({
    status: 422,
    data: { code: "TAX_ADDRESS_REQUIRED", requiresAddress: true },
  });
  assert.equal(kind, "TAX_ADDRESS_REQUIRED");
  assert.equal(refresh, false);
  assert.match(message, /tax address/i);
});

test("503 tax unavailable instructs a retry with no fallback", () => {
  const { kind, refresh, message } = classifyCashError({ status: 503, data: { retryable: true } });
  assert.equal(kind, "TAX_UNAVAILABLE");
  assert.equal(refresh, false);
  assert.match(message, /no fallback rate/i);
});

test("generic 409 (already paid/refunded) triggers a refresh of state", () => {
  const { kind, refresh } = classifyCashError({ status: 409, data: { error: "This cash payment has already been collected" } });
  assert.equal(kind, "STATE_CHANGED");
  assert.equal(refresh, true);
});

test("unknown errors fall back to a generic admin message", () => {
  const { kind, refresh, message } = classifyCashError(new Error("boom"));
  assert.equal(kind, "ERROR");
  assert.equal(refresh, false);
  assert.ok(message.length > 0);
});

test("reconciliation summary renders every required metric from the backend", () => {
  const summary = {
    totalCashRecords: 7,
    unpaidCash: 2,
    needsTaxQuote: 1,
    readyForCollection: 2,
    paid: 3,
    refunded: 1,
    missingReceipts: 2,
    receiptMismatches: 1,
    receiptsUnverifiable: 1,
  };
  const cards = reconciliationCards(summary);
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c.value]));
  assert.equal(byKey.totalCashRecords, 7);
  assert.equal(byKey.unpaidCash, 2);
  assert.equal(byKey.needsTaxQuote, 1);
  assert.equal(byKey.readyForCollection, 2);
  assert.equal(byKey.paid, 3);
  assert.equal(byKey.refunded, 1);
  assert.equal(byKey.missingReceipts, 2);
  assert.equal(byKey.receiptMismatches, 1);
  assert.equal(byKey.receiptsUnverifiable, 1);
});

test("reconciliation records render with whitelisted fields only (no credential leakage)", () => {
  const records = [
    {
      bookingId: "b1",
      bookingStatus: "accepted",
      bookingDate: "2026-08-30T12:00:00Z",
      customerId: "u1",
      customerName: "Ada Lovelace",
      customerEmail: "ada@example.com",
      serviceName: "Deep Clean",
      paymentStatus: "paid",
      amountPaidCents: 4290,
      taxableSubtotalCents: 4000,
      taxCents: 290,
      finalAmountCents: 4290,
      receiptCount: 1,
      category: "PAID",
      flags: ["PAID"],
      receipt: {
        id: "r1",
        total: 42.9,
        taxCents: 290,
        finalAmountCents: 4290,
        reconcile: { status: "ok" },
      },
    },
  ];
  const rows = safeReconciliationRecords(records);
  const row = rows[0];
  assert.equal(row.customerName, "Ada Lovelace");
  assert.equal(row.customerEmail, undefined, "email must be stripped");
  assert.equal(row.customerId, undefined, "customerId must be stripped");
  assert.equal(row.finalAmountCents, 4290);
  assert.equal(row.category, "PAID");
  assert.deepEqual(row.flags, ["PAID"]);
  assert.equal(row.receipt.reconcile, "ok");
  assert.equal(row.receipt.id, "r1");
  const json = JSON.stringify(rows);
  assert.ok(!json.includes("ada@example.com"));
  assert.ok(!json.toLowerCase().includes("secret"));
});

test("reconciliation category labels are available for display", () => {
  assert.equal(RECONCILIATION_CATEGORY_LABELS.PAID, "Paid");
  assert.equal(RECONCILIATION_CATEGORY_LABELS.REFUNDED, "Refunded");
  assert.equal(RECONCILIATION_CATEGORY_LABELS.NEEDS_TAX_QUOTE, "Needs tax quote");
  assert.equal(RECONCILIATION_CATEGORY_LABELS.READY_FOR_COLLECTION, "Ready to collect");
});