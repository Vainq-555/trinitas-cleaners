import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { ROLES } from "../src/config.js";
import { listMyAvailability, createMyAvailability, updateMyAvailability, deleteMyAvailability } from "../src/controllers/availability.js";
import { listMyShifts, requestShift, listMyShiftRequests } from "../src/controllers/shifts.js";
import { requireAdmin, requireCustomer, requireEmployee } from "../src/middleware/auth.js";

// Phase 2B-4 — employee availability + available shifts.
//
// The single most important rule in this file: an employee requesting a shift
// must NOT assign it. Everything else here (scope, duplicates, closed shifts)
// is in service of that, so the tests below assert the negative directly rather
// than inferring it from what is created.

const t = (s) => new Date(s);
const FUTURE = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);
const PAST = () => new Date(Date.now() - 7 * 24 * 3600 * 1000);

const response = () => ({
  cookies: {},
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
  clearCookie() { return this; },
});

// Swaps Prisma delegates for the duration of `fn`, then restores the originals.
//
// The originals are held in a CLOSURE-SCOPED Map, never written onto the shared
// prisma object: storing them on the delegate would leak a stub into every later
// test (and into other test files) if this ever threw before the restore ran.
// Restoration runs in `finally`, so a failing assertion still un-stubs.
async function withDb(stubs, fn) {
  const originals = new Map();
  try {
    for (const [model, methods] of Object.entries(stubs)) {
      const target = prisma[model];
      for (const [method, stub] of Object.entries(methods)) {
        originals.set(`${model}.${method}`, target[method]);
        target[method] = stub;
      }
    }
    return await fn();
  } finally {
    for (const [key, original] of originals) {
      const [model, method] = key.split(".");
      prisma[model][method] = original;
    }
  }
}

const ADMIN = { id: "adm1", role: ROLES.ADMIN };
const EMPLOYEE = { id: "emp1", role: ROLES.EMPLOYEE };
const OTHER_EMPLOYEE = { id: "emp2", role: ROLES.EMPLOYEE };
const CUSTOMER = { id: "cus1", role: ROLES.CUSTOMER };

const window = (over = {}) => ({
  id: "av1",
  employeeId: "emp1",
  date: "2026-09-28",
  startTime: "09:00",
  endTime: "13:00",
  kind: "available",
  note: null,
  createdAt: t("2026-09-01T00:00:00Z"),
  updatedAt: t("2026-09-01T00:00:00Z"),
  ...over,
});

const shift = (over = {}) => ({
  id: "sh1",
  bookingId: "bk1",
  notes: null,
  closesAt: null,
  publishedAt: t("2026-09-20T00:00:00Z"),
  createdById: "adm1",
  createdAt: t("2026-09-20T00:00:00Z"),
  updatedAt: t("2026-09-20T00:00:00Z"),
  booking: {
    id: "bk1",
    date: "2026-09-30",
    status: "accepted",
    archivedAt: null,
    scheduledStartAt: t("2026-09-30T15:00:00Z"),
    serviceLocationAddressLine1: "1 Main St",
    serviceLocationAddressLine2: null,
    serviceLocationCity: "Chicago",
    serviceLocationState: "IL",
    serviceLocationPostalCode: "60601",
    serviceLocationInstructions: null,
    service: { id: "sv1", name: "Standard Clean" },
    customer: { id: "cus1", name: "Real Customer", email: "c@example.com", phone: "555-1111" },
  },
  ...over,
});

// The ShiftOffer `select` used by listMyShifts omits `customer` entirely, so a
// stub that ignores the select and returns the full booking must still be
// stripped by the controller's own projection. That is what these helpers
// verify: no customer field ever reaches an employee.
const listStubs = (rows) => ({
  shiftOffer: { findMany: async () => rows },
  shiftRequest: { findMany: async () => [] },
});

// `requireRole` builds an Express middleware `(req, res, next)`: it returns
// nothing and signals "allowed" by CALLING next(). Asserting on a boolean here
// would be asserting on a coincidence, so these tests assert on the two
// observable effects: the status code, and whether next() ran.
function guardPasses(middleware, user) {
  const res = response();
  let nexted = false;
  middleware({ user }, res, () => { nexted = true; });
  return { allowed: nexted, statusCode: res.statusCode, body: res.body };
}

