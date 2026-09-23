import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { listMyBookings, adminListBookings } from "../src/controllers/bookings.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

// Booking factory. `subscriptionBookings` is non-empty ONLY for paid
// monthly-period lanes (SubscriptionBooking-backed bookings); it is the
// relation the customer list query must filter on.
const booking = (overrides = {}) => ({
  id: "b1",
  customerId: "u1",
  serviceId: "s1",
  service: { id: "s1", name: "Screen Cleaning" },
  status: "accepted",
  date: new Date("2026-09-01T00:00:00Z"),
  createdAt: new Date("2026-09-01T00:00:00Z"),
  archivedAt: null,
  price: 15,
  subscription: null,
  subscriptionBookings: [],
  payment: null,
  ...overrides,
});

const oneTime = () => booking({ id: "b_ot", status: "accepted" });
const requestLane = () => booking({ id: "b_req", status: "accepted", subscription: { id: "sub_1", months: 7, monthCompleted: 0, monthlyPriceCents: 1500, status: "accepted" } });
const paidMonthLane = () => booking({ id: "b_lane", status: "accepted", subscriptionBookings: [{ id: "sbl_1", periodIndex: 1 }] });

// Mimic Prisma's filter semantics so a stubbed findMany behaves like the real
// DB: apply customer/status/archivedAt predicate plus the month-lane exclusion
// exactly when the caller supplied `NOT: { subscriptionBookings: { some } }`.
const buildMany = (rows) => async ({ where }) => {
  const excludeLanes = Boolean(where.NOT?.subscriptionBookings?.some);
  const status = where.status || null;
  return rows.filter((b) => {
    if (where.customerId && b.customerId !== where.customerId) return false;
    if (b.archivedAt !== (where.archivedAt ?? null)) return false;
    if (status && b.status !== status) return false;
    if (excludeLanes && b.subscriptionBookings.length > 0) return false;
    return true;
  });
};

// ---- Customer GET /bookings (listMyBookings) ----

test("listMyBookings where clause preserves customer/archivedAt and excludes SubscriptionBooking lanes", async () => {
  const originalFindMany = prisma.booking.findMany;
  let captured;
  prisma.booking.findMany = async ({ where, include }) => { captured = { where, include }; return []; };
  try {
    const res = response();
    await listMyBookings({ user: { id: "u1" } }, res);
    assert.equal(captured.where.customerId, "u1");
    assert.equal(captured.where.archivedAt, null);
    // Must target the SubscriptionBooking relation, not `subscription: null`.
    assert.deepEqual(captured.where.NOT.subscriptionBookings.some, {});
    assert.equal(captured.where.subscription, undefined);
  } finally {
    prisma.booking.findMany = originalFindMany;
  }
});

test("customer GET /bookings shows one-time and monthly request bookings but not paid month lanes", async () => {
  const originalFindMany = prisma.booking.findMany;
  prisma.booking.findMany = buildMany([oneTime(), requestLane(), paidMonthLane()]);
  try {
    const res = response();
    await listMyBookings({ user: { id: "u1" } }, res);
    const ids = res.body.bookings.map((b) => b.id).sort();
    assert.deepEqual(ids, ["b_ot", "b_req"]);
    assert.ok(!ids.includes("b_lane"));
  } finally {
    prisma.booking.findMany = originalFindMany;
  }
});

test("customer GET /bookings never filters on the archived-at visible lane records in DB", async () => {
  const originalFindMany = prisma.booking.findMany;
  prisma.booking.findMany = buildMany([paidMonthLane(), oneTime()]);
  try {
    // The DB rows themselves are never modified/deleted: the lane booking still
    // exists underneath; the query merely omits it from the customer result.
    const all = await prisma.booking.findMany({ where: { customerId: "u1", archivedAt: null } });
    assert.equal(all.length, 2);
    const res = response();
    await listMyBookings({ user: { id: "u1" } }, res);
    assert.deepEqual(res.body.bookings.map((b) => b.id), ["b_ot"]);
  } finally {
    prisma.booking.findMany = originalFindMany;
  }
});

// ---- Admin GET /bookings (adminListBookings) ----

test("adminListBookings keeps paid month-lane bookings visible (no lane exclusion)", async () => {
  const originalFindMany = prisma.booking.findMany;
  let captured;
  prisma.booking.findMany = async ({ where }) => { captured = where; return buildMany([oneTime(), requestLane(), paidMonthLane()])({ where }); };
  try {
    const res = response();
    await adminListBookings({ query: {}, user: { id: "admin" } }, res);
    assert.equal(captured.NOT, undefined);
    assert.deepEqual(res.body.bookings.map((b) => b.id).sort(), ["b_lane", "b_ot", "b_req"]);
  } finally {
    prisma.booking.findMany = originalFindMany;
  }
});