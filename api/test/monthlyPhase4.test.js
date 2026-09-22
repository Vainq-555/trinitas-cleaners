import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { requireAdmin, requireCustomer } from "../src/middleware/auth.js";
import {
  adminSetGlobalPrice,
  adminSetCustomerPrice,
  adminClearCustomerPrice,
  listServices,
  effectiveMonthlyPriceCents,
} from "../src/controllers/services.js";
import { cancelSubscription } from "../src/controllers/subscriptions.js";
import { createSubscriptionBooking } from "../src/controllers/subscriptions.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const service = (overrides = {}) => ({
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
  months: 12,
  monthCompleted: 2,
  status: "active",
  monthlyPriceCents: 4000,
  stripeSubscriptionId: "sub_stripe_1",
  stripePriceId: "price_1",
  idempotencyKey: "idem-1",
  currentPeriodStart: new Date("2026-10-01T00:00:00Z"),
  currentPeriodEnd: new Date("2026-10-31T23:59:59Z"),
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

// ---- Authorization ----

test("admin pricing routes reject non-admin users (global and customer setters)", () => {
  const customer = response();
  requireAdmin({ user: { role: "customer" } }, customer, () => assert.fail("customer must not continue"));
  assert.equal(customer.statusCode, 403);
  const missing = response();
  requireAdmin({}, missing, () => assert.fail("missing user must not continue"));
  assert.equal(missing.statusCode, 401);
});

test("subscription cancellation route is customer-only", () => {
  const admin = response();
  requireCustomer({ user: { role: "admin" } }, admin, () => assert.fail("admin must not continue"));
  assert.equal(admin.statusCode, 403);
  const missing = response();
  requireCustomer({}, missing, () => assert.fail("missing user must not continue"));
  assert.equal(missing.statusCode, 401);
});

// ---- Objective A: admin global monthly price ----

test("adminSetGlobalPrice sets monthly fields additively alongside basePrice", async () => {
  const original = prisma.service.update;
  const calls = [];
  prisma.service.update = async ({ data }) => { calls.push(data); return { basePrice: data.basePrice, monthlyPriceCents: data.monthlyPriceCents, monthlyActive: data.monthlyActive }; };
  try {
    const res = response();
    await adminSetGlobalPrice({ params: { id: "s1" }, body: { basePrice: 60, monthlyPriceCents: 5000, monthlyActive: true } }, res);
    assert.equal(res.body.service.basePrice, 60);
    assert.equal(res.body.service.monthlyPriceCents, 5000);
    assert.equal(res.body.service.monthlyActive, true);
    assert.deepEqual(calls[0], { basePrice: 60, monthlyPriceCents: 5000, monthlyActive: true });
  } finally {
    prisma.service.update = original;
  }
});

test("adminSetGlobalPrice accepts monthly-only changes and does not touch one-time price", async () => {
  const original = prisma.service.update;
  prisma.service.update = async ({ data }) => data;
  try {
    const res = response();
    await adminSetGlobalPrice({ params: { id: "s1" }, body: { monthlyPriceCents: 5000, monthlyActive: true } }, res);
    assert.equal(res.body.service.basePrice, undefined);
    assert.equal(res.body.service.monthlyPriceCents, 5000);
  } finally {
    prisma.service.update = original;
  }
});

test("adminSetGlobalPrice rejects invalid monthly values and empty bodies", async () => {
  for (const monthlyPriceCents of [-1, 1.5, "5000", NaN, Infinity, null]) {
    const res = response();
    await adminSetGlobalPrice({ params: { id: "s1" }, body: { basePrice: 60, monthlyPriceCents } }, res);
    assert.equal(res.statusCode, 400, `monthlyPriceCents=${monthlyPriceCents}`);
  }
  for (const monthlyActive of ["yes", 1, null]) {
    const res = response();
    await adminSetGlobalPrice({ params: { id: "s1" }, body: { basePrice: 60, monthlyActive } }, res);
    assert.equal(res.statusCode, 400, `monthlyActive=${monthlyActive}`);
  }
  const empty = response();
  await adminSetGlobalPrice({ params: { id: "s1" }, body: {} }, empty);
  assert.equal(empty.statusCode, 400);
});

// ---- Objective A: admin customer monthly override ----