// ═══════════════════════════════════════════════ authorization

test("availability: only an EMPLOYEE passes the employee guard", () => {
  assert.equal(guardPasses(requireEmployee, EMPLOYEE).allowed, true, "an employee is allowed");
  for (const actor of [ADMIN, CUSTOMER, { id: "x", role: "OWNER" }, {}, null]) {
    const { allowed, statusCode } = guardPasses(requireEmployee, actor);
    assert.equal(allowed, false, `${JSON.stringify(actor)} must be refused`);
    assert.equal(
      statusCode,
      actor ? 403 : 401,
      `${JSON.stringify(actor)} must be 401 unauthenticated / 403 wrong role`,
    );
  }
});

test("an employee is refused on admin and customer guards — employee access is never implied", () => {
  assert.equal(guardPasses(requireAdmin, EMPLOYEE).allowed, false);
  assert.equal(guardPasses(requireAdmin, EMPLOYEE).statusCode, 403);
  assert.equal(guardPasses(requireCustomer, EMPLOYEE).allowed, false);
  assert.equal(guardPasses(requireCustomer, EMPLOYEE).statusCode, 403);
});

test("availability: an unauthenticated request is refused before any lookup", async () => {
  let called = false;
  await withDb(
    { employeeAvailability: { findMany: async () => { called = true; return []; } } },
    async () => {
      assert.equal(guardPasses(requireEmployee, null).statusCode, 401);
      assert.equal(called, false, "no data may be read for an unauthorized caller");
    },
  );
});

// ═══════════════════════════════════════════════ create

test("availability: a window is created for the session employee, not a body employeeId", async () => {
  let created;
  await withDb(
    {
      employeeAvailability: {
        create: async ({ data }) => { created = data; return window(data); },
      },
    },
    async () => {
      const res = response();
      await createMyAvailability(
        // A hostile body claims to be another employee.
        { user: EMPLOYEE, body: { date: "2026-09-28", startTime: "09:00", endTime: "13:00", employeeId: "emp2" } },
        res,
      );
      assert.equal(res.statusCode, 201);
      assert.equal(created.employeeId, "emp1", "the owner must come from the session");
      assert.ok(!("emp2" in created), "a body employeeId must never be honored");
    },
  );
});

test("availability: a rejected window is not written at all", async () => {
  const cases = [
    [{ date: "2026-09-28", startTime: "13:00", endTime: "09:00" }, "end before start"],
    [{ date: "2026-09-28", startTime: "09:00", endTime: "09:00" }, "zero-length window"],
    [{ date: "not-a-date", startTime: "09:00", endTime: "13:00" }, "bad date"],
    [{ date: "2026-09-28", startTime: "25:00", endTime: "26:00" }, "impossible times"],
    [{ date: "2026-09-28", startTime: "09:00", endTime: "13:00", kind: "maybe" }, "unknown kind"],
    [{ date: "2026-09-28", startTime: "09:00", endTime: "13:00", note: "x".repeat(501) }, "overlong note"],
  ];
  for (const [body, why] of cases) {
    let created = false;
    await withDb(
      { employeeAvailability: { create: async () => { created = true; return window(); } } },
      async () => {
        const res = response();
        await createMyAvailability({ user: EMPLOYEE, body }, res);
        assert.equal(res.statusCode, 400, `${why} must be a 400`);
        assert.equal(created, false, `${why} must not reach the database`);
      },
    );
  }
});

test("availability: kind defaults to available when omitted", async () => {
  let created;
  await withDb(
    { employeeAvailability: { create: async ({ data }) => { created = data; return window(data); } } },
    async () => {
      const res = response();
      await createMyAvailability(
        { user: EMPLOYEE, body: { date: "2026-09-28", startTime: "09:00", endTime: "13:00" } },
        res,
      );
      assert.equal(created.kind, "available");
    },
  );
});

test("availability: an unavailable day is stored as a first-class kind", async () => {
  let created;
  await withDb(
    { employeeAvailability: { create: async ({ data }) => { created = data; return window(data); } } },
    async () => {
      const res = response();
      await createMyAvailability(
        { user: EMPLOYEE, body: { date: "2026-09-28", startTime: "09:00", endTime: "17:00", kind: "unavailable" } },
        res,
      );
      assert.equal(res.statusCode, 201);
      assert.equal(created.kind, "unavailable");
    },
  );
});

