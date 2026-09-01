import test from "node:test";
import assert from "node:assert/strict";
import { collectCashPayment } from "../src/controllers/cashPayments.js";
import { calculateBookingQuote } from "../src/controllers/payments.js";
import { effectivePrice } from "../src/controllers/services.js";
import { validateTaxAddress } from "../src/utils/tax.js";
import prisma from "../src/utils/prisma.js";

// Phase 4 — Multi-service cash-tax matrix.
//
// These tests drive the REAL production cash-collection pipeline
// (calculateBookingQuote -> calculateStripeTax -> calculateFinalQuote ->
// saveQuote -> payment paid) through the injected collectCashPayment deps,
// using a FAKE Stripe Tax client. No real Stripe calls, no DB writes.
//
// They prove cash collection uses the authoritative tax-inclusive
// finalAmountCents for EVERY seeded service and never falls back to the
// pre-tax booking.price, plus the distinct custom-price, discount+tax and
// zero-tax cases.

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

// A deterministic fake Stripe Tax. tax is derived from the taxable subtotal at
// a fixed rate (default 7.25%). It records every call so tests can assert the
// exact taxable amount handed to Stripe.
function fakeStripe({ rateBasisPoints = 725, taxAmountExclusive = null, calls = [] } = {}) {
  const rate = rateBasisPoints / 10000;
  return {
    tax: {
      calculations: {
        create: async (params) => {
          calls.push({ amountCents: params.line_items[0].amount, reference: params.line_items[0].reference, address: params.customer_details.address });
          const amount = params.line_items[0].amount;
          const taxCents = taxAmountExclusive !== null ? taxAmountExclusive : Math.round(amount * rate);
          return {
            id: `tax_${params.line_items[0].reference}_${calls.length}`,
            tax_amount_exclusive: taxCents,
            line_items: { data: [{ tax_breakdown: [{ tax_rate_details: { percentage_decimal: String(rateBasisPoints / 100) } }] }] },
          };
        },
      },
    },
  };
}

// Booking fixture matching the shape collectCashPayment + calculateBookingQuote
// expect. basePriceCents/taxableSubtotalCents mirror what createBooking writes
// for each seed service (basePrice -> dollarsToCents; discount applied).
function bookingFixture(service) {
  const { id, name, price, basePriceCents, discountCents = 0, taxableSubtotalCents = basePriceCents } = service;
  return {
    id: `b_${id}`,
    customerId: "u1",
    serviceId: id,
    status: "pending",
    price,
    basePriceCents,
    discountCents,
    taxableSubtotalCents,
    taxCents: null,
    taxRateBasisPoints: null,
    finalAmountCents: null,
    taxCalculationId: null,
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
    service: { id, name },
    payment: { id: `pay_${id}`, method: "cash", status: "unpaid", amount: price, amountPaid: 0, amountPaidCents: null, finalAmountCents: null },
  };
}

const makeTx = () => {
  const calls = { bookingUpdate: [], paymentUpdateMany: [], receiptCreate: [], receiptFindFirst: [] };
  const tx = {
    booking: { update: async ({ where, data }) => { calls.bookingUpdate.push({ where, data }); return { id: where.id, ...data }; } },
    payment: { updateMany: async ({ where, data }) => { calls.paymentUpdateMany.push({ where, data }); return { count: 1 }; } },
    receipt: {
      findFirst: async () => { calls.receiptFindFirst.push(true); return null; },
      create: async ({ data }) => { calls.receiptCreate.push(data); return { id: "rec_" + data.bookingId, ...data }; },
    },
  };
  return { tx, calls };
};