test("adminSetCustomerPrice sets a monthly override without clobbering the one-time price", async () => {
  const originalFind = prisma.user.findUnique;
  const originalFindService = prisma.service.findUnique;
  const originalUpsert = prisma.customPrice.upsert;
  const calls = [];
  prisma.user.findUnique = async () => ({ id: "u1" });
  prisma.service.findUnique = async () => service();
  prisma.customPrice.upsert = async ({ where, update }) => { calls.push({ where, update }); return { serviceId: "s1", customerId: "u1", price: 45, ...update }; };
  try {
    const res = response();
    await adminSetCustomerPrice({ params: { id: "s1" }, body: { customerId: "u1", monthlyPriceCents: 5500 } }, res);
    assert.equal(res.body.customPrice.monthlyPriceCents, 5500);
    assert.equal(res.body.customPrice.price, 45);
    assert.deepEqual(calls[0].update, { monthlyPriceCents: 5500 });
  } finally {
    prisma.user.findUnique = originalFind;
    prisma.service.findUnique = originalFindService;
    prisma.customPrice.upsert = originalUpsert;
  }
});

test("adminSetCustomerPrice sets only the one-time price when monthlyPriceCents is absent", async () => {
  const originalFind = prisma.user.findUnique;
  const originalUpsert = prisma.customPrice.upsert;
  const originalFindService = prisma.service.findUnique;
  const calls = [];
  prisma.user.findUnique = async () => ({ id: "u1" });
  prisma.customPrice.upsert = async ({ update }) => { calls.push(update); return { ...update }; };
  try {
    const res = response();
    await adminSetCustomerPrice({ params: { id: "s1" }, body: { customerId: "u1", price: 45 } }, res);
    assert.deepEqual(calls[0], { price: 45 });
  } finally {
    prisma.user.findUnique = originalFind;
    prisma.customPrice.upsert = originalUpsert;
    prisma.service.findUnique = originalFindService;
  }
});

test("adminSetCustomerPrice seeds a new row's one-time lane with the global basePrice", async () => {
  const originalFindUser = prisma.user.findUnique;
  const originalFindService = prisma.service.findUnique;
  const originalUpsert = prisma.customPrice.upsert;
  let create;
  prisma.user.findUnique = async () => ({ id: "u1" });
  prisma.service.findUnique = async () => service();
  prisma.customPrice.upsert = async ({ create: c }) => { create = c; return c; };
  try {
    const res = response();
    await adminSetCustomerPrice({ params: { id: "s1" }, body: { customerId: "u1", monthlyPriceCents: 5500 } }, res);
    assert.equal(create.price, 60);
    assert.equal(create.monthlyPriceCents, 5500);
  } finally {
    prisma.user.findUnique = originalFindUser;
    prisma.service.findUnique = originalFindService;
    prisma.customPrice.upsert = originalUpsert;
  }
});

test("adminSetCustomerPrice clears ONLY the monthly lane with null and preserves one-time price", async () => {
  const originalFind = prisma.user.findUnique;
  const originalUpsert = prisma.customPrice.upsert;
  const originalCpFind = prisma.customPrice.findUnique;
  const originalCpUpdate = prisma.customPrice.update;
  const calls = [];
  prisma.user.findUnique = async () => ({ id: "u1" });
  prisma.customPrice.upsert = async () => { throw new Error("upsert must not be called for a clear"); };
  prisma.customPrice.findUnique = async () => ({ serviceId: "s1", customerId: "u1", price: 45, monthlyPriceCents: 5500 });
  prisma.customPrice.update = async ({ data }) => { calls.push(data); return { ...data }; };
  try {
    const res = response();
    await adminSetCustomerPrice({ params: { id: "s1" }, body: { customerId: "u1", monthlyPriceCents: null } }, res);
    assert.equal(res.body.customPrice.monthlyPriceCents, null);
    assert.equal(res.body.customPrice.price, 45);
    assert.deepEqual(calls[0], { monthlyPriceCents: null });
  } finally {
    prisma.user.findUnique = originalFind;
    prisma.customPrice.upsert = originalUpsert;
    prisma.customPrice.findUnique = originalCpFind;
    prisma.customPrice.update = originalCpUpdate;
  }
});