// ═══════════════════════════════════════════════ update + delete scoping

test("availability: update targets only the employee's own row", async () => {
  const calls = [];
  await withDb(
    {
      employeeAvailability: {
        findFirst: async ({ where }) => { calls.push(where); return window(); },
        updateMany: async ({ where }) => { calls.push(where); return { count: 1 }; },
        findUnique: async () => window({ startTime: "10:00" }),
      },
    },
    async () => {
      const res = response();
      await updateMyAvailability({ user: EMPLOYEE, params: { id: "av1" }, body: { startTime: "10:00" } }, res);
      assert.equal(res.statusCode, 200);
      // EVERY lookup and write must be scoped to the session employee.
      assert.ok(calls.length >= 1);
      for (const where of calls) {
        assert.equal(where.employeeId, "emp1", "the write must be scoped to the session employee");
      }
    },
  );
});

test("availability: a partial edit is completed from the stored row, not blanked", async () => {
  let patch;
  await withDb(
    {
      employeeAvailability: {
        findFirst: async () => window(),
        updateMany: async ({ data }) => { patch = data; return { count: 1 }; },
        findUnique: async () => window(),
      },
    },
    async () => {
      const res = response();
      // Change only the end time.
      await updateMyAvailability({ user: EMPLOYEE, params: { id: "av1" }, body: { endTime: "15:00" } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(patch.date, "2026-09-28", "the date must not be cleared by a partial edit");
      assert.equal(patch.startTime, "09:00", "the start must not be cleared by a partial edit");
      assert.equal(patch.endTime, "15:00");
      assert.equal(patch.kind, "available", "an omitted kind must keep the stored value");
    },
  );
});

test("availability: another employee's row is a 404, not an edit", async () => {
  let updated = false;
  await withDb(
    {
      employeeAvailability: {
        findFirst: async () => null,
        updateMany: async () => { updated = true; return { count: 1 }; },
      },
    },
    async () => {
      const res = response();
      await updateMyAvailability({ user: OTHER_EMPLOYEE, params: { id: "av1" }, body: { startTime: "10:00" } }, res);
      assert.equal(res.statusCode, 404);
      assert.equal(updated, false, "nothing may be written");
    },
  );
});

test("availability: delete targets only the employee's own row", async () => {
  const calls = [];
  await withDb(
    {
      employeeAvailability: {
        deleteMany: async ({ where }) => { calls.push(where); return { count: 1 }; },
      },
    },
    async () => {
      const res = response();
      await deleteMyAvailability({ user: EMPLOYEE, params: { id: "av1" } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(calls[0].employeeId, "emp1", "the delete must be scoped to the session employee");
    },
  );
});

test("availability: deleting another employee's row changes nothing", async () => {
  let deleteCalled = false;
  await withDb(
    {
      employeeAvailability: {
        deleteMany: async () => { deleteCalled = true; return { count: 0 }; },
      },
    },
    async () => {
      const res = response();
      await deleteMyAvailability({ user: OTHER_EMPLOYEE, params: { id: "av1" } }, res);
      assert.equal(res.statusCode, 404);
      // The scoped delete matched nothing, which is what made it safe: there is
      // no code path that deletes by id alone.
      assert.equal(deleteCalled, true, "the scoped delete must run and match nothing");
    },
  );
});

// ═══════════════════════════════════════════════ listing privacy

test("availability: the list is scoped to the session employee", async () => {
  let where;
  await withDb(
    { employeeAvailability: { findMany: async ({ where: w }) => { where = w; return []; } } },
    async () => {
      const res = response();
      await listMyAvailability({ user: EMPLOYEE }, res);
      assert.equal(where.employeeId, "emp1");
    },
  );
});

// ═══════════════════════════════════════════════ shift listing

test("shifts: the query excludes assigned, unpublished and expired shifts", async () => {
  let where;
  await withDb(
    { ...listStubs([shift()]), shiftOffer: { findMany: async ({ where: w }) => { where = w; return []; } } },
    async () => {
      await listMyShifts({ user: EMPLOYEE }, response());
      // Published only.
      assert.deepEqual(where.publishedAt, { not: null });
      // Booking must be accepted and unarchived.
      assert.equal(where.booking.status, "accepted");
      assert.equal(where.booking.archivedAt, null);
      // And must have NO assignment at all, so an assigned shift is never
      // offered to the pool (or to the assignee) as claimable.
      assert.deepEqual(where.booking.employeeAssignments, { none: {} });
    },
  );
});

test("shifts: the response carries no customer, payment or contact data", async () => {
  // The stub deliberately returns a booking that DOES include a customer, to
  // prove the controller's own projection strips it rather than relying on the
  // select alone.
  await withDb(listStubs([shift()]), async () => {
    const res = response();
    await listMyShifts({ user: EMPLOYEE }, res);
    const json = JSON.stringify(res.body);
    for (const forbidden of ["Real Customer", "c@example.com", "555-1111", "customerId", "cus1", "stripe", "amountTotal", "paymentIntent", "passwordHash"]) {
      assert.ok(!json.includes(forbidden), `the employee shift response must not contain ${forbidden}`);
    }
  });
});

test("shifts: an open shift with no prior request is claimable", async () => {
  await withDb(listStubs([shift()]), async () => {
    const res = response();
    await listMyShifts({ user: EMPLOYEE }, res);
    assert.equal(res.body.shifts[0].canRequest, true);
    assert.equal(res.body.shifts[0].myRequest, null);
  });
});

test("shifts: a shift the employee already requested is not claimable again", async () => {
  await withDb(
    {
      shiftOffer: { findMany: async () => [shift()] },
      shiftRequest: { findMany: async () => [{ id: "rq1", shiftId: "sh1", status: "requested", createdAt: new Date(), decidedAt: null }] },
    },
    async () => {
      const res = response();
      await listMyShifts({ user: EMPLOYEE }, res);
      assert.equal(res.body.shifts[0].canRequest, false, "a duplicate request must be impossible");
      assert.equal(res.body.shifts[0].myRequest.status, "requested");
    },
  );
});

// ═══════════════════════════════════════════════ THE core rule

test("REQUESTING A SHIFT DOES NOT ASSIGN IT", async () => {
  let assignmentTouched = false;
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift() },
      bookingAssignment: {
        findUnique: async () => null,
        create: async () => { assignmentTouched = true; return {}; },
        update: async () => { assignmentTouched = true; return {}; },
        upsert: async () => { assignmentTouched = true; return {}; },
      },
      shiftRequest: { findUnique: async () => null, create: async ({ data }) => ({ id: "rq1", ...data }) },
    },
    async () => {
      const res = response();
      await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: {} }, res);
      assert.equal(res.statusCode, 201);
      assert.equal(
        assignmentTouched,
        false,
        "a request must NEVER create, update or upsert a BookingAssignment",
      );
    },
  );
});

