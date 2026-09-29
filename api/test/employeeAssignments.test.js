import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { ROLES } from "../src/config.js";
import { adminAssignBooking, listMyAssignments } from "../src/controllers/assignments.js";
import { requireAdmin, requireCustomer, requireEmployee } from "../src/middleware/auth.js";

const t = (s) => new Date(s);

const response = () => ({
  cookies: {},
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
  clearCookie() { return this; },
});

async function withDb(stubs, fn) {
  const originals = {};
  for (const [model, methods] of Object.entries(stubs)) {
    const label = model === "$root" ? "$root" : model;
    const target = model === "$root" ? prisma : prisma[model];
    originals[label] = target[label];
    for (const method of Object.keys(methods)) {
      originals[`${label}.${method}`] = target[method];
      target[method] = methods[method];
    }
  }
  try {
    return await fn();
  } finally {
    for (const [model, methods] of Object.entries(stubs)) {
      const label = model === "$root" ? "$root" : model;
      const target = label === "$root" ? prisma : prisma[model];
      if (originals[label] !== undefined) {
        for (const method of Object.keys(methods)) target[method] = originals[`${label}.${method}`];
      } else {
        delete prisma[model];
      }
    }
  }
}

const ADMIN = { id: "adm1", role: ROLES.ADMIN };
const EMPLOYEE = { id: "emp1", role: ROLES.EMPLOYEE };
const CUSTOMER = { id: "cus1", role: ROLES.CUSTOMER };

// A booking that is accepted and carries BOTH a customer-requested schedule and
// a customer id — the two things an assignment must never touch.
const acceptedBooking = (overrides = {}) => ({
  id: "bk1",
  status: "accepted",
  archivedAt: null,
  customerId: "cus1",
  scheduledStartAt: t("2026-09-30T15:00:00Z"),
  ...overrides,
});

const employeeRow = (overrides = {}) => ({
  id: "emp1",
  role: ROLES.EMPLOYEE,
  disabledAt: null,
  ...overrides,
});

const assignmentRow = (data = {}, booking = acceptedBooking()) => ({
  id: "as1",
  bookingId: "bk1",
  employeeId: "emp1",
  assignedById: "adm1",
  assignedAt: t("2026-09-27T00:00:00Z"),
  scheduledStartAt: null,
  visibleToEmployee: true,
  createdAt: t("2026-09-27T00:00:00Z"),
  updatedAt: t("2026-09-27T00:00:00Z"),
  ...data,
  booking: {
    id: booking.id,
    status: booking.status,
    scheduledStartAt: booking.scheduledStartAt,
    customerId: booking.customerId,
    customer: { name: "Alice" },
    service: { name: "Deep Clean" },
  },
});

// =================== admin assigns an accepted booking ===================

test("assign: an admin can assign an accepted booking to an employee", async () => {
  let upsertArgs = null;
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: {
        upsert: async (args) => { upsertArgs = args; return assignmentRow(args.create, acceptedBooking()); },
      },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(upsertArgs.where.bookingId, "bk1", "the assignment is keyed on the booking");
  assert.equal(upsertArgs.create.bookingId, "bk1");
});

test("assign: the assignment stores employeeId", async () => {
  let upsertArgs = null;
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.create); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(upsertArgs.create.employeeId, "emp1");
  assert.equal(res.body.assignment.employeeId, "emp1");
});

test("assign: the assignment records the admin identity in assignedById", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.create); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, response()),
  );
  assert.equal(upsertArgs.create.assignedById, "adm1", "the assigning admin is recorded");
  assert.notEqual(upsertArgs.create.assignedById, "emp1");
});

test("assign: the employee-specific scheduledStartAt is stored on the ASSIGNMENT", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.create); } },
    },
    () =>
      adminAssignBooking(
        { user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1", scheduledStartAt: "2026-10-01T14:00:00Z" } },
        response(),
      ),
  );
  assert.ok(upsertArgs.create.scheduledStartAt instanceof Date);
  assert.equal(upsertArgs.create.scheduledStartAt.toISOString(), "2026-10-01T14:00:00.000Z");
  // It is a DIFFERENT instant from the customer's own requested time.
  assert.notEqual(upsertArgs.create.scheduledStartAt.toISOString(), "2026-09-30T15:00:00.000Z");
});