test("adminSetCustomerPrice clear with no existing row is a no-op that creates nothing", async () => {
  const originalFind = prisma.user.findUnique;
  const originalCpFind = prisma.customPrice.findUnique;
  const originalUpsert = prisma.customPrice.upsert;
  prisma.user.findUnique = async () => ({ id: "u1" });
  prisma.customPrice.findUnique = async () => null;
  prisma.customPrice.upsert = async () => { throw new Error("upsert must not be called"); };
  try {
    const res = response();
    await adminSetCustomerPrice({ params: { id: "s1" }, body: { customerId: "u1", monthlyPriceCents: null } }, res);
    assert.equal(res.body.customPrice, null);
    assert.equal(res.statusCode, null);
  } finally {
    prisma.user.findUnique = originalFind;
    prisma.customPrice.findUnique = originalCpFind;
    prisma.customPrice.upsert = originalUpsert;
  }
});

test("adminSetCustomerPrice rejects invalid monthlyPriceCents and missing lanes", async () => {
  for (const monthlyPriceCents of [-1, 1.5, "5500", NaN, Infinity]) {
    const res = response();
    await adminSetCustomerPrice({ params: { id: "s1" }, body: { customerId: "u1", monthlyPriceCents } }, res);
    assert.equal(res.statusCode, 400, `monthlyPriceCents=${monthlyPriceCents}`);
  }
  const empty = response();
  await adminSetCustomerPrice({ params: { id: "s1" }, body: { customerId: "u1" } }, empty);
  assert.equal(empty.statusCode, 400);
});

// ---- Objective C: customer-effective monthly price exposure ----

test("listServices returns the customer's effective monthly price when a custom override exists", async () => {
  const originalFindMany = prisma.service.findMany;
  const originalCpFind = prisma.customPrice.findUnique;
  prisma.service.findMany = async () => [service()];
  prisma.customPrice.findUnique = async ({ where }) => {
    assert.equal(where.serviceId_customerId.customerId, "u1");
    return { price: 45, monthlyPriceCents: 5500 };
  };
  try {
    const res = response();
    await listServices({ user: { id: "u1", role: "customer" } }, res);
    assert.equal(res.body.services[0].monthlyPriceCents, 5500);
    assert.equal(res.body.services[0].price, 45);
  } finally {
    prisma.service.findMany = originalFindMany;
    prisma.customPrice.findUnique = originalCpFind;
  }
});

test("listServices returns the global monthly price for a customer with no override", async () => {
  const originalFindMany = prisma.service.findMany;
  const originalCpFind = prisma.customPrice.findUnique;
  prisma.service.findMany = async () => [service()];
  prisma.customPrice.findUnique = async () => null;
  try {
    const res = response();
    await listServices({ user: { id: "u1", role: "customer" } }, res);
    assert.equal(res.body.services[0].monthlyPriceCents, 4000);
    assert.equal(res.body.services[0].monthlyActive, true);
    assert.equal(res.body.services[0].price, 60);
    assert.equal(res.body.services[0].basePrice, 60);
  } finally {
    prisma.service.findMany = originalFindMany;
    prisma.customPrice.findUnique = originalCpFind;
  }
});

test("listServices never looks up (or leaks) another customer's override", async () => {
  const originalFindMany = prisma.service.findMany;
  const originalCpFind = prisma.customPrice.findUnique;
  const lookedUp = [];
  prisma.service.findMany = async () => [service()];
  prisma.customPrice.findUnique = async ({ where }) => {
    lookedUp.push(where.serviceId_customerId.customerId);
    return { price: 45, monthlyPriceCents: 5500 }; // only ever for u1's own lane
  };
  try {
    const res = response();
    await listServices({ user: { id: "u1", role: "customer" } }, res);
    assert.equal(res.body.services[0].monthlyPriceCents, 5500);
    assert.ok(lookedUp.length >= 2, "effectivePrice + effective monthly price both resolve the customer lane");
    assert.deepEqual([...new Set(lookedUp)], ["u1"]);
  } finally {
    prisma.service.findMany = originalFindMany;
    prisma.customPrice.findUnique = originalCpFind;
  }
});

test("unauthenticated listServices preserves the raw global monthly price (existing behavior)", async () => {
  const originalFindMany = prisma.service.findMany;
  const originalCpFind = prisma.customPrice.findUnique;
  let customLookups = 0;
  prisma.service.findMany = async () => [service({ monthlyPriceCents: 4000 })];
  prisma.customPrice.findUnique = async () => { customLookups += 1; return { price: 45, monthlyPriceCents: 5500 }; };
  try {
    const res = response();
    await listServices({}, res);
    assert.equal(res.body.services[0].monthlyPriceCents, 4000);
    assert.equal(customLookups, 0);
    assert.equal(res.body.services[0].price, 60);
    assert.equal(res.body.services[0].basePrice, 60);
  } finally {
    prisma.service.findMany = originalFindMany;
    prisma.customPrice.findUnique = originalCpFind;
  }
});

