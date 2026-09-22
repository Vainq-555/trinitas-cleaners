import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import {
  createSubscriptionBooking,
  subscriptionCheckout,
  isSubscriptionEvent,
  processSubscriptionWebhook,
  finalizeStripeCancelAtPeriodEnd,
} from "../src/controllers/subscriptions.js";
import { processEvent } from "../src/controllers/payments.js";
import { effectiveMonthlyPriceCents } from "../src/controllers/services.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const monthlyService = (overrides = {}) => ({
  id: "s1",
  name: "Weekly Cleaning",
  isActive: true,
  basePrice: 60,
  monthlyActive: true,
  monthlyPriceCents: 4000,
  ...overrides,
});

const subscription = (overrides = {}) => ({
  id: "sub_1",
  customerId: "u1",
  serviceId: "s1",
  bookingId: "b1",
  months: 1,
  monthCompleted: 0,
  status: "accepted",
  monthlyPriceCents: 4000,
  stripeSubscriptionId: null,
  stripePriceId: null,
  idempotencyKey: "idem-1",
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  finalCancelPending: false,
  finalCancelPendingAt: null,
  finalCancelConfirmedAt: null,
  canceledAt: null,
  completedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

const subscriptionBooking = (id, subscriptionId, bookingId, periodIndex, stripeInvoiceId) => ({
  id,
  subscriptionId,
  bookingId,
  periodIndex,
  periodStart: new Date(),
  periodEnd: new Date(),
  stripeInvoiceId,
  createdAt: new Date(),
});

// ---- effectiveMonthlyPriceCents (pricing architecture re-use) ----

test("effectiveMonthlyPriceCents requires monthlyActive and resolves override over global", async () => {
  const client = { customPrice: { findUnique: async () => ({ monthlyPriceCents: 5500 }) } };
  assert.equal(await effectiveMonthlyPriceCents(monthlyService(), "u1", client), 5500);
  assert.equal(await effectiveMonthlyPriceCents(monthlyService(), undefined, client), 4000);
  assert.equal(await effectiveMonthlyPriceCents(monthlyService({ monthlyActive: false }), "u1", client), null);
  assert.equal(await effectiveMonthlyPriceCents(monthlyService({ monthlyPriceCents: null }), "u1", client), 5500);
  const noOverride = { customPrice: { findUnique: async () => null } };
  assert.equal(await effectiveMonthlyPriceCents(monthlyService({ monthlyPriceCents: null }), "u1", noOverride), null);
  assert.equal(await effectiveMonthlyPriceCents(monthlyService({ monthlyActive: false }), "u1", noOverride), null);
});

// ---- PART A: createSubscriptionBooking ----

function stubCreateSubscription({ service, customPrice, existingTx } = {}) {
  const original = {
    service: prisma.service.findUnique,
    customPrice: prisma.customPrice.findUnique,
    transaction: prisma.$transaction,
    user: prisma.user.findFirst,
    broadcast: prisma.broadcast.create,
  };
  prisma.service.findUnique = async () => service;
  prisma.customPrice.findUnique = async () => customPrice;
  prisma.$transaction = async (fn) => (existingTx ? fn(existingTx) : fn(prisma));
  prisma.user.findFirst = async () => ({ id: "admin1" });
  prisma.broadcast.create = async () => ({});
  return original;
}

function restorePrisma(original) {
  prisma.service.findUnique = original.service;
  prisma.customPrice.findUnique = original.customPrice;
  prisma.$transaction = original.transaction;
  prisma.user.findFirst = original.user;
  prisma.broadcast.create = original.broadcast;
}

test("createSubscriptionBooking creates the request booking + pending Subscription atomically with a price snapshot", async () => {
  const created = [];
  const tx = {
    booking: {
      create: async ({ data }) => {
        const row = { id: "new_booking", ...data };
        created.push(row);
        return row;
      },
    },
  };
  const original = stubCreateSubscription({ service: monthlyService(), customPrice: null, existingTx: tx });
  try {
    const res = response();
    await createSubscriptionBooking(
      { body: { serviceId: "s1", date: "2026-10-01T15:00:00Z", months: 3, note: "hi" }, user: { id: "u1", name: "Ada" } },
      res,
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.requiresCheckout, false);
    const row = created[0];
    assert.equal(row.customerId, "u1");
    assert.equal(row.status, "pending");
    assert.equal(row.basePriceCents, 4000);
    assert.equal(row.payment.create.method, "online");
    const subData = row.subscription.create;
    assert.equal(subData.customerId, "u1");
    assert.equal(subData.months, 3);
    assert.equal(subData.monthCompleted, 0);
    assert.equal(subData.status, "pending");
    assert.equal(subData.monthlyPriceCents, 4000);
    assert.ok(subData.idempotencyKey && typeof subData.idempotencyKey === "string");
  } finally {
    restorePrisma(original);
    prisma.service.findUnique = original.service;
    prisma.$transaction = original.transaction;
  }
});

test("createSubscriptionBooking applies the customer-specific monthly override to the snapshot", async () => {
  const created = [];
  const tx = { booking: { create: async ({ data }) => { created.push(data); return data; } } };
  const original = stubCreateSubscription({ service: monthlyService(), customPrice: { monthlyPriceCents: 5500 }, existingTx: tx });
  try {
    const res = response();
    await createSubscriptionBooking({ body: { serviceId: "s1", date: "2026-10-01T15:00:00Z", months: 1 }, user: { id: "u1", name: "Ada" } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(created[0].subscription.create.monthlyPriceCents, 5500);
    assert.equal(created[0].basePriceCents, 5500);
  } finally {
    restorePrisma(original);
    prisma.$transaction = original.transaction;
  }
});

test("createSubscriptionBooking rejects invalid terms, past dates, and unavailable monthly pricing", async () => {
  const original = stubCreateSubscription({ service: monthlyService(), customPrice: null, existingTx: null });
  try {
    for (const months of [0, 13, 1.5, "3", null, undefined]) {
      const res = response();
      await createSubscriptionBooking({ body: { serviceId: "s1", date: "2026-10-01T15:00:00Z", months }, user: { id: "u1" } }, res);
      assert.equal(res.statusCode, 400, `months=${months}`);
    }
    const past = response();
    await createSubscriptionBooking({ body: { serviceId: "s1", date: "2020-01-01T00:00:00Z", months: 1 }, user: { id: "u1" } }, past);
    assert.equal(past.statusCode, 400);

    prisma.service.findUnique = async () => monthlyService({ isActive: false });
    const inactive = response();
    await createSubscriptionBooking({ body: { serviceId: "s1", date: "2026-10-01T15:00:00Z", months: 1 }, user: { id: "u1" } }, inactive);
    assert.equal(inactive.statusCode, 400);

    prisma.service.findUnique = async () => monthlyService({ monthlyActive: false, monthlyPriceCents: 4000 });
    const notMonthly = response();
    await createSubscriptionBooking({ body: { serviceId: "s1", date: "2026-10-01T15:00:00Z", months: 1 }, user: { id: "u1" } }, notMonthly);
    assert.equal(notMonthly.statusCode, 400);

    prisma.service.findUnique = async () => monthlyService({ monthlyPriceCents: null });
    const noPrice = response();
    await createSubscriptionBooking({ body: { serviceId: "s1", date: "2026-10-01T15:00:00Z", months: 1 }, user: { id: "u1" } }, noPrice);
    assert.equal(noPrice.statusCode, 400);
  } finally {
    restorePrisma(original);
    prisma.$transaction = original.transaction;
  }
});

// ---- PART C: subscriptionCheckout validation gates (pre-Stripe) ----

const subscriptionBookingRow = (overrides = {}) => ({
  id: "b1",
  customerId: "u1",
  customer: { id: "u1", name: "Ada", email: "ada@example.com", stripeCustomerId: null },
  service: { id: "s1", name: "Weekly Cleaning" },
  payment: { method: "online", stripeCheckoutSessionId: null },
  subscription: subscription(),
  ...overrides,
});

test("subscriptionCheckout requires ownership and an approved, unstarted subscription", async () => {
  const original = prisma.booking.findUnique;
  try {
    prisma.booking.findUnique = async () => subscriptionBookingRow({ customerId: "other" });
    const res = response();
    await subscriptionCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, res);
    assert.equal(res.statusCode, 404);

    prisma.booking.findUnique = async () => subscriptionBookingRow({ subscription: null });
    const noSub = response();
    await subscriptionCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, noSub);
    assert.equal(noSub.statusCode, 400);

    prisma.booking.findUnique = async () => subscriptionBookingRow({ subscription: subscription({ status: "pending" }) });
    const pending = response();
    await subscriptionCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, pending);
    assert.equal(pending.statusCode, 409);
    assert.equal(pending.body.code, "SUBSCRIPTION_NOT_APPROVED");

    prisma.booking.findUnique = async () => subscriptionBookingRow({ subscription: subscription({ stripeSubscriptionId: "sub_stripe_1" }) });
    const started = response();
    await subscriptionCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, started);
    assert.equal(started.statusCode, 409);
    assert.equal(started.body.code, "SUBSCRIPTION_ALREADY_STARTED");

    prisma.booking.findUnique = async () => subscriptionBookingRow({ subscription: subscription({ status: "canceled" }) });
    const canceled = response();
    await subscriptionCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, canceled);
    assert.equal(canceled.statusCode, 409);
    assert.equal(canceled.body.code, "SUBSCRIPTION_ENDED");
  } finally {
    prisma.booking.findUnique = original;
  }
});