// End-to-end matrix: run collectCashPayment against the REAL calculateBookingQuote
// (with a fake Stripe Tax) for every seed service and assert every required invariant.
function collectMatrix() {
  const seed = [
    { id: "seed-Window Cleaning — Interior", name: "Window Cleaning — Interior", price: 12, basePriceCents: 1200 },
    { id: "seed-Window Cleaning — Exterior", name: "Window Cleaning — Exterior", price: 15, basePriceCents: 1500 },
    { id: "seed-Full Window Package (In & Out)", name: "Full Window Package (In & Out)", price: 25, basePriceCents: 2500 },
    { id: "seed-Screen Cleaning", name: "Screen Cleaning", price: 3, basePriceCents: 300 },
    { id: "seed-Carpet Cleaning", name: "Carpet Cleaning", price: 40, basePriceCents: 4000 },
    { id: "seed-Pressure Washing", name: "Pressure Washing", price: 65, basePriceCents: 6500 },
  ];
  const ADDRESS = { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" };

  return seed.map((svc) => {
    const stripeCalls = [];
    const stripe = fakeStripe({ calls: stripeCalls });
    const booking = bookingFixture(svc);
    const { tx, calls } = makeTx();
    const res = response();
    // The collected amount the admin submits must equal the quote's final amount.
    const finalAmountCents = booking.taxableSubtotalCents + Math.round(booking.taxableSubtotalCents * 0.0725);

    return {
      svc,
      run: async () => {
        await collectCashPayment(
          { params: { bookingId: booking.id }, body: { finalAmountCents } },
          res,
          {
            findBooking: async () => booking,
            quoteForBooking: (bk, addr) => calculateBookingQuote(bk, addr, stripe),
            runTransaction: async (fn) => fn(tx),
            paidAt: () => new Date("2026-08-30T12:00:00Z"),
          },
        );
      },
      get expected() {
        const taxable = booking.taxableSubtotalCents;
        const taxCents = Math.round(taxable * 0.0725);
        return { taxable, taxCents, taxRateBasisPoints: 725, finalAmountCents: taxable + taxCents };
      },
      get res() { return res; },
      get calls() { return calls; },
      get stripeCalls() { return stripeCalls; },
      get booking() { return booking; },
      get address() { return ADDRESS; },
    };
  });
}

test("multi-service matrix: every seeded service collects the tax-inclusive final amount", async () => {
  const matrix = collectMatrix();
  // Distinct base prices -> distinct subtotals -> distinct final amounts.
  const distinctPrices = new Set(matrix.map((m) => m.booking.basePriceCents));
  assert.equal(distinctPrices.size, 6, "matrix must cover 6 distinct seeded prices");

  const results = [];
  for (const m of matrix) {
    await m.run();
    const e = m.expected;
    results.push({ name: m.svc.name, finalAmountCents: m.res.body.payment.finalAmountCents, base: m.booking.basePriceCents, tax: e.taxCents });

    // Stripe Tax invoked once with the post-discount taxable subtotal.
    assert.equal(m.stripeCalls.length, 1, `${m.svc.name}: Stripe Tax must be called exactly once`);
    assert.equal(m.stripeCalls[0].amountCents, e.taxable, `${m.svc.name}: Stripe must receive the taxable subtotal`);
    assert.equal(m.stripeCalls[0].reference, m.svc.id);
    assert.deepEqual(Object.keys(m.stripeCalls[0].address).sort(), ["city", "country", "line1", "postal_code", "state"], `${m.svc.name}: Stripe Tax must receive the normalized address (line2 omitted when empty)`);

    // Response uses the authoritative tax-inclusive final amount.
    assert.equal(m.res.body.ok, true, `${m.svc.name} should collect successfully`);
    assert.equal(m.res.body.payment.status, "paid");
    assert.equal(m.res.body.payment.finalAmountCents, e.finalAmountCents);
    assert.equal(m.res.body.payment.amountPaidCents, e.finalAmountCents);
    assert.equal(m.res.body.payment.amountPaid, e.finalAmountCents / 100);
    assert.equal(m.res.body.payment.amount, e.finalAmountCents / 100, `${m.svc.name}: legacy dollar amount must equal tax-inclusive final`);

    // Payment persistence (updateMany) carries the tax-inclusive amount.
    const p = m.calls.paymentUpdateMany[0].data;
    assert.equal(p.status, "paid");
    assert.equal(p.finalAmountCents, e.finalAmountCents);
    assert.equal(p.amountPaidCents, e.finalAmountCents);
    assert.equal(p.amountPaid, e.finalAmountCents / 100);
    assert.equal(p.amount, e.finalAmountCents / 100);

    // Booking quote fields persisted consistently.
    const q = m.calls.bookingUpdate[0].data;
    assert.equal(q.basePriceCents, m.booking.basePriceCents);
    assert.equal(q.discountCents, m.booking.discountCents);
    assert.equal(q.taxableSubtotalCents, e.taxable);
    assert.equal(q.taxCents, e.taxCents);
    assert.equal(q.taxRateBasisPoints, 725);
    assert.equal(q.taxCalculationId, `tax_${m.svc.id}_1`);
    assert.equal(q.finalAmountCents, e.finalAmountCents);
    assert.equal(q.finalAmountCents, q.taxableSubtotalCents + q.taxCents, `${m.svc.name}: final = taxable subtotal + tax`);

    // Receipt uses the same tax-inclusive final amount.
    const r = m.calls.receiptCreate[0];
    assert.equal(r.finalAmountCents, e.finalAmountCents);
    assert.equal(r.taxCents, e.taxCents);
    assert.equal(r.taxableSubtotalCents, e.taxable);
    assert.equal(r.total, e.finalAmountCents / 100);
    assert.equal(r.taxRateBasisPoints, 725);
  }

  // Distinct final amounts across the matrix prove real, non-colliding math.
  const distinctFinals = new Set(results.map((r) => r.finalAmountCents));
  assert.equal(distinctFinals.size, 6, "matrix must yield 6 distinct final amounts");
});

test("multi-service matrix final amounts are exact integers and never the pre-tax price", async () => {
  const matrix = collectMatrix();
  for (const m of matrix) {
    await m.run();
    const e = m.expected;
    const final = m.res.body.payment.finalAmountCents;
    assert.equal(Number.isInteger(final), true, `${m.svc.name}: finalAmountCents must be an integer`);
    assert.notEqual(final, m.booking.basePriceCents, `${m.svc.name}: collected amount must NOT equal pre-tax base price`);
    assert.notEqual(final, m.booking.price, `${m.svc.name}: collected amount must NOT equal booking.price`);
    assert.ok(final > m.booking.basePriceCents, `${m.svc.name}: final includes tax, so must exceed the pre-tax base`);
  }
});

test("zero-tax cash collection: Stripe returns tax_amount_exclusive=0 and the booking still becomes paid", async () => {
  // Screen Cleaning ($3 -> 300c) with zero tax. 0 is a legitimate Stripe result.
  const svc = { id: "seed-Screen Cleaning", name: "Screen Cleaning", price: 3, basePriceCents: 300, taxableSubtotalCents: 300 };
  const stripeCalls = [];
  const stripe = fakeStripe({ taxAmountExclusive: 0, calls: stripeCalls });
  const booking = bookingFixture(svc);
  const { tx, calls } = makeTx();
  const res = response();

  await collectCashPayment(
    { params: { bookingId: booking.id }, body: { finalAmountCents: 300 } },
    res,
    {
      findBooking: async () => booking,
      quoteForBooking: (bk, addr) => calculateBookingQuote(bk, addr, stripe),
      runTransaction: async (fn) => fn(tx),
      paidAt: () => new Date("2026-08-30T12:00:00Z"),
    },
  );

  assert.equal(res.body.ok, true);
  assert.equal(stripeCalls.length, 1);
  assert.equal(stripeCalls[0].amountCents, 300);

  // taxCents = 0, finalAmountCents = taxableSubtotalCents.
  assert.equal(res.body.payment.finalAmountCents, 300);
  assert.equal(res.body.payment.amountPaidCents, 300);
  assert.equal(res.body.payment.status, "paid");

  const q = calls.bookingUpdate[0].data;
  assert.equal(q.taxCents, 0);
  assert.equal(q.taxableSubtotalCents, 300);
  assert.equal(q.finalAmountCents, 300);
  assert.equal(q.finalAmountCents, q.taxableSubtotalCents + q.taxCents);

  const r = calls.receiptCreate[0];
  assert.equal(r.taxCents, 0);
  assert.equal(r.finalAmountCents, 300);
  assert.equal(r.total, 3);
});

test("discount + tax: Stripe Tax receives the post-discount subtotal and final = base - discount + tax", async () => {
  // Pressure Washing ($65 -> 6500c) with a $10 fixed discount (1000c).
  const svc = { id: "seed-Pressure Washing", name: "Pressure Washing", price: 65, basePriceCents: 6500, discountCents: 1000, taxableSubtotalCents: 5500 };
  const stripeCalls = [];
  const stripe = fakeStripe({ calls: stripeCalls });
  const booking = bookingFixture(svc);
  const { tx, calls } = makeTx();
  const res = response();
  const expectedFinal = 5500 + Math.round(5500 * 0.0725); // 5500 + 399 = 5899

  await collectCashPayment(
    { params: { bookingId: booking.id }, body: { finalAmountCents: expectedFinal } },
    res,
    {
      findBooking: async () => booking,
      quoteForBooking: (bk, addr) => calculateBookingQuote(bk, addr, stripe),
      runTransaction: async (fn) => fn(tx),
      paidAt: () => new Date("2026-08-30T12:00:00Z"),
    },
  );

  assert.equal(res.body.ok, true);
  assert.equal(stripeCalls[0].amountCents, 5500, "Stripe Tax must be computed on the POST-discount subtotal");
  assert.equal(res.body.payment.finalAmountCents, expectedFinal);
  const q = calls.bookingUpdate[0].data;
  assert.equal(q.discountCents, 1000);
  assert.equal(q.taxableSubtotalCents, 5500);
  assert.equal(q.taxCents, 399);
  assert.equal(q.finalAmountCents, 5899);
  assert.equal(q.finalAmountCents, q.basePriceCents - q.discountCents + q.taxCents);
});

test("custom price: effectivePrice returns the CustomPrice override, bookable and taxed at the custom rate", async () => {
  // A CustomPrice row overrides the service basePrice for one customer only.
  const service = { id: "seed-Carpet Cleaning", name: "Carpet Cleaning", basePrice: 40 };
  const originalFindUnique = prisma.customPrice.findUnique;
  prisma.customPrice.findUnique = async ({ where }) =>
    where.serviceId_customerId.customerId === "u1"
      ? { id: "cp1", serviceId: service.id, customerId: "u1", price: 27.5 }
      : null;

  try {
    assert.equal(await effectivePrice(service, "u1"), 27.5, "custom price must override the default for that customer");
    assert.equal(await effectivePrice(service, "other"), 40, "other customers keep the default base price");
  } finally {
    prisma.customPrice.findUnique = originalFindUnique;
  }

  // Now drive cash collection at the custom rate (2750c), the amount createBooking
  // would have written as basePriceCents for this customer.
  const custom = { id: "seed-Carpet Cleaning", name: "Carpet Cleaning", price: 27.5, basePriceCents: 2750, taxableSubtotalCents: 2750 };
  const stripeCalls = [];
  const stripe = fakeStripe({ calls: stripeCalls });
  const booking = bookingFixture(custom);
  const { tx, calls } = makeTx();
  const res = response();
  const expectedFinal = 2750 + Math.round(2750 * 0.0725); // 2750 + 199 = 2949

  await collectCashPayment(
    { params: { bookingId: booking.id }, body: { finalAmountCents: expectedFinal } },
    res,
    {
      findBooking: async () => booking,
      quoteForBooking: (bk, addr) => calculateBookingQuote(bk, addr, stripe),
      runTransaction: async (fn) => fn(tx),
      paidAt: () => new Date("2026-08-30T12:00:00Z"),
    },
  );

  assert.equal(res.body.ok, true);
  assert.equal(stripeCalls[0].amountCents, 2750, "Stripe Tax must be computed on the custom (not default) price");
  assert.equal(res.body.payment.finalAmountCents, expectedFinal);
  const q = calls.bookingUpdate[0].data;
  assert.equal(q.basePriceCents, 2750);
  assert.equal(q.taxCents, 199);
  assert.equal(q.finalAmountCents, 2949);
  assert.equal(q.finalAmountCents, q.taxableSubtotalCents + q.taxCents);
});

test("every service reaches the same single Stripe Tax authority (no per-service bypass)", async () => {
  const matrix = collectMatrix();
  let totalStripeCalls = 0;
  for (const m of matrix) {
    await m.run();
    totalStripeCalls += m.stripeCalls.length;
  }
  // One Stripe Tax call per service, always through calculateBookingQuote/calculateStripeTax.
  assert.equal(totalStripeCalls, 6);
});

test("location -> tax: a fully resolved address shape feeds straight into Stripe Tax (no client tax)", async () => {
  // This is EXACTLY the {line1, city, state, postalCode, country} shape the
  // geocode endpoint returns (see api/src/controllers/geocode.js success path).
  const resolved = { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" };

  // The server normalizes it into the shape Stripe Tax expects.
  const normalized = validateTaxAddress(resolved);
  assert.deepEqual(normalized, { line1: "1 Main St", city: "Anoka", state: "MN", postal_code: "55303", country: "US" });

  // And a real calculateBookingQuote (fake Stripe) accepts that resolved address
  // exactly as submitted (no transformation loss), preserving the geocoded fields.
  const svc = { id: "seed-Window Cleaning — Interior", name: "Window Cleaning — Interior", price: 12, basePriceCents: 1200, taxableSubtotalCents: 1200 };
  const stripeCalls = [];
  const stripe = fakeStripe({ calls: stripeCalls });
  const booking = bookingFixture(svc);
  const quote = await calculateBookingQuote(booking, resolved, stripe);

  assert.equal(quote.taxAddress.line1, "1 Main St");
  assert.equal(quote.taxAddress.city, "Anoka");
  assert.equal(quote.taxAddress.state, "MN");
  assert.equal(quote.taxAddress.postalCode, "55303");
  assert.equal(quote.taxAddress.country, "US");
  assert.equal(stripeCalls[0].address.country, "US");
  assert.equal(stripeCalls[0].address.postal_code, "55303");
  assert.ok(Number.isInteger(quote.finalAmountCents));

  // Coordinates are never part of the address sent to Stripe Tax.
  assert.equal("lat" in quote.taxAddress, false);
  assert.equal("lon" in quote.taxAddress, false);
});