test("listServices leaves the one-time price response untouched for customers", async () => {
  const originalFindMany = prisma.service.findMany;
  const originalCpFind = prisma.customPrice.findUnique;
  prisma.service.findMany = async () => [service()];
  prisma.customPrice.findUnique = async () => ({ price: 45, monthlyPriceCents: 5500 });
  try {
    const res = response();
    await listServices({ user: { id: "u1", role: "customer" } }, res);
    assert.equal(res.body.services[0].price, 45);
    assert.equal(res.body.services[0].basePrice, 60);
    assert.equal(res.body.services[0].monthlyPriceCents, 5500);
  } finally {
    prisma.service.findMany = originalFindMany;
    prisma.customPrice.findUnique = originalCpFind;
  }
});

// ---- Price snapshot safety: existing subscriptions are never mutated ----

test("monthly pricing changes never touch existing subscriptions (snapshot immutability)", async () => {
  const originalUpdate = prisma.service.update;
  const originalSubscriptionUpdate = prisma.subscription.update;
  let subscriptionUpdates = 0;
  prisma.service.update = async ({ data }) => ({ ...data });
  prisma.subscription.update = async () => { subscriptionUpdates += 1; return {}; };
  try {
    const res = response();
    await adminSetGlobalPrice({ params: { id: "s1" }, body: { monthlyPriceCents: 9999, monthlyActive: true } }, res);
    assert.equal(res.body.service.monthlyPriceCents, 9999);
    assert.equal(subscriptionUpdates, 0);
  } finally {
    prisma.service.update = originalUpdate;
    prisma.subscription.update = originalSubscriptionUpdate;
  }
});

test("a new subscription still snapshots the effective monthly price at creation time", async () => {
  const created = [];
  const tx = { booking: { create: async ({ data }) => { created.push(data); return data; } } };
  const original = {
    service: prisma.service.findUnique,
    customPrice: prisma.customPrice.findUnique,
    transaction: prisma.$transaction,
    user: prisma.user.findFirst,
    broadcast: prisma.broadcast.create,
  };
  prisma.service.findUnique = async () => service();
  prisma.customPrice.findUnique = async () => null;
  prisma.$transaction = async (fn) => fn(tx);
  prisma.user.findFirst = async () => ({ id: "admin1" });
  prisma.broadcast.create = async () => ({});
  try {
    const res = response();
    await createSubscriptionBooking({ body: { serviceId: "s1", date: "2026-11-01T15:00:00Z", months: 2 }, user: { id: "u1", name: "Ada" } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(created[0].subscription.create.monthlyPriceCents, 4000);
  } finally {
    prisma.service.findUnique = original.service;
    prisma.customPrice.findUnique = original.customPrice;
    prisma.$transaction = original.transaction;
    prisma.user.findFirst = original.user;
    prisma.broadcast.create = original.broadcast;
  }
});

// ---- Objective B: customer cancellation ----

const cancelReq = (overrides = {}) => ({ params: { id: "b1" }, body: {}, user: { id: "u1" }, ...overrides });
const bookingWith = (subscription) => ({
  id: "b1",
  customerId: "u1",
  customer: { id: "u1", name: "Ada", email: "ada@example.com", stripeCustomerId: "cus_1" },
  service: { id: "s1", name: "Weekly Cleaning" },
  payment: { method: "online" },
  subscription,
});

test("customer can schedule cancellation of their own active subscription at period end", async () => {
  const calls = { stripe: [], db: [] };
  const db = {
    booking: { findUnique: async () => bookingWith(subscription()) },
    subscription: { update: async ({ data }) => { calls.db.push(data); return { ...subscription(), ...data }; } },
  };
  const stripeClient = {
    subscriptions: {
      update: async (id, params, opts) => { calls.stripe.push({ id, params, opts }); return { id, ...params }; },
      cancel: async () => { throw new Error("immediate cancel must never be used"); },
    },
  };
  const res = response();
  await cancelSubscription(cancelReq(), res, { db, stripeClient });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.cancelAtPeriodEnd, true);
  assert.equal(calls.stripe.length, 1);
  assert.equal(calls.stripe[0].id, "sub_stripe_1");
  assert.deepEqual(calls.stripe[0].params, { cancel_at_period_end: true });
  assert.equal(calls.stripe[0].opts.idempotencyKey, "idem-1:customer-cancel");
  assert.deepEqual(calls.db, [{ cancelAtPeriodEnd: true }]);
  // The returned subscription keeps its paid period and immutable price intact.
  assert.equal(res.body.subscription.monthCompleted, 2);
  assert.equal(res.body.subscription.monthlyPriceCents, 4000);
  assert.equal(res.body.subscription.currentPeriodEnd.getTime(), new Date("2026-10-31T23:59:59Z").getTime());
  assert.equal(res.body.subscription.status, "active");
});

test("customer cannot cancel another customer's subscription", async () => {
  const stripeClient = { subscriptions: { update: async () => { throw new Error("must not be called"); } } };
  const db = { booking: { findUnique: async () => bookingWith(subscription({ customerId: "u2" })) } };
  const res = response();
  await cancelSubscription(cancelReq(), res, { db, stripeClient });
  assert.equal(res.statusCode, 404);
});

test("repeated cancellation is idempotent and creates no duplicate Stripe operation", async () => {
  let stripeCalls = 0;
  const db = {
    booking: { findUnique: async () => bookingWith(subscription({ cancelAtPeriodEnd: true })) },
  };
  const stripeClient = { subscriptions: { update: async () => { stripeCalls += 1; return {}; } } };
  const res = response();
  await cancelSubscription(cancelReq(), res, { db, stripeClient });
  assert.equal(res.body.alreadyScheduled, true);
  assert.equal(res.body.cancelAtPeriodEnd, true);
  assert.equal(stripeCalls, 0);
});

test("already canceled/completed subscription is handled safely with no Stripe call", async () => {
  for (const status of ["canceled", "completed"]) {
    const stripeClient = { subscriptions: { update: async () => { throw new Error("must not be called"); } } };
    const db = { booking: { findUnique: async () => bookingWith(subscription({ status })) } };
    const res = response();
    await cancelSubscription(cancelReq(), res, { db, stripeClient });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "SUBSCRIPTION_ENDED");
  }
});

