import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { createBooking } from "../src/controllers/bookings.js";
import { createSubscriptionBooking } from "../src/controllers/subscriptions.js";
import {
  BUSINESS_TIMEZONE,
  isValidDateString,
  isValidTimeString,
  parseScheduledStart,
  formatChicagoStart,
} from "../src/utils/schedule.js";

const response = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const service = { id: "s1", name: "Screen Cleaning", isActive: true, basePrice: 15, monthlyActive: true, monthlyPriceCents: 1200 };

// Arrange prisma stubs so a booking create succeeds without any real DB.
// Returns a capture object whose `.created` is the Booking.create data.
// Deliberately mutates each model DELEGATE method in place and restores it in
// place: never reassign a model namespace object, or the shared singleton's
// namespace is replaced by a bare function for the other tests in the run.
const stubCreateFlow = (rows = {}) => {
  const capture = { created: null };
  const stash = [];
  const stub = (model, method, impl) => {
    const ns = prisma[model];
    stash.push({ ns, method, saved: ns[method] });
    ns[method] = impl;
  };
  stub("service", "findUnique", async ({ where }) => (rows.service ?? service));
  stub("customPrice", "findUnique", async () => null);
  stub("promotion", "findMany", async () => []);
  const savedTx = prisma.$transaction;
  prisma.$transaction = async (fn) => fn({
    booking: { create: async (args) => { capture.created = args.data; return { id: "b1" }; } },
  });
  stub("user", "findFirst", async () => null);
  stub("broadcast", "create", async () => ({}));
  return {
    capture,
    restore: () => {
      for (const { ns, method, saved } of stash) ns[method] = saved;
      prisma.$transaction = savedTx;
    },
  };
};

// ---- Schedule conversion utilities ----

test("parseScheduledStart: absent fields are allowed (legacy bookings stay valid)", () => {
  const r = parseScheduledStart({});
  assert.equal(r.ok, true);
  assert.equal(r.scheduledStart, null);
  // Empty strings from a fresh/unscheduled form also mean "no schedule".
  const blank = parseScheduledStart({ scheduledStartDate: "", scheduledStartTime: "" });
  assert.equal(blank.ok, true);
  assert.equal(blank.scheduledStart, null);
});

test("parseScheduledStart: requires date and time together", () => {
  assert.equal(parseScheduledStart({ scheduledStartDate: "2026-09-27" }).ok, false);
  assert.equal(parseScheduledStart({ scheduledStartTime: "10:00" }).ok, false);
});

test("parseScheduledStart: rejects malformed date and time", () => {
  assert.equal(parseScheduledStart({ scheduledStartDate: "2026-09-32", scheduledStartTime: "10:00" }).ok, false);
  assert.equal(parseScheduledStart({ scheduledStartDate: "not-a-date", scheduledStartTime: "10:00" }).ok, false);
  assert.equal(parseScheduledStart({ scheduledStartDate: "2026-09-27", scheduledStartTime: "25:00" }).ok, false);
  assert.equal(parseScheduledStart({ scheduledStartDate: "2026-09-27", scheduledStartTime: "10:5" }).ok, false);
});

test("parseScheduledStart: converts America/Chicago wall clock to the UTC instant", () => {
  // September 27 2026 is CDT (UTC-5): 10:00 wall time -> 15:00 UTC.
  const summer = parseScheduledStart({ scheduledStartDate: "2026-09-27", scheduledStartTime: "10:00" });
  assert.equal(summer.ok, true);
  assert.equal(summer.scheduledStart.getTime(), new Date("2026-09-27T15:00:00.000Z").getTime());
  // January 15 2026 is CST (UTC-6): 10:00 wall time -> 16:00 UTC.
  const winter = parseScheduledStart({ scheduledStartDate: "2026-01-15", scheduledStartTime: "10:00" });
  assert.equal(winter.ok, true);
  assert.equal(winter.scheduledStart.getTime(), new Date("2026-01-15T16:00:00.000Z").getTime());
});

test("isValidDateString / isValidTimeString / formatChicagoStart sanity", () => {
  assert.equal(isValidDateString("2026-09-27"), true);
  assert.equal(isValidDateString("2026-09-32"), false);
  assert.equal(isValidDateString("2026-2-3"), false);
  assert.equal(isValidTimeString("10:00"), true);
  assert.equal(isValidTimeString("23:59"), true);
  assert.equal(isValidTimeString("24:00"), false);
  const fmt = formatChicagoStart(new Date("2026-09-27T15:00:00.000Z").toISOString());
  assert.equal(fmt.timezone, BUSINESS_TIMEZONE);
  assert.equal(fmt.date, "September 27, 2026");
  assert.equal(fmt.time, "10:00 AM");
  assert.equal(formatChicagoStart(null), null);
});