test("subscriptionCheckout requires online payment and refuses without test-mode Stripe", async () => {
  const original = prisma.booking.findUnique;
  try {
    prisma.booking.findUnique = async () => subscriptionBookingRow({ payment: { method: "cash" } });
    const res = response();
    await subscriptionCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, res);
    assert.equal(res.statusCode, 400);

    prisma.booking.findUnique = async () => subscriptionBookingRow();
    const noStripe = response();
    await subscriptionCheckout({ params: { id: "b1" }, body: {}, user: { id: "u1" } }, noStripe);
    assert.equal(noStripe.statusCode, 503);
  } finally {
    prisma.booking.findUnique = original;
  }
});

// ---- Webhook dispatch: one-time path untouched ----

test("isSubscriptionEvent recognizes only subscription lanes", () => {
  assert.equal(isSubscriptionEvent({ type: "checkout.session.completed", data: { object: { mode: "subscription" } } }), true);
  assert.equal(isSubscriptionEvent({ type: "checkout.session.completed", data: { object: { mode: "payment" } } }), false);
  assert.equal(isSubscriptionEvent({ type: "checkout.session.completed", data: { object: { subscription: "sub_1" } } }), true);
  assert.equal(isSubscriptionEvent({ type: "invoice.paid", data: { object: {} } }), true);
  assert.equal(isSubscriptionEvent({ type: "invoice.payment_failed", data: { object: {} } }), true);
  assert.equal(isSubscriptionEvent({ type: "invoice.payment_action_required", data: { object: {} } }), true);
  assert.equal(isSubscriptionEvent({ type: "customer.subscription.deleted", data: { object: {} } }), true);
  assert.equal(isSubscriptionEvent({ type: "charge.refunded", data: { object: {} } }), false);
});