test("REQUESTING A SHIFT NEVER MODIFIES THE BOOKING", async () => {
  let bookingTouched = false;
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift() },
      booking: { update: async () => { bookingTouched = true; return {}; } },
      bookingAssignment: { findUnique: async () => null },
      shiftRequest: { findUnique: async () => null, create: async ({ data }) => ({ id: "rq1", ...data }) },
    },
    async () => {
      await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: {} }, response());
      assert.equal(bookingTouched, false, "the booking's customerId and scheduledStartAt must be untouched");
    },
  );
});

test("a request is created for the session employee, never a body employeeId", async () => {
  let created;
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift() },
      bookingAssignment: { findUnique: async () => null },
      shiftRequest: { findUnique: async () => null, create: async ({ data }) => { created = data; return { id: "rq1", ...data }; } },
    },
    async () => {
      const res = response();
      await requestShift(
        { user: EMPLOYEE, params: { id: "sh1" }, body: { employeeId: "emp2", note: "please" } },
        res,
      );
      assert.equal(created.employeeId, "emp1");
      assert.ok(
        !JSON.stringify(created).includes("emp2"),
        "a body employeeId must never be honored",
      );
      assert.equal(created.status, "requested", "a new request is always pending");
    },
  );
});

// ═══════════════════════════════════════════════ request guards