// ---- One-time lane (createBooking) ----

test("createBooking persists service location + schedule fields", async () => {
  const { capture, restore } = stubCreateFlow();
  try {
    const res = response();
    await createBooking({
      user: { id: "u1", name: "Ada" },
      body: {
        serviceId: "s1",
        date: "2026-09-28",
        paymentMethod: "cash",
        serviceAddress: { line1: "Tax St", city: "Minneapolis", state: "MN", postalCode: "55303", country: "US" },
        serviceLocation: { line1: "123 Work Way", line2: "Unit B", city: "Chicago", state: "IL", postalCode: "60607", country: "US" },
        serviceLocationInstructions: "  gate code 1234  ",
        scheduledStartDate: "2026-09-27",
        scheduledStartTime: "10:00",
      },
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(capture.created.serviceLocationAddressLine1, "123 Work Way");
    assert.equal(capture.created.serviceLocationAddressLine2, "Unit B");
    assert.equal(capture.created.serviceLocationCity, "Chicago");
    assert.equal(capture.created.serviceLocationState, "IL");
    assert.equal(capture.created.serviceLocationPostalCode, "60607");
    assert.equal(capture.created.serviceLocationCountry, "US");
    assert.equal(capture.created.serviceLocationInstructions, "gate code 1234");
    assert.equal(capture.created.scheduledStartAt.getTime(), new Date("2026-09-27T15:00:00.000Z").getTime());
    // Existing fields keep working unchanged.
    assert.equal(capture.created.taxAddressCity, "Minneapolis");
    assert.equal(capture.created.date.getTime(), new Date("2026-09-28").getTime());
  } finally {
    restore();
  }
});

test("createBooking rejects a malformed schedule instead of silently dropping it", async () => {
  const { restore } = stubCreateFlow();
  try {
    const res = response();
    await createBooking({
      user: { id: "u1", name: "Ada" },
      body: {
        serviceId: "s1",
        date: "2026-09-28",
        scheduledStartDate: "2026-09-27",
        scheduledStartTime: "25:00",
      },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes("scheduledStartTime"));
  } finally {
    restore();
  }
});

test("createBooking rejects invalid service location", async () => {
  const { restore } = stubCreateFlow();
  try {
    const res = response();
    await createBooking({
      user: { id: "u1", name: "Ada" },
      body: {
        serviceId: "s1",
        date: "2026-09-28",
        serviceLocation: { line1: "No state", city: "Chicago", state: "ZZ", postalCode: "60607", country: "US" },
        scheduledStartDate: "2026-09-27",
        scheduledStartTime: "10:00",
      },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.includes("state"));
  } finally {
    restore();
  }
});

test("createBooking legacy request without location/schedule still succeeds (no fabricated times)", async () => {
  const { capture, restore } = stubCreateFlow();
  try {
    const res = response();
    await createBooking({
      user: { id: "u1", name: "Ada" },
      body: { serviceId: "s1", date: "2026-09-28", paymentMethod: "cash" },
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(capture.created.serviceLocationAddressLine1, null);
    assert.equal(capture.created.serviceLocationInstructions, null);
    assert.equal(capture.created.scheduledStartAt, undefined);
  } finally {
    restore();
  }
});

// ---- Monthly lane (createSubscriptionBooking) ----

test("createSubscriptionBooking persists service location + schedule fields", async () => {
  const { capture, restore } = stubCreateFlow();
  try {
    const res = response();
    await createSubscriptionBooking({
      user: { id: "u1", name: "Ada" },
      body: {
        serviceId: "s1",
        date: "2026-09-28",
        months: 3,
        serviceAddress: { line1: "Tax St", city: "Minneapolis", state: "MN", postalCode: "55303", country: "US" },
        serviceLocation: { line1: "123 Work Way", city: "Chicago", state: "IL", postalCode: "60607", country: "US" },
        scheduledStartDate: "2026-01-15",
        scheduledStartTime: "10:00",
      },
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(capture.created.serviceLocationAddressLine1, "123 Work Way");
    assert.equal(capture.created.serviceLocationCity, "Chicago");
    assert.equal(capture.created.scheduledStartAt.getTime(), new Date("2026-01-15T16:00:00.000Z").getTime());
  } finally {
    restore();
  }
});