test("processEvent routes subscription-mode checkout away from one-time payment handling", async () => {
  const subState = { stripeSubscriptionId: null };
  const tx = {
    subscription: {
      findUnique: async ({ where }) => (where.id === "sub_1" ? subscription({ id: "sub_1", bookingId: "b1" }) : null),
      update: async ({ data }) => { Object.assign(subState, data); return subState; },
    },
    payment: {
      update: async () => ({}),
    },
    booking: { findUnique: async () => null },
  };
  const event = {
    id: "evt_cs",
    type: "checkout.session.completed",
    data: { object: { id: "cs_sub_1", mode: "subscription", payment_status: "paid", amount_total: 0, subscription: "sub_stripe_1", metadata: { subscriptionId: "sub_1" } } },
  };
  const outcome = await processEvent(tx, event);
  // No one-time payment branch ran (no assertPaidAmountMatches on finalAmountCents).
  assert.equal(outcome.subscriptionId, "sub_1");
  assert.equal(subState.stripeSubscriptionId, "sub_stripe_1");
});

// ---- Fakes for the subscription webhook processors ----

function makeSubTx(initial = {}) {
  const sub = subscription(initial.subscription);
  const state = {
    subscription: sub,
    bookings: [],
    payments: [],
    subBookings: [],
    subPayments: [],
    paymentUpdates: [],
    subscriptionUpdateCalls: [],
  };
  const findSub = async ({ where } = {}) => {
    if (where.id !== undefined) return state.subscription.id === where.id ? state.subscription : null;
    if (where.stripeSubscriptionId !== undefined) return state.subscription.stripeSubscriptionId === where.stripeSubscriptionId ? state.subscription : null;
    if (where.bookingId !== undefined) return state.subscription.bookingId === where.bookingId ? state.subscription : null;
    return null;
  };
  const tx = {
    booking: {
      create: async ({ data }) => {
        const row = { id: `b_${state.bookings.length + 1}`, ...data };
        state.bookings.push(row);
        return row;
      },
    },
    payment: {
      create: async ({ data }) => {
        const row = { id: `pay_${state.payments.length + 1}`, ...data };
        state.payments.push(row);
        return row;
      },
      update: async ({ where, data }) => { state.paymentUpdates.push({ where, data }); return { ...data }; },
    },
    subscription: {
      findUnique: findSub,
      update: async ({ data }) => {
        state.subscriptionUpdateCalls.push(data);
        state.subscription = { ...state.subscription, ...data };
        return state.subscription;
      },
    },
    subscriptionBooking: {
      findUnique: async ({ where }) =>
        state.subBookings.find((r) => where.stripeInvoiceId !== undefined && r.stripeInvoiceId === where.stripeInvoiceId) || null,
      create: async ({ data }) => {
        const row = { id: `sb_${state.subBookings.length + 1}`, ...data };
        state.subBookings.push(row);
        return row;
      },
    },
    subscriptionPayment: {
      create: async ({ data }) => {
        const row = { id: `sp_${state.subPayments.length + 1}`, ...data };
        state.subPayments.push(row);
        return row;
      },
    },
  };
  return { tx, state };
}

