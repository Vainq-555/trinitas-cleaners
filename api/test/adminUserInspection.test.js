import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { ROLES } from "../src/config.js";
import { adminInspectUser, adminListUsers, adminListContactTargets } from "../src/controllers/users.js";

// Phase 2A.1 regression coverage: the admin CUSTOMER-inspection endpoint must
// stay customer-only.
//
// Before this phase the guard rejected only `role === "admin"`, so an employee
// fell through and was answered with a customer-shaped payload. Employee
// administration has its own endpoints (/admin/employees), so this endpoint has
// no reason to accept a non-customer at all.

const response = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
});

const row = (role, over = {}) => ({
  id: "u1",
  name: "Pat",
  email: "pat@example.com",
  phone: "6125550100",
  address: "1 Main St",
  role,
  status: "offline",
  lastActiveAt: null,
  passwordHash: "SHOULD_NEVER_BE_RETURNED",
  ...over,
});

// Stubs every read adminInspectUser performs, so an unexpected read is visible
// as an explicit "queried" entry rather than a silent no-op.
async function withDb(stubs, fn) {
  const originals = {};
  for (const [model, methods] of Object.entries(stubs)) {
    originals[model] = prisma[model];
    for (const method of Object.keys(methods)) {
      originals[`${model}.${method}`] = prisma[model][method];
      prisma[model][method] = methods[method];
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(originals)) {
      if (key.includes(".")) {
        const [model, method] = key.split(".");
        prisma[model][method] = originals[key];
      } else if (originals[key]) {
        prisma[key] = originals[key];
      }
    }
  }
}

// A complete stub set: every downstream query is recorded in `queried`.
function inspectStubs(user) {
  const queried = [];
  const note = (name) => async (args) => { queried.push(name); return args && name === "user.findUnique" ? user : []; };
  return {
    queried,
    stubs: {
      user: { findUnique: async () => { queried.push("user.findUnique"); return user; } },
      booking: { findMany: note("booking.findMany") },
      receipt: { findMany: note("receipt.findMany") },
      message: { findMany: note("message.findMany") },
      service: { findMany: note("service.findMany") },
      customPrice: { findMany: note("customPrice.findMany") },
    },
  };
}

test("adminInspectUser: a customer is still inspected exactly as before → 200", async () => {
  const { queried, stubs } = inspectStubs(row(ROLES.CUSTOMER));
  const res = response();
  await withDb(stubs, () => adminInspectUser({ params: { id: "u1" } }, res));
  assert.equal(res.statusCode, 200);
  // The customer's own dashboard data is still returned (preserved behavior).
  assert.equal(res.body.user.id, "u1");
  assert.ok(Array.isArray(res.body.bookings));
  assert.ok(Array.isArray(res.body.receipts));
  assert.ok(Array.isArray(res.body.messages));
  assert.ok(Array.isArray(res.body.serviceCatalog));
  assert.equal(queried.includes("booking.findMany"), true);
  assert.equal(queried.includes("receipt.findMany"), true);
});

test("adminInspectUser: the inspected user is never returned with a password hash", async () => {
  const { stubs } = inspectStubs(row(ROLES.CUSTOMER));
  const res = response();
  await withDb(stubs, () => adminInspectUser({ params: { id: "u1" } }, res));
  assert.equal(res.body.user.passwordHash, undefined);
  assert.equal(JSON.stringify(res.body).includes("SHOULD_NEVER_BE_RETURNED"), false, "no secret may appear anywhere in the payload");
});

test("adminInspectUser: an EMPLOYEE is refused — it is not a customer", async () => {
  const { queried, stubs } = inspectStubs(row(ROLES.EMPLOYEE));
  const res = response();
  await withDb(stubs, () => adminInspectUser({ params: { id: "e1" } }, res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /not a customer/i);
  // The real defect: a non-customer must not trigger the customer data sweep.
  assert.deepEqual(queried, ["user.findUnique"], "no bookings/receipts/messages/prices may be read for a non-customer");
  assert.equal(res.body.user, undefined, "no employee data may be returned");
  assert.equal(res.body.bookings, undefined);
  assert.equal(res.body.messages, undefined, "an employee's correspondence is not customer-inspection data");
  assert.equal(res.body.serviceCatalog, undefined);
});

test("adminInspectUser: an ADMIN target is still refused with the same message (preserved)", async () => {
  const { queried, stubs } = inspectStubs(row(ROLES.ADMIN));
  const res = response();
  await withDb(stubs, () => adminInspectUser({ params: { id: "a1" } }, res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /not a customer/i);
  assert.deepEqual(queried, ["user.findUnique"]);
});

test("adminInspectUser: an UNREGISTERED role is refused too (fail-closed, not a deny-list)", async () => {
  for (const role of ["contractor", "staff", ""]) {
    const { queried, stubs } = inspectStubs(row(role));
    const res = response();
    await withDb(stubs, () => adminInspectUser({ params: { id: "x1" } }, res));
    assert.equal(res.statusCode, 400, `role ${JSON.stringify(role)} must be refused`);
    assert.deepEqual(queried, ["user.findUnique"]);
  }
});

test("adminInspectUser: a missing user is still a 404 (preserved)", async () => {
  const res = response();
  await withDb({ user: { findUnique: async () => null } }, () => adminInspectUser({ params: { id: "nope" } }, res));
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /not found/i);
});

test("adminListUsers: the admin user list stays customer-only (employees are not listed here)", async () => {
  let args = null;
  await withDb(
    { user: { findMany: async (a) => { args = a; return []; } } },
    () => adminListUsers({ user: { id: "a1", role: ROLES.ADMIN } }, response()),
  );
  assert.deepEqual(args.where, { role: "customer" });
});

test("adminListContactTargets: admin messaging targets stay customer-only (preserved)", async () => {
  let args = null;
  await withDb(
    { user: { findMany: async (a) => { args = a; return []; } } },
    () => adminListContactTargets({ user: { id: "a1", role: ROLES.ADMIN } }, response()),
  );
  assert.deepEqual(args.where, { role: "customer" });
  // Admins reach employees through /admin/employees, so the employee admin
  // workflow is unaffected by the inspect guard.
  assert.equal(args.where.role !== ROLES.EMPLOYEE, true);
});