test("assign: Booking.customerId is NEVER repurposed — the booking row is not written at all", async () => {
  const bookingCalls = [];
  let bookingUpdated = false;
  const res = response();
  await withDb(
    {
      booking: {
        findUnique: async (args) => { bookingCalls.push(args); return acceptedBooking(); },
        update: async () => { bookingUpdated = true; },
        create: async () => { bookingUpdated = true; },
      },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async (a) => assignmentRow(a.create) },
    },
    () =>
      adminAssignBooking(
        { user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1", scheduledStartAt: "2026-10-01T14:00:00Z" } },
        res,
      ),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(bookingUpdated, false, "no Booking write may ever happen during an assignment");
  // The only booking interaction is a read.
  assert.equal(bookingCalls.length, 1);
  // The response still reports the untouched customer relationship.
  assert.equal(res.body.assignment.booking.customerId, "cus1");
  assert.equal(res.body.assignment.booking.customerScheduledStartAt.toISOString(), "2026-09-30T15:00:00.000Z");
  assert.equal(res.body.assignment.scheduledStartAt.toISOString(), "2026-10-01T14:00:00.000Z");
});

test("assign: an existing customer booking is not rewritten (no data migration of any kind)", async () => {
  // Proves the write surface is limited to BookingAssignment.
  const writes = [];
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async (a) => { writes.push("bookingAssignment"); return assignmentRow(a.create); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, response()),
  );
  assert.deepEqual(writes, ["bookingAssignment"]);
});

// =================== who may assign ===================

test("assign: an EMPLOYEE cannot assign a booking to anyone, including themselves", async () => {
  let upserted = false;
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async () => { upserted = true; return assignmentRow(); } },
    },
    () =>
      adminAssignBooking(
        { user: EMPLOYEE, params: { id: "bk1" }, body: { employeeId: EMPLOYEE.id } },
        res,
      ),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(upserted, false, "self-assignment must be impossible");
});

test("assign: a CUSTOMER cannot assign an employee", async () => {
  let upserted = false;
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async () => { upserted = true; return assignmentRow(); } },
    },
    () => adminAssignBooking({ user: CUSTOMER, params: { id: "bk1" }, body: { employeeId: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(upserted, false);
});

test("assign: the handler is additionally unreachable through the role guards", () => {
  // The route is adminOnly; prove the guard itself refuses both other roles.
  for (const [user, ok] of [[ADMIN, true], [EMPLOYEE, false], [CUSTOMER, false]]) {
    const res = response();
    let passed = false;
    requireAdmin({ user }, res, () => { passed = true; });
    assert.equal(passed, ok, `admin guard for role ${user.role}`);
  }
});

// =================== assignment validity ===================

test("assign: a pending booking cannot be assigned", async () => {
  let upserted = false;
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking({ status: "pending" }) },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async () => { upserted = true; return assignmentRow(); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /accepted/i);
  assert.equal(upserted, false);
});

test("assign: a DECLINED booking cannot be assigned", async () => {
  let upserted = false;
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking({ status: "declined" }) },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async () => { upserted = true; return assignmentRow(); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.equal(upserted, false);
});

test("assign: an archived booking cannot be assigned", async () => {
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking({ archivedAt: t("2026-09-20T00:00:00Z") }) },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async () => assignmentRow() },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /archived/i);
});

test("assign: a missing booking is a 404", async () => {
  const res = response();
  await withDb(
    { booking: { findUnique: async () => null } },
    () => adminAssignBooking({ user: ADMIN, params: { id: "nope" }, body: { employeeId: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 404);
});

test("assign: a DISABLED employee cannot receive a new assignment", async () => {
  let upserted = false;
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow({ disabledAt: t("2026-09-01T00:00:00Z") }) },
      bookingAssignment: { upsert: async () => { upserted = true; return assignmentRow(); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /disabled/i);
  assert.equal(upserted, false, "no work may be handed to a disabled employee");
});

test("assign: the target must have role employee (a customer target is refused)", async () => {
  for (const role of [ROLES.CUSTOMER, ROLES.ADMIN]) {
    let upserted = false;
    const res = response();
    await withDb(
      {
        booking: { findUnique: async () => acceptedBooking() },
        user: { findUnique: async () => ({ id: "x", role, disabledAt: null }) },
        bookingAssignment: { upsert: async () => { upserted = true; return assignmentRow(); } },
      },
      () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "x" } }, res),
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /not an employee/);
    assert.equal(upserted, false, `a ${role} may never be assigned work`);
  }
});

