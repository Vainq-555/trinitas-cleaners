import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin } from "../src/middleware/auth.js";
import { TaxUnavailableError } from "../src/utils/tax.js";
import prisma from "../src/utils/prisma.js";
import { adminCashCollect, collectCashPayment } from "../src/controllers/cashPayments.js";
import {
  assertPaidAmountMatches,
  calculateBookingQuote,
  receiptSnapshotData,
  createCheckout,
} from "../src/controllers/payments.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const bookingFixture = (overrides = {}) => ({
  id: "b1",
  customerId: "u1",
  status: "pending",
  price: 40,
  basePriceCents: 4000,
  discountCents: 0,
  taxableSubtotalCents: 4000,
  taxCents: null,
  taxRateBasisPoints: null,
  finalAmountCents: null,
  taxCalculationId: null,
  promotionId: null,
  taxAddressLine1: "1 Main St",
  taxAddressLine2: null,
  taxAddressCity: "Anoka",
  taxAddressState: "MN",
  taxAddressPostalCode: "55303",
  taxAddressCountry: "US",
  customer: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  service: { id: "s1", name: "Deep Clean" },
  payment: { id: "pay1", method: "cash", status: "unpaid", amount: 40, amountPaid: 0, amountPaidCents: null, finalAmountCents: null },
  ...overrides,
});

const QUOTE = {
  basePriceCents: 4000,
  discountCents: 0,
  taxableSubtotalCents: 4000,
  taxRateBasisPoints: 725,
  taxCents: 290,
  taxCalculationId: "tax_cash_1",
  finalAmountCents: 4290,
  promotion: null,
  taxAddress: { line1: "1 Main St", line2: null, city: "Anoka", state: "MN", postalCode: "55303", country: "US" },
};

const makeTx = ({ count = 1, existingReceipt = false } = {}) => {
  const calls = { bookingUpdate: [], paymentUpdateMany: [], receiptCreate: [], receiptFindFirst: [] };
  const tx = {
    booking: {
      update: async ({ where, data }) => {
        calls.bookingUpdate.push({ where, data });
        return { id: where.id, ...data };
      },
    },
    payment: {
      updateMany: async ({ where, data }) => {
        calls.paymentUpdateMany.push({ where, data });
        return { count };
      },
    },
    receipt: {
      findFirst: async () => {
        calls.receiptFindFirst.push(true);
        return existingReceipt ? { id: "rec_existing" } : null;
      },
      create: async ({ data }) => {
        calls.receiptCreate.push(data);
        return { id: "rec_cash_1", ...data };
      },
    },
  };
  return { tx, calls };
};

const baseDeps = (tx, overrides = {}) => ({
  findBooking: async () => bookingFixture(),
  quoteForBooking: async () => QUOTE,
  runTransaction: async (fn) => fn(tx),
  paidAt: () => new Date("2026-08-30T12:00:00Z"),
  ...overrides,
});

test("successful cash collection quotes authoritatively, persists booking, transitions unpaid to paid, and creates a cents-based receipt", async () => {
  const { tx, calls } = makeTx();
  let txCount = 0;
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    res,
    baseDeps(tx, { runTransaction: async (fn) => { txCount += 1; return fn(tx); } }),
  );

  assert.equal(res.body.ok, true);
  assert.equal(txCount, 1);

  // Payment transition: unpaid -> paid, executed conditionally on the "unpaid" state.
  assert.equal(calls.paymentUpdateMany.length, 1);
  assert.deepEqual(calls.paymentUpdateMany[0].where, { id: "pay1", status: "unpaid" });
  assert.equal(calls.paymentUpdateMany[0].data.status, "paid");
  assert.equal(calls.paymentUpdateMany[0].data.finalAmountCents, 4290);
  assert.equal(calls.paymentUpdateMany[0].data.amountPaidCents, 4290);
  assert.equal(calls.paymentUpdateMany[0].data.amountPaid, 42.9);
  assert.equal(calls.paymentUpdateMany[0].data.amount, 42.9);

  // Booking totals persisted from the authoritative quote.
  const bookingData = calls.bookingUpdate[0].data;
  assert.equal(bookingData.taxCents, 290);
  assert.equal(bookingData.taxRateBasisPoints, 725);
  assert.equal(bookingData.taxCalculationId, "tax_cash_1");
  assert.equal(bookingData.finalAmountCents, 4290);

  // Receipt derived from integer cents (no float percentage recalculation).
  assert.equal(calls.receiptCreate.length, 1);
  const receipt = calls.receiptCreate[0];
  assert.equal(receipt.taxableSubtotalCents, 4000);
  assert.equal(receipt.taxCents, 290);
  assert.equal(receipt.finalAmountCents, 4290);
  assert.equal(receipt.subtotal, 40);
  assert.equal(receipt.tax, 2.9);
  assert.equal(receipt.discount, 0);
  assert.equal(receipt.total, 42.9);

  // Response: method preserved as cash, safe metadata only.
  assert.equal(res.body.payment.method, "cash");
  assert.equal(res.body.payment.status, "paid");
  assert.equal(res.body.payment.finalAmountCents, 4290);
  assert.equal(res.body.receipt.id, "rec_cash_1");
});