const paidEvent = (invoiceId = "in_1", overrides = {}) => ({
  id: `evt_${invoiceId}`,
  type: "invoice.paid",
  data: {
    object: {
      id: invoiceId,
      subscription: "sub_stripe_1",
      period_start: 1700000000,
      period_end: 1702592000,
      amount_paid: 4000,
      amount_due: 4000,
      payment_intent: "pi_1",
      ...overrides,
    },
  },
});

// ---- PART E: invoice.paid ----

test("invoice.paid activates exactly one month: booking, payment, lane, and status", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 3 } });
  const outcome = await processSubscriptionWebhook(tx, paidEvent("in_1"));
  assert.equal(outcome.periodIndex, 1);
  assert.equal(outcome.termComplete, false);
  assert.equal(outcome.finalCancel, null);
  assert.equal(state.subBookings.length, 1);
  assert.equal(state.subBookings[0].periodIndex, 1);
  assert.equal(state.subBookings[0].stripeInvoiceId, "in_1");
  assert.equal(state.subPayments.length, 1);
  assert.equal(state.subPayments[0].paymentId, state.payments[0].id);
  assert.equal(state.bookings.length, 1);
  assert.equal(state.bookings[0].basePriceCents, 4000);
  assert.equal(state.payments[0].status, "paid");
  assert.equal(state.payments[0].amountPaidCents, 4000);
  assert.equal(state.subscription.monthCompleted, 1);
  assert.equal(state.subscription.status, "active");
});

test("invoice.paid is idempotent for a redelivered invoice", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 3 } });
  await processSubscriptionWebhook(tx, paidEvent("in_1"));
  const before = state.bookings.length;
  const outcome = await processSubscriptionWebhook(tx, paidEvent("in_1"));
  assert.equal(outcome.duplicate, true);
  assert.equal(state.bookings.length, before);
  assert.equal(state.payments.length, before);
  assert.equal(state.subBookings.length, 1);
  assert.equal(state.subPayments.length, 1);
  assert.equal(state.subscription.monthCompleted, 1);
});