test("assign: a missing employee is a 404 and input is validated", async () => {
  const missing = response();
  await withDb(
    { booking: { findUnique: async () => acceptedBooking() }, user: { findUnique: async () => null } },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "ghost" } }, missing),
  );
  assert.equal(missing.statusCode, 404);

  for (const body of [{}, { employeeId: "emp1", scheduledStartAt: "tomorrow-ish" }, { employeeId: "emp1", visibleToEmployee: "yes" }]) {
    const res = response();
    await withDb(
      { booking: { findUnique: async () => acceptedBooking() }, user: { findUnique: async () => employeeRow() } },
      () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body }, res),
    );
    assert.equal(res.statusCode, 400, `body ${JSON.stringify(body)} must be rejected`);
  }
});

test("assign: re-assignment replaces the record instead of double-assigning a booking", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async ({ where }) => employeeRow({ id: where.id }) },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.update); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp2" } }, response()),
  );
  // Upsert keyed on the unique bookingId => at most one assigned employee.
  assert.equal(upsertArgs.where.bookingId, "bk1");
  assert.equal(upsertArgs.update.employeeId, "emp2");
  assert.equal(upsertArgs.update.assignedById, "adm1");
  assert.ok(upsertArgs.update.assignedAt instanceof Date);
});

// =================== employee visibility is explicit & predictable ===================

test("visibility: a NEW assignment defaults to visible when the flag is omitted", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.create); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1" } }, response()),
  );
  assert.equal(upsertArgs.create.visibleToEmployee, true, "the documented default for a new assignment is preserved");
});

test("visibility: a NEW assignment can be explicitly created hidden", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.create); } },
    },
    () =>
      adminAssignBooking(
        { user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1", visibleToEmployee: false } },
        response(),
      ),
  );
  assert.equal(upsertArgs.create.visibleToEmployee, false, "an explicit false must be honored on create");
});

test("visibility: reassigning a HIDDEN assignment does NOT silently publish it to the new employee", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async ({ where }) => employeeRow({ id: where.id }) },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.update); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp2" } }, response()),
  );
  assert.equal(upsertArgs.update.employeeId, "emp2");
  // The core fix: with the flag omitted, the update must not touch the stored
  // visibility, so the admin's earlier "hide" decision survives reassignment.
  assert.equal(
    "visibleToEmployee" in upsertArgs.update,
    false,
    "an omitted flag must leave the stored visibility untouched on reassignment",
  );
});

test("visibility: an admin can explicitly publish a reassigned assignment", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async ({ where }) => employeeRow({ id: where.id }) },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.update); } },
    },
    () =>
      adminAssignBooking(
        { user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp2", visibleToEmployee: true } },
        response(),
      ),
  );
  assert.equal(upsertArgs.update.visibleToEmployee, true, "an explicit true must be applied on reassignment");
});

test("visibility: an admin can explicitly re-hide a reassigned assignment", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async ({ where }) => employeeRow({ id: where.id }) },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.update); } },
    },
    () =>
      adminAssignBooking(
        { user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp2", visibleToEmployee: false } },
        response(),
      ),
  );
  assert.equal(upsertArgs.update.visibleToEmployee, false);
});

test("visibility: reassignment does not inherit the previous employee's start time", async () => {
  let upsertArgs = null;
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async ({ where }) => employeeRow({ id: where.id }) },
      bookingAssignment: { upsert: async (a) => { upsertArgs = a; return assignmentRow(a.update); } },
    },
    () => adminAssignBooking({ user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp2" } }, response()),
  );
  assert.equal(upsertArgs.update.scheduledStartAt, null, "a stale start time is reset rather than handed to a new employee");
});

test("visibility: a hidden assignment is filtered out server-side and can never be read", async () => {
  let args = null;
  const res = response();
  await withDb(
    { bookingAssignment: { findMany: async (a) => { args = a; return []; } } },
    () => listMyAssignments({ user: EMPLOYEE }, res),
  );
  // The read is filtered in the database query, not in JavaScript, so a hidden
  // row is never even loaded.
  assert.equal(args.where.visibleToEmployee, true);
  assert.equal(args.where.employeeId, "emp1");
});

