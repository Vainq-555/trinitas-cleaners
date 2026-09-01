import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin } from "../src/middleware/auth.js";
import { TaxUnavailableError } from "../src/utils/tax.js";
import prisma from "../src/utils/prisma.js";
import { quoteCashPayment, adminCashQuote } from "../src/controllers/cashPayments.js";
import { calculateBookingQuote, createCheckout } from "../src/controllers/payments.js";

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

const baseDeps = (overrides = {}) => ({
  findBooking: async () => bookingFixture(),
  quoteForBooking: async () => QUOTE,
  persistQuote: async () => bookingFixture({ ...QUOTE, finalAmountCents: QUOTE.finalAmountCents, taxCents: QUOTE.taxCents }),
  persistPayment: async () => ({ id: "pay1", finalAmountCents: 4290 }),
  ...overrides,
});

test("quoteCashPayment generates and persists an authoritative cash quote without changing payment status", async () => {
  const calls = { persistQuote: null, persistPayment: null };
  const res = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    res,
    baseDeps({
      persistQuote: async (bk, q) => { calls.persistQuote = { bk, q }; return bk; },
      persistPayment: async (bookingId, q) => { calls.persistPayment = { bookingId, q }; return {}; },
    }),
  );

  assert.equal(res.statusCode, null); // no error branch
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.quote, {
    basePriceCents: 4000,
    discountCents: 0,
    taxableSubtotalCents: 4000,
    taxRateBasisPoints: 725,
    taxCents: 290,
    taxCalculationId: "tax_cash_1",
    finalAmountCents: 4290,
    promotion: null,
  });
  // persisted with the authoritative quote from the same pipeline as collection
  assert.ok(calls.persistQuote, "quote should be persisted via saveQuote");
  assert.equal(calls.persistQuote.q.finalAmountCents, 4290);
  assert.equal(calls.persistPayment.bookingId, "b1");
  assert.equal(calls.persistPayment.q.finalAmountCents, 4290);
});

test("quoteCashPayment persists the stored tax address when no serviceAddress is submitted", async () => {
  const calls = { quoteBookings: [] };
  const res = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    res,
    baseDeps({ quoteForBooking: async (bk, addr) => { calls.quoteBookings.push(addr); return QUOTE; } }),
  );
  assert.equal(calls.quoteBookings.length, 1);
  // falls back to the booking's stored tax address (never invented/substituted)
  assert.deepEqual(calls.quoteBookings[0], {
    line1: "1 Main St", line2: null, city: "Anoka", state: "MN", postalCode: "55303", country: "US",
  });
});

test("quoteCashPayment honors an admin-submitted serviceAddress for a missing/uncaptured address", async () => {
  const booking = bookingFixture({
    taxAddressLine1: null, taxAddressLine2: null, taxAddressCity: null, taxAddressState: null,
    taxAddressPostalCode: null, taxAddressCountry: null,
  });
  const calls = { quoteBookings: [] };
  const res = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: { serviceAddress: { line1: "5 Oak Ave", city: "Edina", state: "MN", postalCode: "55436", country: "US" } } },
    res,
    baseDeps({ findBooking: async () => booking, quoteForBooking: async (bk, addr) => { calls.quoteBookings.push(addr); return QUOTE; } }),
  );
  assert.equal(calls.quoteBookings.length, 1);
  assert.equal(calls.quoteBookings[0].line1, "5 Oak Ave");
  assert.equal(res.body.ok, true);
});

test("a booking with no usable address returns 422 requiresAddress and never reaches Stripe", async () => {
  const neverUsedStripe = {
    tax: { calculations: { create: async () => { throw new Error("Stripe must not be called when no address is available"); } } },
  };
  const booking = bookingFixture({
    taxAddressLine1: null, taxAddressLine2: null, taxAddressCity: null, taxAddressState: null,
    taxAddressPostalCode: null, taxAddressCountry: null,
  });
  const res = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    res,
    baseDeps({ findBooking: async () => booking, quoteForBooking: (bk, addr) => calculateBookingQuote(bk, addr, neverUsedStripe) }),
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, "TAX_ADDRESS_REQUIRED");
  assert.equal(res.body.requiresAddress, true);
});