test("invoice.paid advances month by month up to the selected term", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 3 } });
  await processSubscriptionWebhook(tx, paidEvent("in_1"));
  await processSubscriptionWebhook(tx, paidEvent("in_2"));
  assert.equal(state.subscription.monthCompleted, 2);
  assert.equal(state.subscription.currentPeriodStart.getTime(), 1700000000 * 1000);
  await processSubscriptionWebhook(tx, paidEvent("in_3"));
  assert.equal(state.subscription.monthCompleted, 3);
  assert.equal(state.subBookings.length, 3);
});

test("invoice.paid never activates more than the selected months", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 2 } });
  await processSubscriptionWebhook(tx, paidEvent("in_1"));
  await processSubscriptionWebhook(tx, paidEvent("in_2"));
  const before = state.bookings.length;
  const outcome = await processSubscriptionWebhook(tx, paidEvent("in_3"));
  assert.equal(outcome.ignored, "term-complete");
  assert.equal(state.bookings.length, before);
  assert.equal(state.subscription.monthCompleted, 2);
});

// ---- PART G: final month ----

test("final invoice.paid persists finalCancelPending BEFORE any Stripe call", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 1 } });
  const outcome = await processSubscriptionWebhook(tx, paidEvent("in_1"));
  assert.equal(outcome.termComplete, true);
  assert.equal(outcome.finalCancel.subscriptionId, "sub_1");
  assert.equal(state.subscription.finalCancelPending, true);
  assert.ok(state.subscription.finalCancelPendingAt);
  assert.equal(state.subscription.cancelAtPeriodEnd, false);
  assert.equal(state.subBookings.length, 1);
  assert.equal(state.subBookings[0].bookingId, state.bookings[0].id);
});

test("finalizeStripeCancelAtPeriodEnd sets cancelAtPeriodEnd only after Stripe confirms", async () => {
  const calls = [];
  const db = {
    subscription: {
      findUnique: async () => subscription({ stripeSubscriptionId: "sub_stripe_1", finalCancelPending: true }),
      update: async ({ data }) => { calls.push(data); return data; },
    },
  };
  const stripeClient = {
    subscriptions: {
      update: async (id, params, opts) => {
        calls.push({ stripeId: id, params, idempotencyKey: opts.idempotencyKey });
        return { id, ...params };
      },
    },
  };
  const result = await finalizeStripeCancelAtPeriodEnd({ subscriptionId: "sub_1" }, { db, stripeClient });
  assert.equal(result.ok, true);
  const stripeCall = calls.find((c) => c.stripeId);
  assert.equal(stripeCall.params.cancel_at_period_end, true);
  assert.equal(stripeCall.idempotencyKey, "idem-1:final-cancel");
  const dbCall = calls.find((c) => c.cancelAtPeriodEnd === true);
  assert.equal(dbCall.cancelAtPeriodEnd, true);
  assert.equal(dbCall.finalCancelPending, false);
  assert.ok(dbCall.finalCancelConfirmedAt);
});

test("finalizeStripeCancelAtPeriodEnd does NOT mark cancelAtPeriodEnd when Stripe fails", async () => {
  const updates = [];
  const db = {
    subscription: {
      findUnique: async () => subscription({ stripeSubscriptionId: "sub_stripe_1", finalCancelPending: true }),
      update: async ({ data }) => { updates.push(data); return data; },
    },
  };
  const stripeClient = { subscriptions: { update: async () => { throw new Error("stripe down"); } } };
  await assert.rejects(() => finalizeStripeCancelAtPeriodEnd({ subscriptionId: "sub_1" }, { db, stripeClient }));
  assert.equal(updates.length, 0);
  assert.equal(updates.some((u) => u.cancelAtPeriodEnd === true), false);
});

