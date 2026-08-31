import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin } from "../src/middleware/auth.js";
import { adminCreateReceipt } from "../src/controllers/receipts.js";
import { receiptSnapshotData } from "../src/controllers/payments.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const AUTHORITATIVE_BOOKING = {
  id: "b1",
  customerId: "u1",
  basePriceCents: 4000,
  discountCents: 0,
  taxableSubtotalCents: 4000,
  taxRateBasisPoints: 725,
  taxCents: 290,
  finalAmountCents: 4290,
  customer: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  payment: {
    id: "pay1",
    method: "cash",
    status: "paid",
    amountPaidCents: 4290,
    finalAmountCents: 4290,
  },
};

const makeDb = (booking = AUTHORITATIVE_BOOKING) => {
  const calls = { bookingFind: 0, receiptCreate: [], broadcastCreate: [], userFind: 0 };
  const db = {
    booking: {
      findUnique: async ({ where }) => {
        calls.bookingFind += 1;
        if (where.id !== booking.id) return null;
        return booking;
      },
    },
    receipt: {
      create: async ({ data }) => {
        calls.receiptCreate.push(data);
        return { id: "r_snapshot", ...data, customer: { id: data.customerId }, booking: { service: {} } };
      },
    },
    broadcast: {
      create: async ({ data }) => {
        calls.broadcastCreate.push(data);
        return { id: "bc1" };
      },
    },
    user: {
      findUnique: async ({ where }) => {
        calls.userFind += 1;
        if (where.id === "u1") return { id: "u1", name: "Ada", email: "ada@example.com" };
        return null;
      },
    },
  };
  return { db, calls };
};

test("booking-linked receipt is derived from stored authoritative cents, ignoring client floats and the default rate", async () => {
  const { db, calls } = makeDb();
  const res = response();
  await adminCreateReceipt(
    { body: { bookingId: "b1", customerId: "u1", subtotal: 9999, taxRate: 0, note: "cash collect" } },
    res,
    db,
  );

  assert.equal(res.statusCode, 201);
  const created = calls.receiptCreate[0];
  // Drift prevention: totals come from stored cents, not the client's float subtotal/rate.
  assert.equal(created.subtotal, 40);
  assert.equal(created.tax, 2.9);
  assert.equal(created.taxRate, 0.0725);
  assert.equal(created.discount, 0);
  assert.equal(created.total, 42.9);
  // Authoritative integer-cent snapshot persisted.
  assert.equal(created.baseAmountCents, 4000);
  assert.equal(created.taxableSubtotalCents, 4000);
  assert.equal(created.taxRateBasisPoints, 725);
  assert.equal(created.taxCents, 290);
  assert.equal(created.finalAmountCents, 4290);
  assert.equal(created.bookingId, "b1");
  assert.equal(created.customerId, "u1");
  assert.equal(created.note, "cash collect");
  // Notification uses the derived total.
  assert.equal(calls.broadcastCreate.length, 1);
  assert.match(calls.broadcastCreate[0].content, /42\.90/);
});

