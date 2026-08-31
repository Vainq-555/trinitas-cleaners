import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin } from "../src/middleware/auth.js";
import {
  adminPaymentReconciliation,
  buildReconciliation,
  reconcileBookingReceipt,
  RECONCILIATION_CATEGORIES,
} from "../src/controllers/reconciliation.js";
import prisma from "../src/utils/prisma.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const CASH_RECEIPT_CENTS = {
  id: "r1",
  subtotal: 36,
  taxRate: 0.0725,
  tax: 2.53,
  discount: 0,
  total: 38.53,
  taxRateBasisPoints: 725,
  taxCents: 253,
  taxableSubtotalCents: 3600,
  finalAmountCents: 3853,
  createdAt: new Date("2026-08-30T13:00:00Z"),
};

const booking = (overrides = {}) => ({
  id: "b1",
  status: "pending",
  date: new Date("2026-08-30T12:00:00Z"),
  taxCents: null,
  taxableSubtotalCents: 3600,
  finalAmountCents: null,
  customer: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  service: { id: "s1", name: "Deep Clean" },
  payment: { id: "pay1", method: "cash", status: "unpaid", amountPaidCents: null },
  receipts: [],
  ...overrides,
});

const paidPayment = { id: "pay1", method: "cash", status: "paid", amountPaidCents: 3853 };

test("unpaid cash booking with null finalAmountCents is NEEDS_TAX_QUOTE", () => {
  const [record] = buildReconciliation([booking()]).records;
  assert.equal(record.category, "NEEDS_TAX_QUOTE");
  assert.equal(record.hasTaxQuote, false);
  assert.ok(record.flags.includes("UNPAID_CASH"));
  assert.ok(record.flags.includes("NEEDS_TAX_QUOTE"));
  assert.ok(record.flags.includes("MISSING_RECEIPT"));
});

test("unpaid cash booking with calculated finalAmountCents is READY_FOR_COLLECTION", () => {
  const [record] = buildReconciliation([booking({ taxCents: 253, taxableSubtotalCents: 3600, finalAmountCents: 3853 })]).records;
  assert.equal(record.category, "READY_FOR_COLLECTION");
  assert.equal(record.hasTaxQuote, true);
  assert.equal(record.finalAmountCents, 3853);
  assert.ok(record.flags.includes("UNPAID_CASH"));
  assert.ok(record.flags.includes("READY_FOR_COLLECTION"));
});

test("cash booking without a receipt is flagged MISSING_RECEIPT", () => {
  const [unpaid] = buildReconciliation([booking()]).records;
  assert.ok(unpaid.flags.includes("MISSING_RECEIPT"));

  const [paidNoReceipt] = buildReconciliation([
    booking({ payment: paidPayment, taxCents: 253, taxableSubtotalCents: 3600, finalAmountCents: 3853 }),
  ]).records;
  assert.equal(paidNoReceipt.category, "MISSING_RECEIPT");
  assert.ok(paidNoReceipt.flags.includes("PAID"));
  assert.ok(paidNoReceipt.flags.includes("MISSING_RECEIPT"));
});

test("cash booking with matching receipt is PAID and reconciles cleanly", () => {
  const [record] = buildReconciliation([
    booking({
      payment: paidPayment,
      taxCents: 253,
      taxableSubtotalCents: 3600,
      finalAmountCents: 3853,
      receipts: [CASH_RECEIPT_CENTS],
    }),
  ]).records;
  assert.equal(record.category, "PAID");
  assert.ok(!record.flags.includes("RECEIPT_MISMATCH"));
  assert.ok(!record.flags.includes("MISSING_RECEIPT"));
  assert.equal(record.receipt.reconcile.status, "ok");
  assert.deepEqual(record.receipt.reconcile.details.mismatched, []);
});