test("Stripe cancellation failure leaves a retryable state and never updates the local row", async () => {
  const db = {
    booking: { findUnique: async () => bookingWith(subscription()) },
    subscription: { update: async () => { throw new Error("db update must not run when Stripe fails"); } },
  };
  const stripeClient = { subscriptions: { update: async () => { throw new Error("stripe down"); } } };
  const res = response();
  await cancelSubscription(cancelReq(), res, { db, stripeClient });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.retryable, true);
  assert.equal(res.body.cancelAtPeriodEnd, undefined);
});

test("pre-payment (accepted, not started) cancellation is a local status transition with no Stripe call", async () => {
  const updates = [];
  const stripeClient = { subscriptions: { update: async () => { throw new Error("must not be called"); } } };
  const db = {
    booking: { findUnique: async () => bookingWith(subscription({ stripeSubscriptionId: null, status: "accepted" })) },
    subscription: { update: async ({ data }) => { updates.push(data); return { ...subscription({ stripeSubscriptionId: null }), ...data }; } },
  };
  const res = response();
  await cancelSubscription(cancelReq(), res, { db, stripeClient });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.cancelAtPeriodEnd, false);
  assert.equal(updates[0].status, "canceled");
  assert.ok(updates[0].canceledAt instanceof Date);
});

test("a non-subscription booking cannot be cancelled", async () => {
  const db = { booking: { findUnique: async () => bookingWith(null) } };
  const res = response();
  await cancelSubscription(cancelReq(), res, { db, stripeClient: {} });
  assert.equal(res.statusCode, 400);
});

// ---- effectiveMonthlyPriceCents precedence (Objective C core) ----

test("effectiveMonthlyPriceCents gives override precedence over global", async () => {
  const override = { customPrice: { findUnique: async () => ({ monthlyPriceCents: 5500 }) } };
  const noOverride = { customPrice: { findUnique: async () => null } };
  assert.equal(await effectiveMonthlyPriceCents(service(), "u1", override), 5500);
  assert.equal(await effectiveMonthlyPriceCents(service(), "u1", noOverride), 4000);
  assert.equal(await effectiveMonthlyPriceCents(service({ monthlyActive: false }), "u1", override), null);
});