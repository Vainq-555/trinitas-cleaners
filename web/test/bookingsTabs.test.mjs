import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_TABS,
  DEFAULT_TAB,
  isBookingTab,
  filterBySession,
  countBySession,
  EMPTY_STATE_TEXT,
} from "../lib/bookingsTabs.mjs";

const booking = (status, overrides = {}) => ({ id: `b-${status}-${Math.random()}`, status, ...overrides });

const PENDING = booking("pending");
const ACCEPTED_ONLINE_PAID = booking("accepted", {
  payment: { method: "online", status: "paid" },
});
const WORKED = booking("worked");
const DECLINED = booking("declined");

const ALL_BOOKINGS = [PENDING, ACCEPTED_ONLINE_PAID, WORKED, DECLINED];

test("tab definitions include an All tab plus pending, worked, declined", () => {
  assert.deepEqual(
    BOOKING_TABS.map((t) => t.id),
    ["all", "pending", "worked", "declined"]
  );
});

test("default tab is All", () => {
  assert.equal(DEFAULT_TAB, "all");
  assert.equal(isBookingTab(DEFAULT_TAB), true);
});

test("isBookingTab rejects unknown tab ids", () => {
  assert.equal(isBookingTab("pending"), true);
  assert.equal(isBookingTab("worked"), true);
  assert.equal(isBookingTab("declined"), true);
  assert.equal(isBookingTab("all"), true);
  assert.equal(isBookingTab("bogus"), false);
});

test("All tab returns every returned booking, unfiltered", () => {
  assert.deepEqual(filterBySession(ALL_BOOKINGS, "all"), ALL_BOOKINGS);
});

test("Pending Requests shows only status === pending", () => {
  const rows = filterBySession(ALL_BOOKINGS, "pending");
  assert.equal(rows.length, 1);
  assert.equal(rows[0], PENDING);
});

test("Accepted & Worked shows status === accepted or worked", () => {
  const rows = filterBySession(ALL_BOOKINGS, "worked");
  assert.deepEqual(new Set(rows), new Set([ACCEPTED_ONLINE_PAID, WORKED]));
});

test("Declined shows only status === declined", () => {
  const rows = filterBySession(ALL_BOOKINGS, "declined");
  assert.equal(rows.length, 1);
  assert.equal(rows[0], DECLINED);
});

test("a newly paid/accepted booking appears in Accepted & Worked", () => {
  const rows = filterBySession([PENDING, ACCEPTED_ONLINE_PAID], "worked");
  assert.ok(rows.includes(ACCEPTED_ONLINE_PAID));
});

test("a newly paid/accepted booking does NOT appear in Pending Requests", () => {
  const rows = filterBySession([PENDING, ACCEPTED_ONLINE_PAID], "pending");
  assert.ok(!rows.includes(ACCEPTED_ONLINE_PAID));
});

test("a newly paid/accepted booking appears in All", () => {
  const rows = filterBySession([PENDING, ACCEPTED_ONLINE_PAID], "all");
  assert.ok(rows.includes(ACCEPTED_ONLINE_PAID));
});

test("an unknown/none tab falls back to showing everything (All behavior)", () => {
  assert.deepEqual(filterBySession(ALL_BOOKINGS, "bogus"), ALL_BOOKINGS);
});

test("counts are derived from the same bookings array", () => {
  const counts = countBySession(ALL_BOOKINGS);
  assert.deepEqual(counts, { all: 4, pending: 1, worked: 2, declined: 1 });
  assert.equal(counts.all, ALL_BOOKINGS.length);
  assert.equal(
    counts.worked,
    filterBySession(ALL_BOOKINGS, "worked").length
  );
  assert.equal(
    counts.pending,
    filterBySession(ALL_BOOKINGS, "pending").length
  );
  assert.equal(
    counts.declined,
    filterBySession(ALL_BOOKINGS, "declined").length
  );
});

test("counts update when the bookings array changes (auto-refresh friendly)", () => {
  const before = countBySession([PENDING]);
  const after = countBySession([PENDING, ACCEPTED_ONLINE_PAID]);
  assert.equal(before.all, 1);
  assert.equal(after.all, 2);
  assert.equal(after.accepted ?? after.worked, after.worked);
  assert.equal(after.worked, 1);
  assert.equal(after.pending, 1);
});

test("filterBySession and countBySession tolerate non-array/empty input", () => {
  assert.deepEqual(filterBySession(null, "all"), []);
  assert.deepEqual(filterBySession(undefined, "pending"), []);
  assert.deepEqual(countBySession(undefined), { all: 0, pending: 0, worked: 0, declined: 0 });
});

test("empty-state copy exists for every tab", () => {
  for (const tab of BOOKING_TABS) {
    assert.equal(typeof EMPTY_STATE_TEXT[tab.id], "string");
    assert.ok(EMPTY_STATE_TEXT[tab.id].length > 0);
  }
});