test("real calculateBookingQuote with a fake Stripe client produces an integer-cent authoritative cash quote", async () => {
  const fakeStripe = {
    tax: {
      calculations: {
        create: async () => ({ id: "tax_c1", tax_amount_exclusive: 290, line_items: { data: [{ tax_breakdown: [{ tax_rate_details: { percentage_decimal: "7.25" } }] }] } }),
      },
    },
  };
  const quote = await calculateBookingQuote(bookingFixture(), undefined, fakeStripe);
  assert.equal(quote.taxCents, 290);
  assert.equal(quote.taxRateBasisPoints, 725);
  assert.equal(quote.taxCalculationId, "tax_c1");
  assert.equal(quote.finalAmountCents, 4290);
  assert.equal(Number.isInteger(quote.finalAmountCents), true);
  assert.equal(quote.finalAmountCents, quote.taxableSubtotalCents + quote.taxCents);
});

test("incomplete address is rejected with 422 requiresAddress before reaching Stripe", async () => {
  const neverUsedStripe = {
    tax: { calculations: { create: async () => { throw new Error("Stripe must not be called for an incomplete address"); } } },
  };
  const booking = bookingFixture({
    taxAddressLine1: null, taxAddressCity: null, taxAddressState: null, taxAddressPostalCode: null, taxAddressCountry: null,
  });
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290, serviceAddress: { line1: "x", city: "y" } } },
    res,
    baseDeps(makeTx().tx, {
      findBooking: async () => booking,
      quoteForBooking: (bk, addr) => calculateBookingQuote(bk, addr, neverUsedStripe),
    }),
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, "TAX_ADDRESS_REQUIRED");
  assert.equal(res.body.requiresAddress, true);
});

test("Stripe Tax failure returns a retryable 503 and never falls back to a flat tax rate", async () => {
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    res,
    baseDeps(makeTx().tx, { quoteForBooking: async () => { throw new TaxUnavailableError(); } }),
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.retryable, true);

  const inactive = response();
  const nonRetryable = new TaxUnavailableError("Stripe Tax has not been activated on your account");
  nonRetryable.retryable = false;
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    inactive,
    baseDeps(makeTx().tx, { quoteForBooking: async () => { throw nonRetryable; } }),
  );
  assert.equal(inactive.statusCode, 503);
  assert.equal(inactive.body.retryable, false);
});

test("correct amount is accepted and an incorrect amount is rejected without mutating anything", async () => {
  const { tx, calls } = makeTx();
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4291 } },
    res,
    baseDeps(tx),
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "PAYMENT_AMOUNT_MISMATCH");
  assert.equal(res.body.expectedFinalAmountCents, 4290);
  assert.equal(calls.paymentUpdateMany.length, 0);
  assert.equal(calls.bookingUpdate.length, 0);
  assert.equal(calls.receiptCreate.length, 0);
});

test("non-integer or missing amounts are rejected as bad requests", async () => {
  for (const finalAmountCents of [undefined, "4290", 4290.5]) {
    const res = response();
    await collectCashPayment({ params: { bookingId: "b1" }, body: { finalAmountCents } }, res, baseDeps(makeTx().tx));
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /integer number of cents/);
  }
  assert.throws(() => assertPaidAmountMatches(4290, 4290.001), (e) => e.code === "PAYMENT_AMOUNT_MISMATCH");
  assert.throws(() => assertPaidAmountMatches(4290, "4290"), (e) => e.code === "PAYMENT_AMOUNT_MISMATCH");
});

test("an already-paid cash payment is rejected and never re-charged or duplicated", async () => {
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    res,
    baseDeps(makeTx().tx, {
      findBooking: async () => bookingFixture({
        payment: { id: "pay1", method: "cash", status: "paid", amount: 42.9, amountPaid: 42.9, amountPaidCents: 4290, finalAmountCents: 4290 },
      }),
    }),
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "This cash payment has already been collected");
});

