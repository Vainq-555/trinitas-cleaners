import test from "node:test";
import assert from "node:assert/strict";

// Set email env before importing modules that read it at load time.
process.env.EMAIL_FROM = "no-reply@send.trinitaso.com";
process.env.EMAIL_REPLY_TO = "support@trinitaso.com";
process.env.PUBLIC_WEB_URL = "https://web.trinitaso.com";

const { sendBookingConfirmationEmail } = await import("../src/utils/mail.js");
const { sendPaidBookingConfirmation } = await import("../src/controllers/payments.js");

const bookingFixture = (overrides = {}) => ({
  id: "b1",
  customerId: "u1",
  date: new Date("2026-09-10T15:00:00Z"),
  status: "accepted",
  note: null,
  basePriceCents: 4000,
  discountCents: 0,
  taxableSubtotalCents: 4000,
  taxCents: 290,
  taxRateBasisPoints: 725,
  finalAmountCents: 4290,
  taxCalculationId: "tax_1",
  taxAddressLine1: "1 Main St",
  taxAddressLine2: null,
  taxAddressCity: "Anoka",
  taxAddressState: "MN",
  taxAddressPostalCode: "55303",
  taxAddressCountry: "US",
  customer: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  service: { id: "s1", name: "Deep Clean" },
  payment: { id: "pay1", method: "online", status: "paid" },
  ...overrides,
});

const paidCheckoutEvent = (overrides = {}) => ({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { payment_status: "paid", metadata: { bookingId: "b1" } } },
  ...overrides,
});

test("sendBookingConfirmationEmail sends to the customer's real email with the confirmation payload", async () => {
  const calls = [];
  const transport = async ({ to, from, replyTo, subject, html, text }) => {
    calls.push({ to, from, replyTo, subject, html, text });
    return { ok: true };
  };
  const result = await sendBookingConfirmationEmail(bookingFixture(), "evt_1", null, transport);

  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, "ada@example.com");
  assert.equal(calls[0].from, "no-reply@send.trinitaso.com");
  assert.equal(calls[0].replyTo, "support@trinitaso.com");
  assert.equal(calls[0].subject, "Your Trinitas‑Cleaners Booking Confirmation");
  assert.match(calls[0].html, /Ada Lovelace/);
  assert.match(calls[0].html, /Deep Clean/);
  assert.match(calls[0].html, /\$42\.90/);
});

test("sendBookingConfirmationEmail records the stripe event id in the booking note for duplicate protection", async () => {
  const calls = [];
  const updates = [];
  const transport = async ({ to }) => { calls.push(to); return { ok: true }; };
  const db = { booking: { update: async ({ where, data }) => { updates.push({ where, data }); return { id: where.id }; } } };
  const result = await sendBookingConfirmationEmail(bookingFixture(), "evt_1", db, transport);

  assert.equal(result.sent, true);
  assert.equal(updates.length, 1);
  assert.match(updates[0].data.note, /stripe_event:evt_1/);
});

test("sendBookingConfirmationEmail skips duplicate sends for an already-emailed stripe event", async () => {
  const calls = [];
  const transport = async ({ to }) => { calls.push(to); return { ok: true }; };
  const booking = bookingFixture({ note: "| stripe_event:evt_1" });
  const result = await sendBookingConfirmationEmail(booking, "evt_1", null, transport);

  assert.deepEqual(result, { sent: false, reason: "duplicate" });
  assert.equal(calls.length, 0);
});

test("sendPaidBookingConfirmation sends when checkout.session.completed has payment_status paid", async () => {
  const queries = [];
  const sent = [];
  const db = { booking: { findUnique: async ({ where }) => { queries.push(where); return bookingFixture(); } } };
  const sendConfirmation = async (booking, stripeEventId) => { sent.push({ bookingId: booking.id, stripeEventId }); return { sent: true }; };

  const result = await sendPaidBookingConfirmation(paidCheckoutEvent(), { db, sendConfirmation });

  assert.equal(result.sent, true);
  assert.deepEqual(queries, [{ id: "b1" }]);
  assert.deepEqual(sent, [{ bookingId: "b1", stripeEventId: "evt_1" }]);
});