test("finalizeStripeCancelAtPeriodEnd confirm path leaves stripes untouched when already cancel-at-period-end", async () => {
  const calls = [];
  const db = {
    subscription: {
      findUnique: async () => subscription({ stripeSubscriptionId: "sub_stripe_1", finalCancelPending: true, cancelAtPeriodEnd: true }),
      update: async ({ data }) => { calls.push(data); return data; },
    },
  };
  const result = await finalizeStripeCancelAtPeriodEnd({ subscriptionId: "sub_1" }, { db, stripeClient: {} });
  assert.equal(result.alreadyConfirmed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].finalCancelPending, false);
  assert.ok(calls[0].finalCancelConfirmedAt);
});

// ---- PART F: failed payments ----

test("invoice.payment_failed marks past_due without creating a monthly booking", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 3 } });
  const event = { id: "evt_fail", type: "invoice.payment_failed", data: { object: { id: "in_fail", subscription: "sub_stripe_1" } } };
  const outcome = await processSubscriptionWebhook(tx, event);
  assert.equal(outcome.failed, true);
  assert.equal(state.subscription.status, "past_due");
  assert.equal(state.bookings.length, 0);
  assert.equal(state.payments.length, 0);
  assert.equal(state.subBookings.length, 0);
});

test("invoice.paid after a past-due recovery processes normally and idempotently", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 3 } });
  await processSubscriptionWebhook(tx, { id: "e1", type: "invoice.payment_failed", data: { object: { subscription: "sub_stripe_1", id: "in_fail" } } });
  assert.equal(state.subscription.status, "past_due");
  await processSubscriptionWebhook(tx, paidEvent("in_1"));
  assert.equal(state.subscription.status, "active");
  assert.equal(state.subscription.monthCompleted, 1);
  const dup = await processSubscriptionWebhook(tx, paidEvent("in_1"));
  assert.equal(dup.duplicate, true);
});

test("invoice.payment_action_required is a safe no-op", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 3 } });
  const event = { id: "e2", type: "invoice.payment_action_required", data: { object: { id: "in_ar", subscription: "sub_stripe_1" } } };
  const outcome = await processSubscriptionWebhook(tx, event);
  assert.equal(outcome.ignored, "payment-action-required");
  assert.equal(state.bookings.length, 0);
  assert.equal(state.subscription.status, "accepted");
});

// ---- PART H: customer.subscription.deleted ----

test("customer.subscription.deleted marks completed when term finished and preserves history", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 2, monthCompleted: 2 } });
  const event = { id: "e3", type: "customer.subscription.deleted", data: { object: { id: "sub_stripe_1" } } };
  const outcome = await processSubscriptionWebhook(tx, event);
  assert.equal(outcome.canceled, true);
  assert.equal(state.subscription.status, "completed");
  assert.ok(state.subscription.completedAt);
  assert.ok(state.subscription.canceledAt);
});

test("customer.subscription.deleted marks canceled for an early cancellation and is idempotent", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: "sub_stripe_1", months: 3, monthCompleted: 1 } });
  const event = { id: "e4", type: "customer.subscription.deleted", data: { object: { id: "sub_stripe_1" } } };
  await processSubscriptionWebhook(tx, event);
  assert.equal(state.subscription.status, "canceled");
  const again = await processSubscriptionWebhook(tx, event);
  assert.equal(again.canceled, true);
  assert.equal(state.subscription.status, "canceled");
});

// ---- PART D: checkout.session.completed does not activate month 1 ----

test("subscription-mode checkout.session.completed associates the Stripe subscription without activating a month", async () => {
  const { tx, state } = makeSubTx({ subscription: { stripeSubscriptionId: null, months: 3, bookingId: "b1" } });
  const event = {
    id: "evt_cs1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_sub_1", mode: "subscription", subscription: "sub_stripe_1", metadata: { bookingId: "b1" } } },
  };
  const outcome = await processSubscriptionWebhook(tx, event);
  assert.equal(outcome.subscriptionId, "sub_1");
  assert.equal(state.subscription.stripeSubscriptionId, "sub_stripe_1");
  assert.equal(state.subscription.monthCompleted, 0);
  assert.equal(state.bookings.length, 0);
  assert.equal(state.payments.length, 0);
});