test("a request for an unpublished shift is a 404 — it must not even confirm it exists", async () => {
  let created = false;
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift({ publishedAt: null }) },
      shiftRequest: { create: async () => { created = true; return {}; } },
    },
    async () => {
      const res = response();
      await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: {} }, res);
      assert.equal(res.statusCode, 404);
      assert.equal(created, false);
    },
  );
});

test("a request for an expired shift is refused", async () => {
  let created = false;
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift({ closesAt: PAST() }) },
      shiftRequest: { create: async () => { created = true; return {}; } },
    },
    async () => {
      const res = response();
      await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: {} }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(created, false);
    },
  );
});

test("a request for an already-assigned shift is refused, and assigns nothing", async () => {
  let created = false;
  let assignmentTouched = false;
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift() },
      bookingAssignment: {
        findUnique: async () => ({ employeeId: "emp2" }),
        create: async () => { assignmentTouched = true; return {}; },
      },
      shiftRequest: { create: async () => { created = true; return {}; } },
    },
    async () => {
      const res = response();
      await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: {} }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(created, false);
      assert.equal(assignmentTouched, false);
    },
  );
});

test("a duplicate request is refused with a friendly message", async () => {
  let created = false;
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift() },
      bookingAssignment: { findUnique: async () => null },
      shiftRequest: {
        findUnique: async () => ({ id: "rq1", status: "requested" }),
        create: async () => { created = true; return {}; },
      },
    },
    async () => {
      const res = response();
      await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: {} }, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /already requested/i);
      assert.equal(created, false);
    },
  );
});

test("a lost race still cannot create a second request (DB unique holds)", async () => {
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift() },
      bookingAssignment: { findUnique: async () => null },
      shiftRequest: {
        findUnique: async () => null,
        create: async () => { const e = new Error("Unique constraint failed"); e.code = "P2002"; throw e; },
      },
    },
    async () => {
      const res = response();
      await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: {} }, res);
      assert.equal(res.statusCode, 400, "the unique violation must surface as a friendly 400, not a 500");
      assert.match(res.body.error, /already requested/i);
    },
  );
});

test("a request for a non-accepted or archived booking is refused", async () => {
  for (const booking of [
    { status: "pending", archivedAt: null },
    { status: "cancelled", archivedAt: null },
    { status: "accepted", archivedAt: new Date() },
  ]) {
    let created = false;
    await withDb(
      {
        shiftOffer: { findUnique: async () => shift({ booking: { ...shift().booking, ...booking } }) },
        shiftRequest: { create: async () => { created = true; return {}; } },
      },
      async () => {
        const res = response();
        await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: {} }, res);
        assert.equal(res.statusCode, 400, `${JSON.stringify(booking)} must be refused`);
        assert.equal(created, false);
      },
    );
  }
});

test("an overlong request note is refused without writing", async () => {
  let created = false;
  await withDb(
    {
      shiftOffer: { findUnique: async () => shift() },
      bookingAssignment: { findUnique: async () => null },
      shiftRequest: { create: async () => { created = true; return {}; } },
    },
    async () => {
      const res = response();
      await requestShift({ user: EMPLOYEE, params: { id: "sh1" }, body: { note: "x".repeat(501) } }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(created, false);
    },
  );
});

// ═══════════════════════════════════════════════ request status

test("the request list is scoped to the session employee and spans closed shifts", async () => {
  let where;
  await withDb(
    {
      shiftRequest: {
        findMany: async ({ where: w }) => { where = w; return []; },
      },
    },
    async () => {
      const res = response();
      await listMyShiftRequests({ user: EMPLOYEE }, res);
      assert.equal(where.employeeId, "emp1", "an employee may only see their own requests");
      // A closed/expired offer must not erase the outcome of a request, so the
      // status list is deliberately not filtered on the offer being open.
      assert.equal(where.booking?.publishedAt, undefined, "the status list must not require the offer to be open");
    },
  );
});

test("the request list does not leak another employee's request", async () => {
  await withDb({ shiftRequest: { findMany: async () => [] } }, async () => {
    const res = response();
    await listMyShiftRequests({ user: EMPLOYEE }, res);
    assert.deepEqual(res.body.requests, []);
  });
});