test("visibility: a visible assignment is returned to its assigned employee", async () => {
  const visible = {
    id: "as1",
    assignedAt: t("2026-09-01T00:00:00Z"),
    scheduledStartAt: t("2026-09-02T09:00:00Z"),
    booking: {
      id: "bk1",
      date: t("2026-09-02T00:00:00Z"),
      serviceLocationAddressLine1: "1 Main St",
      serviceLocationAddressLine2: null,
      serviceLocationCity: "St Paul",
      serviceLocationState: "MN",
      serviceLocationPostalCode: "55101",
      serviceLocationCountry: "USA",
      serviceLocationInstructions: "gate code 1234",
      service: { id: "sv1", name: "Standard Clean", description: "deep clean" },
      customer: { name: "Alice", phone: "6125550100" },
    },
  };
  const res = response();
  await withDb(
    { bookingAssignment: { findMany: async () => [visible] } },
    () => listMyAssignments({ user: EMPLOYEE }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.assignments.length, 1);
  assert.equal(res.body.assignments[0].booking.customer.name, "Alice");
  assert.equal(res.body.assignments[0].booking.customer.phone, "6125550100");
  assert.equal(res.body.assignments[0].scheduledStartAt.toISOString(), "2026-09-02T09:00:00.000Z");
});

test("visibility: a non-boolean visibility flag is still rejected", async () => {
  let upserted = false;
  const res = response();
  await withDb(
    {
      booking: { findUnique: async () => acceptedBooking() },
      user: { findUnique: async () => employeeRow() },
      bookingAssignment: { upsert: async () => { upserted = true; return assignmentRow(); } },
    },
    () =>
      adminAssignBooking(
        { user: ADMIN, params: { id: "bk1" }, body: { employeeId: "emp1", visibleToEmployee: "false" } },
        res,
      ),
  );
  assert.equal(res.statusCode, 400);
  assert.equal(upserted, false, "visibility must be an explicit boolean, never a truthy string");
});

// =================== employee reads are server-scoped ===================

test("employee read: the query is scoped to req.user.id, never to a request parameter", async () => {
  let args = null;
  const res = response();
  await withDb(
    { bookingAssignment: { findMany: async (a) => { args = a; return []; } } },
    () => listMyAssignments({ user: EMPLOYEE, query: { employeeId: "emp2" }, body: { employeeId: "emp2" }, params: { employeeId: "emp2" } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(args.where.employeeId, "emp1", "the scope comes from the session, not the request");
  assert.deepEqual(res.body, { assignments: [] });
});

test("employee read: an employee CANNOT read another employee's assignments", async () => {
  let args = null;
  const res = response();
  await withDb(
    {
      bookingAssignment: {
        findMany: async (a) => {
          args = a;
          // A DB scoped to employeeId=emp1 can only ever return emp1's rows.
          return a.where.employeeId === "emp1"
            ? [{ id: "as1", assignedAt: t("2026-09-27T00:00:00Z"), scheduledStartAt: null, booking: { id: "bk1", date: t("2026-09-30T00:00:00Z"), serviceLocationAddressLine1: null, serviceLocationAddressLine2: null, serviceLocationCity: "St Paul", serviceLocationState: "MN", serviceLocationPostalCode: "55101", serviceLocationCountry: "US", serviceLocationInstructions: "gate code 1234", service: { id: "sv1", name: "Deep Clean", description: "top to bottom" }, customer: { name: "Alice", phone: "612-555-0000" } } }]
            : [];
        },
      },
    },
    () => listMyAssignments({ user: { id: "emp2", role: ROLES.EMPLOYEE } }, res),
  );
  assert.equal(args.where.employeeId, "emp2", "the scope follows the authenticated employee");
  for (const a of res.body.assignments) {
    assert.equal(a.customer.name, "Alice", "emp2 would see only their own work — the fake honors the scope");
  }
});

test("employee read: pending and declined bookings cannot leak into the employee view", async () => {
  let args = null;
  await withDb(
    { bookingAssignment: { findMany: async (a) => { args = a; return []; } } },
    () => listMyAssignments({ user: EMPLOYEE }, response()),
  );
  assert.equal(args.where.booking.status, "accepted", "only accepted work is exposed");
  assert.equal(args.where.booking.archivedAt, null);
});

test("employee read: a hidden assignment is not returned", async () => {
  let args = null;
  await withDb(
    { bookingAssignment: { findMany: async (a) => { args = a; return []; } } },
    () => listMyAssignments({ user: EMPLOYEE }, response()),
  );
  assert.equal(args.where.visibleToEmployee, true);
});

test("employee read: assignments are ordered as an employee work schedule", async () => {
  let args = null;
  await withDb(
    { bookingAssignment: { findMany: async (a) => { args = a; return []; } } },
    () => listMyAssignments({ user: EMPLOYEE }, response()),
  );
  // The employee's own admin-set start drives the order, earliest first.
  assert.deepEqual(args.orderBy[0], { scheduledStartAt: { sort: "asc", nulls: "last" } });
  // An unscheduled assignment has no schedule position and must sink below every
  // scheduled one, instead of sorting as if it were "now".
  assert.equal(args.orderBy[0].scheduledStartAt.nulls, "last");
  // Fallback + deterministic tie-breakers, so equal times never reshuffle.
  assert.deepEqual(args.orderBy[1], { booking: { date: "asc" } });
  assert.deepEqual(args.orderBy[2], { assignedAt: "desc" });
  assert.deepEqual(args.orderBy[3], { id: "asc" });
});

test("employee read: ordering never reorders the assignments in JavaScript", async () => {
  // The list is returned in the order the database produced it, so the work
  // schedule an employee sees is exactly the server-decided order.
  const bookingFor = (id, date) => ({
    id,
    date: t(date),
    serviceLocationAddressLine1: "1 Main St",
    serviceLocationAddressLine2: null,
    serviceLocationCity: "St Paul",
    serviceLocationState: "MN",
    serviceLocationPostalCode: "55101",
    serviceLocationCountry: "USA",
    serviceLocationInstructions: null,
    service: { id: "sv1", name: "Deep Clean", description: "top to bottom" },
    customer: { name: "Alice", phone: "6125550100" },
  });
  const rows = [
    { id: "as1", assignedAt: t("2026-09-01T00:00:00Z"), scheduledStartAt: t("2026-09-05T14:00:00Z"), booking: bookingFor("bk2", "2026-09-05T00:00:00Z") },
    { id: "as2", assignedAt: t("2026-09-02T00:00:00Z"), scheduledStartAt: t("2026-09-04T09:00:00Z"), booking: bookingFor("bk1", "2026-09-04T00:00:00Z") },
    { id: "as3", assignedAt: t("2026-09-03T00:00:00Z"), scheduledStartAt: null, booking: bookingFor("bk3", "2026-09-03T00:00:00Z") },
  ];
  const res = response();
  await withDb(
    { bookingAssignment: { findMany: async () => rows } },
    () => listMyAssignments({ user: EMPLOYEE }, res),
  );
  assert.deepEqual(res.body.assignments.map((a) => a.id), ["as1", "as2", "as3"], "server order is preserved verbatim");
  // And the employee-specific start time is what is carried to the client.
  assert.equal(res.body.assignments[0].scheduledStartAt.toISOString(), "2026-09-05T14:00:00.000Z");
  assert.equal(res.body.assignments[2].scheduledStartAt, null, "an unscheduled assignment reports no start time rather than borrowing one");
});

test("employee read: assignments are never fetched and then filtered in JavaScript", async () => {
  // A single server-side query; the projection happens in the query itself.
  let callCount = 0;
  await withDb(
    { bookingAssignment: { findMany: async () => { callCount += 1; return []; } } },
    () => listMyAssignments({ user: EMPLOYEE }, response()),
  );
  assert.equal(callCount, 1, "exactly one scoped query, no fetch-all-then-filter");
});

test("employee read: the customer projection is narrow — name and phone only", async () => {
  let args = null;
  await withDb(
    { bookingAssignment: { findMany: async (a) => { args = a; return []; } } },
    () => listMyAssignments({ user: EMPLOYEE }, response()),
  );
  const customerSelect = args.select.booking.select.customer.select;
  assert.deepEqual(
    Object.keys(customerSelect).sort(),
    ["name", "phone"],
    "the employee projection exposes customer name and phone and nothing else",
  );
  for (const forbidden of ["email", "address", "passwordHash", "id", "role", "stripeCustomerId", "email"]) {
    assert.equal(forbidden in customerSelect, false, `customer.${forbidden} must not be selected`);
  }
});

test("employee read: no payment, tax, receipt or pricing field is ever selected", async () => {
  let args = null;
  await withDb(
    { bookingAssignment: { findMany: async (a) => { args = a; return []; } } },
    () => listMyAssignments({ user: EMPLOYEE }, response()),
  );
  const bookingSelect = args.select.booking.select;
  const selected = JSON.stringify(bookingSelect);
  for (const forbidden of [
    "price",
    "payment",
    "receipt",
    "tax",
    "amount",
    "stripeCustomerId",
    "promotionId",
    "scheduledStartAt", // the CUSTOMER's requested time is intentionally absent
    "customerId",
    "subscriptions",
    "review",
  ]) {
    assert.equal(selected.includes(forbidden), false, `employee booking projection must not include ${forbidden}`);
  }
  assert.equal(bookingSelect.payment, undefined);
  assert.equal(bookingSelect.receipts, undefined);
  assert.equal(bookingSelect.customerId, undefined);
  assert.equal(bookingSelect.scheduledStartAt, undefined);
  // Location + instructions ARE the employee's operational needs.
  assert.equal(bookingSelect.serviceLocationInstructions !== undefined, true);
  assert.equal(bookingSelect.serviceLocationCity !== undefined, true);
  assert.deepEqual(
    Object.keys(bookingSelect).sort(),
    [
      "customer",
      "date",
      "id",
      "service",
      "serviceLocationAddressLine1",
      "serviceLocationAddressLine2",
      "serviceLocationCity",
      "serviceLocationCountry",
      "serviceLocationInstructions",
      "serviceLocationPostalCode",
      "serviceLocationState",
    ],
    "the employee booking projection is exactly the operational field list",
  );
});

test("employee read: the response exposes the employee-assigned time, not the customer's", async () => {
  const res = response();
  await withDb(
    {
      bookingAssignment: {
        findMany: async () => [
          {
            id: "as1",
            assignedAt: t("2026-09-27T00:00:00Z"),
            scheduledStartAt: t("2026-10-01T14:00:00Z"),
            booking: {
              id: "bk1",
              date: t("2026-09-30T15:00:00Z"),
              serviceLocationAddressLine1: "12 Main St",
              serviceLocationAddressLine2: "Apt 2",
              serviceLocationCity: "St Paul",
              serviceLocationState: "MN",
              serviceLocationPostalCode: "55101",
              serviceLocationCountry: "US",
              serviceLocationInstructions: "gate code 1234",
              service: { id: "sv1", name: "Deep Clean", description: "top to bottom" },
              customer: { name: "Alice", phone: "612-555-0000" },
            },
          },
        ],
      },
    },
    () => listMyAssignments({ user: EMPLOYEE }, res),
  );
  const a = res.body.assignments[0];
  assert.equal(a.scheduledStartAt.toISOString(), "2026-10-01T14:00:00.000Z");
  assert.equal(a.booking.scheduledStartAt, undefined);
  assert.equal(a.booking.customerId, undefined);
  assert.equal(a.booking.customer.name, "Alice");
  assert.equal(a.booking.customer.phone, "612-555-0000");
  assert.equal(a.booking.location.instructions, "gate code 1234");
  assert.equal(a.booking.service.name, "Deep Clean");
  assert.equal(a.booking.requestedDate.toISOString(), "2026-09-30T15:00:00.000Z");
});

test("employee read: the response body carries no secret, financial or unrelated-customer field", async () => {
  const res = response();
  await withDb(
    {
      bookingAssignment: {
        findMany: async () => [
          {
            id: "as1",
            assignedAt: t("2026-09-27T00:00:00Z"),
            scheduledStartAt: null,
            booking: {
              id: "bk1",
              date: t("2026-09-30T15:00:00Z"),
              serviceLocationAddressLine1: "12 Main St",
              serviceLocationAddressLine2: null,
              serviceLocationCity: "St Paul",
              serviceLocationState: "MN",
              serviceLocationPostalCode: "55101",
              serviceLocationCountry: "US",
              serviceLocationInstructions: null,
              service: { id: "sv1", name: "Deep Clean", description: "d" },
              customer: { name: "Alice", phone: "612-555-0000" },
            },
          },
        ],
      },
    },
    () => listMyAssignments({ user: EMPLOYEE }, res),
  );
  const serialized = JSON.stringify(res.body);
  for (const forbidden of ["password", "hash", "stripe", "tax", "amount", "total", "receipt", "price", "customerId", "email", "assignedById", "promotion"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, `employee assignment response must not include ${forbidden}`);
  }
});

test("employee read: a customer and an admin are refused by the employee guard", () => {
  for (const [user, ok] of [[EMPLOYEE, true], [CUSTOMER, false], [ADMIN, false]]) {
    const res = response();
    let passed = false;
    requireEmployee({ user }, res, () => { passed = true; });
    assert.equal(passed, ok, `employee guard for role ${user.role}`);
  }
  // And customer-only routes still reject an employee.
  const res = response();
  let passed = false;
  requireCustomer({ user: EMPLOYEE }, res, () => { passed = true; });
  assert.equal(passed, false);
});
