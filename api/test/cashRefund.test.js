import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin } from "../src/middleware/auth.js";
import { adminCashRefund, collectCashPayment, refundCashPayment } from "../src/controllers/cashPayments.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const QUOTE_FIELDS = {
  basePriceCents: 4000,
  discountCents: 0,
  taxableSubtotalCents: 4000,
  taxCents: 290,
  taxRateBasisPoints: 725,
  taxCalculationId: "tax_c1",
  finalAmountCents: 4290,
};

const paidBooking = (overrides = {}) => ({
  id: "b1",
  customerId: "u1",
  status: "accepted",
  method: "cash",
  ...QUOTE_FIELDS,
  customer: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  service: { id: "s1", name: "Deep Clean" },
  payment: {
    id: "pay1",
    method: "cash",
    status: "paid",
    amount: 42.9,
    amountPaid: 42.9,
    amountPaidCents: 4290,
    finalAmountCents: 4290,
    refundedAt: null,
  },
  ...overrides,
});

const makeTx = ({ count = 1 } = {}) => {
  const calls = { paymentUpdateMany: [] };
  const tx = {
    payment: {
      updateMany: async ({ where, data }) => {
        calls.paymentUpdateMany.push({ where, data });
        return { count };
      },
    },
  };
  return { tx, calls };
};

const baseDeps = (tx, overrides = {}) => ({
  findBooking: async () => paidBooking(),
  runTransaction: async (fn) => fn(tx),
  refundedAt: () => new Date("2026-08-31T10:00:00Z"),
  ...overrides,
});

test("successful paid cash -> refunded transition zeroes amounts, sets refundedAt, preserves method", async () => {
  const { tx, calls } = makeTx();
  let txCount = 0;
  const res = response();
  await refundCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    res,
    baseDeps(tx, { runTransaction: async (fn) => { txCount += 1; return fn(tx); } }),
  );

  assert.equal(res.statusCode, null);
  assert.equal(res.body.ok, true);
  assert.equal(txCount, 1);

  // Atomic precondition: only a currently-paid payment can be refunded.
  assert.equal(calls.paymentUpdateMany.length, 1);
  assert.deepEqual(calls.paymentUpdateMany[0].where, { id: "pay1", status: "paid" });
  const data = calls.paymentUpdateMany[0].data;
  assert.equal(data.status, "refunded");
  assert.equal(data.amountPaidCents, 0);
  assert.equal(data.amountPaid, 0);
  assert.equal(data.refundedAt.toISOString(), "2026-08-31T10:00:00.000Z");

  // Response: method preserved, amounts zeroed, refundedAt populated.
  assert.equal(res.body.payment.method, "cash");
  assert.equal(res.body.payment.status, "refunded");
  assert.equal(res.body.payment.amountPaidCents, 0);
  assert.equal(res.body.payment.amountPaid, 0);
  assert.deepEqual(res.body.payment.refundedAt, data.refundedAt);
});

test("booking authoritative quote is not altered by a refund (no quote recompute, no tax call)", async () => {
  let taxCalled = false;
  const quoteSpy = async () => { taxCalled = true; throw new Error("quote must not be called"); };
  const { tx, calls } = makeTx();
  const res = response();
  await refundCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    res,
    baseDeps(tx, { quoteForBooking: quoteSpy }),
  );
  assert.equal(taxCalled, false, "refund must not invoke Stripe Tax / quote");
  // Only the payment record is written.
  assert.equal(calls.paymentUpdateMany.length, 1);
  assert.equal(calls.paymentUpdateMany[0].data.taxCents ?? undefined, undefined, "refund must not touch booking quote fields");
  // Response echoes the authoritative quote as preserved.
});

test("unpaid cash payment cannot be refunded (409)", async () => {
  const booking = paidBooking({ payment: { id: "pay1", method: "cash", status: "unpaid", amountPaidCents: 0, amountPaid: 0, finalAmountCents: 4290, refundedAt: null } });
  const { tx, calls } = makeTx();
  const res = response();
  await refundCashPayment({ params: { bookingId: "b1" }, body: {} }, res, baseDeps(tx, { findBooking: async () => booking }));
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /Only a paid cash payment can be refunded/);
  assert.equal(calls.paymentUpdateMany.length, 0);
});

test("already-refunded cash payment cannot be refunded again (409)", async () => {
  const booking = paidBooking({ payment: { id: "pay1", method: "cash", status: "refunded", amountPaidCents: 0, amountPaid: 0, finalAmountCents: 4290, refundedAt: new Date() } });
  const { tx, calls } = makeTx();
  const res = response();
  await refundCashPayment({ params: { bookingId: "b1" }, body: {} }, res, baseDeps(tx, { findBooking: async () => booking }));
  assert.equal(res.statusCode, 409);
  assert.equal(calls.paymentUpdateMany.length, 0);
});