test("matching legacy float receipt reconciles against stored cents", () => {
  const [record] = buildReconciliation([
    booking({
      payment: paidPayment,
      taxCents: null,
      taxableSubtotalCents: 3600,
      finalAmountCents: null,
      receipts: [{ id: "r2", subtotal: 36, taxRate: 0.0725, tax: 2.61, discount: 0, total: 38.61, taxCents: null, finalAmountCents: null, createdAt: new Date("2026-08-30T13:00:00Z") }],
    }),
  ]).records;
  assert.equal(record.receipt.reconcile.status, "ok");
  assert.equal(record.receipt.reconcile.details.method, "legacy-floats");
});

test("cash booking with mismatching receipt is RECEIPT_MISMATCH", () => {
  const [record] = buildReconciliation([
    booking({
      payment: paidPayment,
      taxCents: 253,
      taxableSubtotalCents: 3600,
      finalAmountCents: 3853,
      receipts: [{ ...CASH_RECEIPT_CENTS, finalAmountCents: 3953, total: 39.53 }],
    }),
  ]).records;
  assert.equal(record.category, "RECEIPT_MISMATCH");
  assert.ok(record.flags.includes("RECEIPT_MISMATCH"));
  assert.equal(record.receipt.reconcile.status, "mismatch");
  assert.ok(record.receipt.reconcile.details.mismatched.includes("finalAmountCents"));
});

test("mismatching legacy float receipt is detected", () => {
  const [record] = buildReconciliation([
    booking({
      payment: paidPayment,
      taxCents: null,
      taxableSubtotalCents: 3600,
      finalAmountCents: null,
      receipts: [{ id: "r3", subtotal: 40, taxRate: 0.0725, tax: 2.9, discount: 0, total: 42.9, taxCents: null, finalAmountCents: null, createdAt: new Date("2026-08-30T13:00:00Z") }],
    }),
  ]).records;
  assert.equal(record.receipt.reconcile.status, "mismatch");
  assert.ok(record.receipt.reconcile.details.mismatched.includes("subtotal"));
});

test("a receipt with no authoritative data on either side is unverifiable, not a mismatch", () => {
  const legacyBooking = booking({
    payment: paidPayment,
    taxCents: null,
    taxableSubtotalCents: null,
    finalAmountCents: null,
    receipts: [{ id: "r4", subtotal: 36, taxRate: 0.0725, tax: 2.61, discount: 0, total: 38.61, taxCents: null, finalAmountCents: null, createdAt: new Date("2026-08-30T13:00:00Z") }],
  });
  assert.equal(reconcileBookingReceipt(legacyBooking, legacyBooking.receipts[0]).status, "unverifiable");

  const report = buildReconciliation([legacyBooking]);
  assert.equal(report.records[0].category, "PAID");
  assert.ok(!report.records[0].flags.includes("RECEIPT_MISMATCH"));
  assert.equal(report.records[0].receipt.reconcile.status, "unverifiable");
  assert.equal(report.summary.receiptsUnverifiable, 1);
});

test("online payments never appear as cash records", () => {
  const onlinePending = booking({
    id: "b9",
    payment: { id: "pay9", method: "online", status: "pending", amountPaidCents: null },
    taxCents: 253,
    taxableSubtotalCents: 3600,
    finalAmountCents: 3853,
    receipts: [],
  });
  const onlinePaid = booking({
    id: "b10",
    payment: { id: "pay10", method: "online", status: "paid", amountPaidCents: 3853 },
    taxCents: 253,
    taxableSubtotalCents: 3600,
    finalAmountCents: 3853,
    receipts: [CASH_RECEIPT_CENTS],
  });
  const report = buildReconciliation([onlinePending, onlinePaid]);
  assert.equal(report.records.length, 0);
  assert.equal(report.summary.totalCashRecords, 0);
  assert.equal(report.byCategory.UNPAID_CASH, 0);
  assert.equal(report.byCategory.PAID, 0);
});

test("an online record is never emitted by buildReconciliation", () => {
  const report = buildReconciliation([
    booking({ id: "b9", payment: { id: "pay9", method: "online", status: "unpaid", amountPaidCents: null } }),
  ]);
  assert.equal(report.records.length, 0);
});

