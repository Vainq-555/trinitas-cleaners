import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { createCheckout, processEvent } from "../src/controllers/payments.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const onlineBooking = (overrides = {}) => ({
  id: "b1",
  customerId: "u1",
  status: "pending",
  price: 40,
  basePriceCents: 4000,
  discountCents: 0,
  taxableSubtotalCents: 4000,
  taxCents: 290,
  taxRateBasisPoints: 725,
  finalAmountCents: 4290,
  taxCalculationId: "tax_1",
  promotionId: null,
  promotionCodeSnapshot: null,
  promotionNameSnapshot: null,
  promotionDiscountTypeSnapshot: null,
  promotionDiscountValueSnapshot: null,
  taxAddressLine1: "1 Main St",
  taxAddressLine2: null,
  taxAddressCity: "Anoka",
  taxAddressState: "MN",
  taxAddressPostalCode: "55303",
  taxAddressCountry: "US",
  customer: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  service: { id: "s1", name: "Deep Clean" },
  payment: { id: "pay1", method: "online", status: "pending", amount: 40, amountPaid: 0, amountPaidCents: null, finalAmountCents: null },
  ...overrides,
});

const paidCheckoutEvent = (bookingId = "b1", overrides = {}) => ({
  id: "evt_1",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1",
      payment_status: "paid",
      amount_total: 4290,
      payment_intent: "pi_1",
      metadata: { bookingId },
    },
  },
  ...overrides,
});

// ---- Part 1: createCheckout approval gate ----

test("pending online booking cannot create Stripe Checkout (BOOKING_NOT_APPROVED, 4xx)", async () => {
  const originalFindUnique = prisma.booking.findUnique;
  prisma.booking.findUnique = async () => onlineBooking({ status: "pending" });
  try {
    const res = response();
    await createCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "BOOKING_NOT_APPROVED");
    assert.match(res.body.error, /approved before payment/);
  } finally {
    prisma.booking.findUnique = originalFindUnique;
  }
});

test("declined online booking cannot create Stripe Checkout (BOOKING_NOT_APPROVED, 4xx)", async () => {
  const originalFindUnique = prisma.booking.findUnique;
  prisma.booking.findUnique = async () => onlineBooking({ status: "declined" });
  try {
    const res = response();
    await createCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "BOOKING_NOT_APPROVED");
    assert.match(res.body.error, /approved before payment/);
  } finally {
    prisma.booking.findUnique = originalFindUnique;
  }
});

test("accepted online booking passes the approval gate and proceeds to checkout quote", async () => {
  const originalFindUnique = prisma.booking.findUnique;
  prisma.booking.findUnique = async () => onlineBooking({ status: "accepted" });
  try {
    const res = response();
    await createCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, res);
    assert.equal(res.body.requiresConfirmation, true);
    assert.equal(res.body.quote.finalAmountCents, 4290);
  } finally {
    prisma.booking.findUnique = originalFindUnique;
  }
});

test("existing ownership/method/paid checks still run before the approval gate", async () => {
  const originalFindUnique = prisma.booking.findUnique;
  prisma.booking.findUnique = async () => onlineBooking({ customerId: "someone-else" });
  try {
    const res = response();
    await createCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, res);
    assert.equal(res.statusCode, 404);
  } finally {
    prisma.booking.findUnique = originalFindUnique;
  }

  prisma.booking.findUnique = async () => onlineBooking();
  try {
    const res = response();
    await createCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "BOOKING_NOT_APPROVED");
  } finally {
    prisma.booking.findUnique = originalFindUnique;
  }
});

// ---- Part 2/3: webhook must not auto-accept ----

const makeTx = ({ bookingOverrides = {} } = {}) => {
  const calls = { paymentUpdate: [], bookingUpdate: [], receiptCreate: [], warning: [] };
  const tx = {
    payment: {
      findFirst: async () => ({ id: "pay1", bookingId: "b1", finalAmountCents: 4290, status: "pending", stripePaymentIntentId: null }),
      update: async ({ where, data }) => {
        calls.paymentUpdate.push({ where, data });
        return { id: where.id, ...data, finalAmountCents: 4290 };
      },
    },
    booking: {
      findUnique: async () => onlineBooking(bookingOverrides),
      update: async ({ where, data }) => {
        calls.bookingUpdate.push({ where, data });
        return { id: where.id, ...data };
      },
    },
    receipt: {
      findFirst: async () => null,
      create: async ({ data }) => { calls.receiptCreate.push(data); return { id: "rec_1" }; },
    },
  };
  return { tx, calls };
};

test("webhook: successful paid checkout does NOT change a pending booking to accepted", async () => {
  const { tx, calls } = makeTx({ bookingOverrides: { status: "pending" } });
  await processEvent(tx, paidCheckoutEvent());
  assert.equal(calls.paymentUpdate.length, 1);
  assert.equal(calls.paymentUpdate[0].data.status, "paid");
  assert.equal(calls.bookingUpdate.length, 0);
});

test("webhook: successful paid checkout does NOT change a declined booking to accepted", async () => {
  const { tx, calls } = makeTx({ bookingOverrides: { status: "declined" } });
  await processEvent(tx, paidCheckoutEvent());
  assert.equal(calls.paymentUpdate.length, 1);
  assert.equal(calls.paymentUpdate[0].data.status, "paid");
  assert.equal(calls.bookingUpdate.length, 0);
});

test("webhook: successful paid checkout preserves an already-accepted booking", async () => {
  const { tx, calls } = makeTx({ bookingOverrides: { status: "accepted" } });
  await processEvent(tx, paidCheckoutEvent());
  assert.equal(calls.paymentUpdate.length, 1);
  assert.equal(calls.paymentUpdate[0].data.status, "paid");
  assert.equal(calls.bookingUpdate.length, 0);
});

test("webhook: receipt snapshot is still created after a paid checkout", async () => {
  const { tx, calls } = makeTx({ bookingOverrides: { status: "accepted" } });
  await processEvent(tx, paidCheckoutEvent());
  assert.equal(calls.receiptCreate.length, 1);
  assert.equal(calls.receiptCreate[0].bookingId, "b1");
  assert.equal(calls.receiptCreate[0].finalAmountCents, 4290);
});

test("webhook: a paid checkout for an already-refunded payment is ignored (no re-marking)", async () => {
  const { tx, calls } = makeTx();
  tx.payment.findFirst = async () => ({ id: "pay1", bookingId: "b1", finalAmountCents: 4290, status: "refunded" });
  await processEvent(tx, paidCheckoutEvent());
  assert.equal(calls.paymentUpdate.length, 0);
  assert.equal(calls.receiptCreate.length, 0);
});