test("booking-linked receipt rejects a mismatched customerId", async () => {
  const { db, calls } = makeDb();
  const res = response();
  await adminCreateReceipt({ body: { bookingId: "b1", customerId: "u99" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /does not match the booking's customer/);
  assert.equal(calls.receiptCreate.length, 0);
  assert.equal(calls.broadcastCreate.length, 0);
});

test("booking-linked receipt for a missing booking returns 404", async () => {
  const { db, calls } = makeDb(AUTHORITATIVE_BOOKING);
  const res = response();
  await adminCreateReceipt({ body: { bookingId: "missing" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(calls.receiptCreate.length, 0);
});

test("legacy booking without stored integer cents is rejected with 422 NO_AUTHORITATIVE_QUOTE (no backfill, no fake receipt)", async () => {
  const legacyBooking = {
    id: "old",
    customerId: "u1",
    basePriceCents: 4000,
    taxableSubtotalCents: 4000,
    taxCents: null,
    finalAmountCents: null,
    customer: { id: "u1" },
    payment: { id: "pay1", method: "cash", status: "unpaid", finalAmountCents: null },
  };
  const { db, calls } = makeDb(legacyBooking);
  const res = response();
  await adminCreateReceipt({ body: { bookingId: "old" } }, res, db);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, "NO_AUTHORITATIVE_QUOTE");
  assert.equal(calls.receiptCreate.length, 0);
  assert.equal(calls.broadcastCreate.length, 0);
});

test("booking with no payment record cannot be re-receipted (422)", async () => {
  const noPayment = { ...AUTHORITATIVE_BOOKING, payment: null };
  const { db, calls } = makeDb(noPayment);
  const res = response();
  await adminCreateReceipt({ body: { bookingId: "b1" } }, res, db);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, "NO_AUTHORITATIVE_QUOTE");
  assert.equal(calls.receiptCreate.length, 0);
});

test("booking-linked receipt depends on payment.finalAmountCents being an integer (snapshot requires it)", () => {
  const halfAuthoritative = {
    ...AUTHORITATIVE_BOOKING,
    finalAmountCents: 4290,
    payment: { ...AUTHORITATIVE_BOOKING.payment, finalAmountCents: null },
  };
  assert.equal(receiptSnapshotData(halfAuthoritative, halfAuthoritative.payment), null);
});

test("no-booking (standalone) manual receipt keeps the existing float path unchanged", async () => {
  const { db, calls } = makeDb();
  const res = response();
  await adminCreateReceipt(
    { body: { customerId: "u1", subtotal: 50, taxRate: 0.08, discount: 5, note: "walk-in" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
  const created = calls.receiptCreate[0];
  assert.equal(created.bookingId, null);
  assert.equal(created.subtotal, 50);
  assert.equal(created.tax, 4);
  assert.equal(created.discount, 5);
  assert.equal(created.total, 49);
  assert.equal(created.taxRate, 0.08);
  // No integer-cent snapshot on the manual path.
  assert.equal(created.baseAmountCents, undefined);
  assert.equal(calls.broadcastCreate.length, 1);
});

test("no-booking manual receipt still enforces customerId and non-negative subtotal", async () => {
  const { db } = makeDb();
  const noCustomer = response();
  await adminCreateReceipt({ body: { subtotal: 10 } }, noCustomer, db);
  assert.equal(noCustomer.statusCode, 400);
  assert.match(noCustomer.body.error, /customerId and a non-negative subtotal/);

  const negative = response();
  await adminCreateReceipt({ body: { customerId: "u1", subtotal: -1 } }, negative, db);
  assert.equal(negative.statusCode, 400);

  const missingCustomer = response();
  await adminCreateReceipt({ body: { customerId: "nobody", subtotal: 10 } }, missingCustomer, db);
  assert.equal(missingCustomer.statusCode, 400);
  assert.match(missingCustomer.body.error, /Customer not found/);
});

test("shared receiptSnapshotData produces authoritative floats from integer cents without drift", () => {
  const booking = AUTHORITATIVE_BOOKING;
  const data = receiptSnapshotData(booking, booking.payment);
  assert.equal(data.subtotal, 40);
  assert.equal(data.tax, 2.9);
  assert.equal(data.taxRate, 0.0725);
  assert.equal(data.total, 42.9);
  assert.equal(data.finalAmountCents, 4290);
  assert.equal(Number.isInteger(data.finalAmountCents), true);
});

test("adminCreateReceipt is registered as an admin-only endpoint", () => {
  const route = findRoute("/admin/receipts", "post");
  assert.ok(route, "admin receipts POST route should be registered");
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles[0], authenticate);
  assert.equal(handles[1], requireAdmin);
  assert.equal(handles[2], adminCreateReceipt);
});

test("non-admin roles cannot reach the receipt creation handler", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
  await requireAdmin({}, res, () => assert.fail("unauthenticated should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

function findRoute(path, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      if (!method || layer.route.methods[method]) return layer.route;
    }
  }
  return null;
}