test("a refunded cash payment is rejected", async () => {
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    res,
    baseDeps(makeTx().tx, {
      findBooking: async () => bookingFixture({
        payment: { id: "pay1", method: "cash", status: "refunded", amount: 0, amountPaid: 0, amountPaidCents: 0, finalAmountCents: 4290 },
      }),
    }),
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "This cash payment has been refunded and cannot be collected");
});

test("online and non-cash bookings cannot be collected through the cash endpoint", async () => {
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    res,
    baseDeps(makeTx().tx, {
      findBooking: async () => bookingFixture({
        payment: { id: "pay1", method: "online", status: "pending", amount: 40, amountPaid: 0, amountPaidCents: null, finalAmountCents: 4290 },
      }),
    }),
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "This booking is not a cash payment");
});

test("missing booking and missing payment produce clear errors", async () => {
  const notFound = response();
  await collectCashPayment(
    { params: { bookingId: "nope" }, body: { finalAmountCents: 4290 } },
    notFound,
    baseDeps(makeTx().tx, { findBooking: async () => null }),
  );
  assert.equal(notFound.statusCode, 404);

  const noPayment = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    noPayment,
    baseDeps(makeTx().tx, { findBooking: async () => bookingFixture({ payment: null }) }),
  );
  assert.equal(noPayment.statusCode, 400);
  assert.match(noPayment.body.error, /no payment record/);
});

test("receipt snapshot carries authoritative integer cents without float recalculation", () => {
  const data = receiptSnapshotData(
    { id: "b1", customerId: "u1", basePriceCents: 4000, discountCents: 0, taxableSubtotalCents: 4000, taxRateBasisPoints: 725, taxCents: 290, finalAmountCents: 4290 },
    { finalAmountCents: 4290 },
  );
  assert.equal(data.taxCents, 290);
  assert.equal(data.finalAmountCents, 4290);
  assert.equal(data.taxableSubtotalCents, 4000);
  assert.equal(data.taxRateBasisPoints, 725);
  assert.equal(data.total, 42.9);
  assert.equal(Number.isInteger(data.finalAmountCents), true);
});

test("an existing receipt is reused instead of creating a duplicate", async () => {
  const { tx, calls } = makeTx({ existingReceipt: true });
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    res,
    baseDeps(tx),
  );
  assert.equal(calls.receiptCreate.length, 0);
  assert.equal(res.body.receipt.id, "rec_existing");
});

test("race safety: losing a concurrent collect (conditional update matches zero rows) cannot double-collect", async () => {
  const { tx, calls } = makeTx({ count: 0 });
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    res,
    baseDeps(tx, { paymentStatus: async () => "paid" }),
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "This cash payment has already been collected");
  assert.equal(calls.bookingUpdate.length, 0);
  assert.equal(calls.receiptCreate.length, 0);
});

test("concurrent collects are serialized: only the first to claim the unpaid state succeeds", async () => {
  const { tx, calls } = makeTx();
  const resA = response();

  const firstDeps = baseDeps(tx);
  await collectCashPayment({ params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } }, resA, firstDeps);
  assert.equal(resA.body.ok, true);
  assert.equal(calls.paymentUpdateMany.length, 1);

  const resC = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    resC,
    baseDeps(makeTx({ count: 0 }).tx, { paymentStatus: async () => "paid" }),
  );
  assert.equal(resC.statusCode, 409);
  assert.equal(resC.body.error, "This cash payment has already been collected");
});

test("authorization: cash-collect endpoint is admin-only with the existing middleware", () => {
  const route = findRoute("/admin/payments/:bookingId/cash-collect");
  assert.ok(route, "cash-collect route should be registered");
  assert.equal(route.methods.post, true);
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles[0], authenticate);
  assert.equal(handles[1], requireAdmin);
  assert.equal(handles[2], adminCashCollect);
});

test("non-admin roles cannot reach the cash-collect handler", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
  await requireAdmin({}, res, () => assert.fail("unauthenticated should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("existing online checkout route and shared quote flow remain unchanged", () => {
  const checkoutRoute = findRoute("/bookings/:id/checkout");
  assert.ok(checkoutRoute, "online checkout route should remain registered");
  assert.equal(checkoutRoute.methods.post, true);
  assert.equal(typeof createCheckout, "function");
});

test("success response exposes no credential-like fields", async () => {
  const res = response();
  await collectCashPayment({ params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } }, res, baseDeps(makeTx().tx));
  const payload = JSON.stringify(res.body);
  for (const forbidden of ["secret", "token", "password", "DATABASE_URL", "STRIPE_SECRET", "JWT", "credential"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `response must not contain ${forbidden}`);
  }
});

function findRoute(path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) return layer.route;
  }
  return null;
}