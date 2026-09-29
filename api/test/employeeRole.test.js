import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { ROLES } from "../src/config.js";
import { isValidRole } from "../src/utils/validators.js";
import { register } from "../src/controllers/auth.js";

// Employee role foundation.
//
// "employee" is a THIRD, separate internal role. It is not a tier above or below
// anything, and no role implies another.

const response = () => ({
  cookies: {},
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
  cookie() { return this; },
  clearCookie() { return this; },
});

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
    for (const [model, methods] of Object.entries(stubs)) {
      if (originals[model]) {
        for (const method of Object.keys(methods)) prisma[model][method] = originals[`${model}.${method}`];
      } else {
        delete prisma[model];
      }
    }
  }
}

// ---- ROLE ----

test("role: employee is a registered role with the exact value 'employee'", () => {
  assert.equal(ROLES.EMPLOYEE, "employee");
});

test("role: the existing admin and customer values are unchanged", () => {
  assert.equal(ROLES.ADMIN, "admin");
  assert.equal(ROLES.CUSTOMER, "customer");
});

test("role: there is no hierarchy — exactly three roles, and no composite/inherited value", () => {
  assert.deepEqual(Object.values(ROLES).sort(), ["admin", "customer", "employee"]);
  // A role name must never imply another role (no "superadmin"/"manager").
  for (const value of Object.values(ROLES)) {
    assert.ok(["admin", "customer", "employee"].includes(value), `unexpected role value ${value}`);
  }
});

test("role: employee is recognized as a valid role", () => {
  assert.equal(isValidRole(ROLES.EMPLOYEE), true);
});

test("role: customer remains customer and admin remains admin (both still valid)", () => {
  assert.equal(isValidRole(ROLES.CUSTOMER), true);
  assert.equal(isValidRole(ROLES.ADMIN), true);
});

test("role: an unknown role is still rejected", () => {
  assert.equal(isValidRole("manager"), false);
  assert.equal(isValidRole("superadmin"), false);
  assert.equal(isValidRole(""), false);
  assert.equal(isValidRole(undefined), false);
});

// ---- public registration stays customer-only ----

test("register: a normal public registration creates a customer", async () => {
  let created = null;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => {
          created = data;
          return { id: "u1", ...data };
        },
      },
    },
    () => register({ body: { name: "Alice", email: "alice@example.com", password: "password123" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(created.role, ROLES.CUSTOMER);
});

test("register: a public registration can NEVER create an employee, even if the body asks for it", async () => {
  let created = null;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => {
          created = data;
          return { id: "u2", ...data };
        },
      },
    },
    () =>
      register(
        { body: { name: "Mallory", email: "m@example.com", password: "password123", role: ROLES.EMPLOYEE } },
        res,
      ),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(created.role, ROLES.CUSTOMER, "the role is server-assigned, never taken from the request");
  assert.notEqual(created.role, ROLES.EMPLOYEE);
});

test("register: a public registration can never create an admin, even if the body asks for it", async () => {
  let created = null;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => {
          created = data;
          return { id: "u3", ...data };
        },
      },
    },
    () =>
      register(
        { body: { name: "Root", email: "r@example.com", password: "password123", role: ROLES.ADMIN } },
        res,
      ),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(created.role, ROLES.CUSTOMER);
});

test("register: a new customer is not disabled and keeps the default presence lifecycle", async () => {
  let created = null;
  const res = response();
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => {
          created = data;
          return { id: "u4", ...data };
        },
      },
    },
    () => register({ body: { name: "Bob", email: "b@example.com", password: "password123" } }, res),
  );
  // The account lifecycle field is never set by public registration.
  assert.equal(created.disabledAt, undefined);
});