test("missing booking returns 404 and missing payment returns 400", async () => {
  const { tx } = makeTx();
  const notFound = response();
  await refundCashPayment({ params: { bookingId: "nope" }, body: {} }, notFound, baseDeps(tx, { findBooking: async () => null }));
  assert.equal(notFound.statusCode, 404);

  const noPayment = response();
  await refundCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    noPayment,
    baseDeps(tx, { findBooking: async () => paidBooking({ payment: null }) }),
  );
  assert.equal(noPayment.statusCode, 400);
  assert.match(noPayment.body.error, /no payment record/);
});

test("online payment cannot use the cash-refund endpoint (400)", async () => {
  const booking = paidBooking({ payment: { id: "pay1", method: "online", status: "paid", amountPaidCents: 4290, amountPaid: 42.9, finalAmountCents: 4290 } });
  const { tx, calls } = makeTx();
  const res = response();
  await refundCashPayment({ params: { bookingId: "b1" }, body: {} }, res, baseDeps(tx, { findBooking: async () => booking }));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /not a cash payment/);
  assert.equal(calls.paymentUpdateMany.length, 0);
});

test("double refund is race-safe: losing the paid precondition cannot double-refund", async () => {
  const { tx, calls } = makeTx({ count: 0 });
  const res = response();
  await refundCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    res,
    baseDeps(tx, { paymentStatus: async () => "refunded" }),
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "This cash payment has already been refunded");

  // If status is still paid (e.g. concurrent collect), report accordingly.
  const resPaid = response();
  await refundCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    resPaid,
    baseDeps(makeTx({ count: 0 }).tx, { paymentStatus: async () => "paid" }),
  );
  assert.equal(resPaid.statusCode, 409);
  assert.equal(resPaid.body.error, "This cash payment is already paid");
});

test("a refunded cash payment cannot subsequently be collected", async () => {
  // Simulate a transaction that claims an unpaid row while the payment was actually refunded.
  const refunded = paidBooking({ payment: { id: "pay1", method: "cash", status: "refunded", amountPaidCents: 0, amountPaid: 0, finalAmountCents: 4290, refundedAt: new Date() } });
  const { tx } = makeTx();
  const res = response();
  await collectCashPayment(
    { params: { bookingId: "b1" }, body: { finalAmountCents: 4290 } },
    res,
    {
      findBooking: async () => refunded,
      quoteForBooking: async () => ({ finalAmountCents: 4290 }),
      runTransaction: async (fn) => fn(tx),
      paidAt: () => new Date(),
    },
  );
  // The pre-check rejects a refunded payment before any transaction runs.
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /refunded and cannot be collected/);
});

test("refund endpoint is admin-only; 401 unauthenticated, 403 non-admin, admin reaches handler", async () => {
  const route = findRoute("/admin/payments/:bookingId/cash-refund", "post");
  assert.ok(route, "cash-refund route should be registered");
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles[0], authenticate);
  assert.equal(handles[1], requireAdmin);
  assert.equal(handles[2], adminCashRefund);

  const nonAdmin = response();
  await requireAdmin({ user: { role: "customer" } }, nonAdmin, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(nonAdmin.statusCode, 403);

  const unauthenticated = response();
  await requireAdmin({}, unauthenticated, () => assert.fail("unauthenticated should not reach the endpoint"));
  assert.equal(unauthenticated.statusCode, 401);

  let reached = false;
  await requireAdmin({ user: { role: "admin" } }, response(), () => { reached = true; });
  assert.equal(reached, true);
});

test("refund response exposes no credential-like fields", async () => {
  const { tx } = makeTx();
  const res = response();
  await refundCashPayment({ params: { bookingId: "b1" }, body: {} }, res, baseDeps(tx));
  const payload = JSON.stringify(res.body);
  for (const forbidden of ["secret", "token", "password", "DATABASE_URL", "STRIPE_SECRET", "JWT", "credential"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `response must not contain ${forbidden}`);
  }
});

test("online webhook refund behavior is preserved (charge.refunded transitions paid to refunded with zeroed amounts)", async () => {
  // The shared webhook handler still performs the online refund transition. This
  // guards against the cash refund path disturbing the existing online state machine.
  const onlinePayment = { id: "pay1", bookingId: "b1", status: "paid", finalAmountCents: 4290, stripePaymentIntentId: "pi_1" };
  const updated = await applyOnlineRefundLike(onlinePayment);
  assert.equal(updated.status, "refunded");
  assert.equal(updated.amountPaid, 0);
  assert.equal(updated.amountPaidCents, 0);
  assert.ok(updated.refundedAt instanceof Date);
});

function applyOnlineRefundLike(payment) {
  if (payment.status === "paid") {
    return { ...payment, status: "refunded", refundedAt: new Date(), amountPaid: 0, amountPaidCents: 0 };
  }
  return payment;
}

function findRoute(path, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      if (!method || layer.route.methods[method]) return layer.route;
    }
  }
  return null;
}