test("paid and refunded records are categorized correctly", () => {
  const [paid] = buildReconciliation([
    booking({ payment: paidPayment, taxCents: 253, taxableSubtotalCents: 3600, finalAmountCents: 3853, receipts: [CASH_RECEIPT_CENTS] }),
  ]).records;
  assert.equal(paid.category, "PAID");
  assert.ok(paid.flags.includes("PAID"));
  assert.ok(!paid.flags.includes("UNPAID_CASH"));

  const [refunded] = buildReconciliation([
    booking({
      payment: { id: "pay3", method: "cash", status: "refunded", amountPaidCents: 0 },
      taxCents: 253,
      taxableSubtotalCents: 3600,
      finalAmountCents: 3853,
      receipts: [CASH_RECEIPT_CENTS],
    }),
  ]).records;
  assert.equal(refunded.category, "REFUNDED");
  assert.ok(refunded.flags.includes("REFUNDED"));
  assert.ok(!refunded.flags.includes("UNPAID_CASH"));
});

test("multiple bookings each get per-record categories with consistent counts", () => {
  const report = buildReconciliation([
    booking(),
    booking({ id: "b2", taxCents: 253, taxableSubtotalCents: 3600, finalAmountCents: 3853 }),
    booking({ id: "b3", payment: paidPayment, taxCents: 253, taxableSubtotalCents: 3600, finalAmountCents: 3853, receipts: [CASH_RECEIPT_CENTS] }),
  ]);
  assert.equal(report.records.length, 3);
  assert.equal(report.byCategory.NEEDS_TAX_QUOTE, 1);
  assert.equal(report.byCategory.READY_FOR_COLLECTION, 1);
  assert.equal(report.byCategory.PAID, 1);
  assert.equal(Object.values(report.byCategory).reduce((a, b) => a + b, 0), 3);
  assert.equal(report.summary.totalCashRecords, 3);
});

test("no cash records yields an empty report", () => {
  const report = buildReconciliation([]);
  assert.equal(report.records.length, 0);
  assert.equal(report.summary.totalCashRecords, 0);
  assert.equal(report.summary.unpaidCash, 0);
  for (const category of RECONCILIATION_CATEGORIES) {
    assert.equal(report.byCategory[category], 0);
  }
});

test("handler queries only cash payments and returns safe metadata", async () => {
  const originalFindMany = prisma.booking.findMany;
  const calls = [];
  prisma.booking.findMany = async (args) => {
    calls.push(args);
    return [booking()];
  };
  try {
    const res = response();
    await adminPaymentReconciliation({}, res);
    assert.equal(res.body.scope.payments[0], "cash");
    assert.equal(calls[0].where.payment.is.method, "cash");
    assert.equal(res.body.records.length, 1);
    assert.equal(res.body.records[0].paymentMethod, "cash");
    assert.ok(res.body.records[0].customerEmail);
  } finally {
    prisma.booking.findMany = originalFindMany;
  }
});

test("reconciliation response contains no credential-like fields", () => {
  const report = buildReconciliation([booking()]);
  const keys = JSON.stringify(report);
  for (const forbidden of ["secret", "token", "password", "DATABASE_URL", "STRIPE", "JWT", "credential"]) {
    assert.ok(!keys.toLowerCase().includes(forbidden.toLowerCase()), `response must not contain ${forbidden}`);
  }
});

function findRoute(path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) return layer.route;
  }
  return null;
}

test("reconciliation endpoint is admin-only", () => {
  const route = findRoute("/admin/payments/reconciliation");
  assert.ok(route, "reconciliation route should be registered");
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles[0], authenticate);
  assert.equal(handles[1], requireAdmin);
  assert.equal(handles[2], adminPaymentReconciliation);
});

test("non-admin role is rejected by the admin guard", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
  await requireAdmin({}, res, () => assert.fail("unauthenticated should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});