test("sendPaidBookingConfirmation reads bookingId from event.data.object.metadata, not event.metadata", async () => {
  const queries = [];
  const db = { booking: { findUnique: async ({ where }) => { queries.push(where); return bookingFixture(); } } };
  const sendConfirmation = async () => ({ sent: true });

  // Stripe Events have no top-level `metadata`; the id lives under data.object.
  const event = { id: "evt_2", type: "checkout.session.completed", data: { object: { payment_status: "paid", metadata: { bookingId: "b-custom" } } } };
  await sendPaidBookingConfirmation(event, { db, sendConfirmation });

  assert.deepEqual(queries, [{ id: "b-custom" }]);
});

test("sendPaidBookingConfirmation sends for checkout.session.async_payment_succeeded", async () => {
  const sent = [];
  const db = { booking: { findUnique: async () => bookingFixture() } };
  const sendConfirmation = async (booking, stripeEventId) => { sent.push(stripeEventId); return { sent: true }; };

  const result = await sendPaidBookingConfirmation({ id: "evt_3", type: "checkout.session.async_payment_succeeded", data: { object: { metadata: { bookingId: "b1" } } } }, { db, sendConfirmation });

  assert.equal(result.sent, true);
  assert.deepEqual(sent, ["evt_3"]);
});

test("sendPaidBookingConfirmation does NOT send for checkout.session.completed with a non-paid status", async () => {
  const sent = [];
  const db = { booking: { findUnique: async () => bookingFixture() } };
  const sendConfirmation = async () => { sent.push("called"); return { sent: true }; };

  const result = await sendPaidBookingConfirmation(
    { id: "evt_4", type: "checkout.session.completed", data: { object: { payment_status: "unpaid", metadata: { bookingId: "b1" } } } },
    { db, sendConfirmation },
  );

  assert.equal(result.sent, false);
  assert.equal(result.reason, "unpaid-checkout-state");
  assert.equal(sent.length, 0);
});

test("sendPaidBookingConfirmation does NOT send for expired, failed, or cancelled checkout states", async () => {
  const sent = [];
  const db = { booking: { findUnique: async () => bookingFixture() } };
  const sendConfirmation = async () => { sent.push("called"); return { sent: true }; };
  const deps = { db, sendConfirmation };

  const cases = [
    { id: "evt_e", type: "checkout.session.expired", data: { object: { metadata: { bookingId: "b1" } } } },
    { id: "evt_f", type: "checkout.session.async_payment_failed", data: { object: { metadata: { bookingId: "b1" } } } },
    { id: "evt_pf", type: "payment_intent.payment_failed", data: { object: { metadata: { bookingId: "b1" } } } },
  ];
  for (const event of cases) {
    const result = await sendPaidBookingConfirmation(event, deps);
    assert.equal(result.sent, false, event.type);
    assert.equal(result.reason, "unpaid-checkout-state", event.type);
  }
  assert.equal(sent.length, 0);
});

test("sendPaidBookingConfirmation does NOT query or send when metadata.bookingId is missing", async () => {
  let queries = 0;
  const db = { booking: { findUnique: async () => { queries += 1; return bookingFixture(); } } };
  const result = await sendPaidBookingConfirmation(
    { id: "evt_m", type: "checkout.session.completed", data: { object: { payment_status: "paid" } } },
    { db, sendConfirmation: async () => ({ sent: true }) },
  );

  assert.equal(result.sent, false);
  assert.equal(result.reason, "missing-booking-id");
  assert.equal(queries, 0);
});

test("sendPaidBookingConfirmation does NOT send when the booking is not found", async () => {
  const sent = [];
  const db = { booking: { findUnique: async () => null } };
  const result = await sendPaidBookingConfirmation(paidCheckoutEvent(), { db, sendConfirmation: async () => { sent.push("called"); return { sent: true }; } });

  assert.equal(result.sent, false);
  assert.equal(result.reason, "booking-not-found");
  assert.equal(sent.length, 0);
});