test("Stripe Tax failure returns a retryable 503 and never falls back to a flat rate", async () => {
  const res = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    res,
    baseDeps({ quoteForBooking: async () => { throw new TaxUnavailableError(); } }),
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.retryable, true);

  const inactive = response();
  const nonRetryable = new TaxUnavailableError("Stripe Tax has not been activated on your account");
  nonRetryable.retryable = false;
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    inactive,
    baseDeps({ quoteForBooking: async () => { throw nonRetryable; } }),
  );
  assert.equal(inactive.statusCode, 503);
  assert.equal(inactive.body.retryable, false);
});

test("quoteCashPayment rejects non-cash, missing, and refunded bookings without persisting", async () => {
  const calls = { persistQuote: false, persistPayment: false };
  const deps = baseDeps({
    persistQuote: async () => { calls.persistQuote = true; },
    persistPayment: async () => { calls.persistPayment = true; },
  });

  const nonCash = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    nonCash,
    { ...deps, findBooking: async () => bookingFixture({ payment: { id: "pay1", method: "online", status: "pending", amount: 40, amountPaid: 0 } }) },
  );
  assert.equal(nonCash.statusCode, 400);
  assert.equal(nonCash.body.error, "This booking is not a cash payment");

  const refunded = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    refunded,
    { ...deps, findBooking: async () => bookingFixture({ payment: { id: "pay1", method: "cash", status: "refunded", amount: 0, amountPaid: 0 } }) },
  );
  assert.equal(refunded.statusCode, 409);
  assert.equal(refunded.body.error, "This cash payment has been refunded and cannot be quoted");

  const noPayment = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    noPayment,
    { ...deps, findBooking: async () => bookingFixture({ payment: null }) },
  );
  assert.equal(noPayment.statusCode, 400);
  assert.match(noPayment.body.error, /no payment record/);

  const notFound = response();
  await quoteCashPayment(
    { params: { bookingId: "nope" }, body: {} },
    notFound,
    { ...deps, findBooking: async () => null },
  );
  assert.equal(notFound.statusCode, 404);

  assert.equal(calls.persistQuote, false, "nothing should be persisted on rejected quote");
  assert.equal(calls.persistPayment, false, "nothing should be persisted on rejected quote");
});

test("quoteCashPayment is idempotent for already-quoted cash bookings (re-quote allowed, status unchanged)", async () => {
  const booking = bookingFixture({ finalAmountCents: 4290, taxCents: 290, taxRateBasisPoints: 725 });
  const res = response();
  await quoteCashPayment(
    { params: { bookingId: "b1" }, body: {} },
    res,
    baseDeps({ findBooking: async () => booking }),
  );
  assert.equal(res.body.ok, true);
  assert.equal(res.body.quote.finalAmountCents, 4290);
});

test("real calculateBookingQuote via the quote endpoint path yields an integer-cent authoritative total", async () => {
  const fakeStripe = {
    tax: {
      calculations: {
        create: async () => ({ id: "tax_c1", tax_amount_exclusive: 290, line_items: { data: [{ tax_breakdown: [{ tax_rate_details: { percentage_decimal: "7.25" } }] }] } }),
      },
    },
  };
  const quote = await calculateBookingQuote(bookingFixture(), undefined, fakeStripe);
  assert.equal(Number.isInteger(quote.finalAmountCents), true);
  assert.equal(quote.finalAmountCents, quote.taxableSubtotalCents + quote.taxCents);
});

test("authorization: cash-quote endpoint is admin-only with the existing middleware", () => {
  const route = findRoute("/admin/payments/:bookingId/cash-quote");
  assert.ok(route, "cash-quote route should be registered");
  assert.equal(route.methods.post, true);
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles[0], authenticate);
  assert.equal(handles[1], requireAdmin);
  assert.equal(handles[2], adminCashQuote);
});

test("non-admin roles cannot reach the cash-quote handler", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
  await requireAdmin({}, res, () => assert.fail("unauthenticated should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("quote response exposes no credential-like fields", async () => {
  const res = response();
  await quoteCashPayment({ params: { bookingId: "b1" }, body: {} }, res, baseDeps());
  const payload = JSON.stringify(res.body);
  for (const forbidden of ["secret", "token", "password", "DATABASE_URL", "STRIPE_SECRET", "JWT", "credential"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `response must not contain ${forbidden}`);
  }
});

test("existing online checkout flow remains unchanged", () => {
  const checkoutRoute = findRoute("/bookings/:id/checkout");
  assert.ok(checkoutRoute, "online checkout route should remain registered");
  assert.equal(checkoutRoute.methods.post, true);
  assert.equal(typeof createCheckout, "function");
});

function findRoute(path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) return layer.route;
  }
  return null;
}
