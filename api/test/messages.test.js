import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { ROLES } from "../src/config.js";
import { sendMessage, listConversation } from "../src/controllers/messages.js";

// Authorization regression coverage for the customer <-> admin communication hub.
//
// Phase 1 proved the handlers never treat "not a customer" as "admin": a role
// that is neither customer nor admin must be denied, never silently given admin
// reach. That fail-closed property is still proven here, using a TEST-ONLY role
// that is deliberately NOT registered in ROLES ("contractor").
//
// Since Phase 2A, "employee" IS a real role, so it gets its own explicit cases
// below: it may contact/read only an admin, and never a customer or another
// employee.

const response = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
});

const CUSTOMER = { id: "u1", role: ROLES.CUSTOMER };
const OTHER_CUSTOMER = { id: "u2", role: ROLES.CUSTOMER };
const ADMIN = { id: "a1", role: ROLES.ADMIN };
const EMPLOYEE = { id: "e1", role: ROLES.EMPLOYEE };
const OTHER_EMPLOYEE = { id: "e2", role: ROLES.EMPLOYEE };
const UNREGISTERED = { id: "x1", role: "contractor" }; // test-only; not a production role

// Installs stubs for the prisma singleton and always restores the originals.
async function withDb(stubs, fn) {
  const originals = {};
  for (const [model, methods] of Object.entries(stubs)) {
    originals[model] = {};
    for (const method of Object.keys(methods)) {
      originals[model][method] = prisma[model][method];
      prisma[model][method] = stubs[model][method];
    }
  }
  try {
    return await fn();
  } finally {
    for (const [model, methods] of Object.entries(originals)) {
      for (const [method, original] of Object.entries(methods)) {
        prisma[model][method] = original;
      }
    }
  }
}

const createdMessages = () => [];
const stubMessageCreate = (sink) => async ({ data }) => {
  sink.push(data);
  return { id: "m1", ...data };
};

// ---- sendMessage: preserved behavior for the two real roles ----

test("sendMessage: a customer may message the admin → 201", async () => {
  const sink = createdMessages();
  const res = response();
  await withDb(
    { user: { findUnique: async () => ADMIN }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: CUSTOMER, body: { receiverId: "a1", content: "hello" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(sink.length, 1);
  assert.equal(sink[0].senderId, "u1");
  assert.equal(sink[0].receiverId, "a1");
});

test("sendMessage: a customer may not message another customer → 403", async () => {
  const sink = createdMessages();
  const res = response();
  await withDb(
    { user: { findUnique: async () => OTHER_CUSTOMER }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: CUSTOMER, body: { receiverId: "u2", content: "hi" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /only contact the admin/);
  assert.equal(sink.length, 0, "no message may be stored");
});

test("sendMessage: an admin may message a customer → 201 (preserved admin behavior)", async () => {
  const sink = createdMessages();
  const res = response();
  await withDb(
    { user: { findUnique: async () => OTHER_CUSTOMER }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: ADMIN, body: { receiverId: "u2", content: "reply" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(sink.length, 1);
});

// ---- sendMessage: fail-closed for an UNREGISTERED role ----

test("sendMessage: an unregistered, non-admin, non-customer role may not message a customer → 403", async () => {
  const sink = createdMessages();
  const res = response();
  await withDb(
    { user: { findUnique: async () => OTHER_CUSTOMER }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: UNREGISTERED, body: { receiverId: "u2", content: "hi" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(sink.length, 0, "an unregistered role must not inherit admin reach");
});

test("sendMessage: an unregistered role may still reach the admin only", async () => {
  // Not a bypass grant: a non-customer is confined to the admin target rather
  // than being able to choose any receiver. This documents the fail-closed
  // consequence for a future role.
  const sink = createdMessages();
  const res = response();
  await withDb(
    { user: { findUnique: async () => ADMIN }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: UNREGISTERED, body: { receiverId: "a1", content: "hi" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(sink.length, 1);
});

// ---- listConversation: preserved behavior for the two real roles ----

test("listConversation: a customer always sees only their admin conversation (withId ignored)", async () => {
  const res = response();
  await withDb(
    {
      user: { findFirst: async () => ADMIN },
      message: { findMany: async () => [] },
    },
    () => listConversation({ user: CUSTOMER, params: { withId: "u2" } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.admin.id, "a1");
});

test("listConversation: an admin may read a conversation with an arbitrary counterpart → 200 (preserved)", async () => {
  const seen = [];
  const res = response();
  await withDb(
    {
      message: {
        findMany: async (args) => { seen.push(args); return []; },
      },
    },
    () => listConversation({ user: ADMIN, params: { withId: "u2" } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(seen.length, 1, "the admin branch must still query the requested counterpart");
  assert.deepEqual(seen[0].where.OR, [
    { senderId: "a1", receiverId: "u2" },
    { senderId: "u2", receiverId: "a1" },
  ]);
});

// ---- listConversation: fail-closed for an UNREGISTERED role ----

test("listConversation: an unregistered role is denied and reads no thread → 403", async () => {
  const seen = [];
  const res = response();
  await withDb(
    {
      user: { findFirst: async () => ADMIN },
      message: { findMany: async (args) => { seen.push(args); return []; } },
    },
    () => listConversation({ user: UNREGISTERED, params: { withId: "u2" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /insufficient role/);
  assert.equal(seen.length, 0, "no conversation query may run for an unregistered role");
  assert.equal(res.body.messages, undefined, "no thread may be disclosed");
});

// =================== employee: admin contact ONLY ===================

test("sendMessage: an EMPLOYEE may message the admin → 201", async () => {
  const sink = createdMessages();
  const res = response();
  await withDb(
    { user: { findUnique: async () => ADMIN }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: EMPLOYEE, body: { receiverId: "a1", content: "question" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(sink.length, 1);
  assert.equal(sink[0].senderId, "e1");
  assert.equal(sink[0].receiverId, "a1");
});

test("sendMessage: an EMPLOYEE may NOT message a customer → 403", async () => {
  const sink = createdMessages();
  const res = response();
  await withDb(
    { user: { findUnique: async () => OTHER_CUSTOMER }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: EMPLOYEE, body: { receiverId: "u2", content: "hi" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(sink.length, 0, "an employee has no customer contact");
});

test("sendMessage: an EMPLOYEE may NOT message another employee → 403", async () => {
  const sink = createdMessages();
  const res = response();
  await withDb(
    { user: { findUnique: async () => OTHER_EMPLOYEE }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: EMPLOYEE, body: { receiverId: "e2", content: "hi" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(sink.length, 0, "employees cannot message each other");
});

test("listConversation: an EMPLOYEE reads ONLY their own admin conversation", async () => {
  const seen = [];
  const res = response();
  await withDb(
    {
      user: { findFirst: async () => ADMIN },
      message: { findMany: async (args) => { seen.push(args); return []; } },
    },
    () => listConversation({ user: EMPLOYEE, params: { withId: "a1" } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].where.OR, [
    { senderId: "e1", receiverId: "a1" },
    { senderId: "a1", receiverId: "e1" },
  ]);
  assert.equal(res.body.admin.id, "a1");
});

test("listConversation: an EMPLOYEE cannot read another employee's conversation (withId ignored)", async () => {
  const seen = [];
  const res = response();
  await withDb(
    {
      user: { findFirst: async () => ADMIN },
      message: { findMany: async (args) => { seen.push(args); return []; } },
    },
    // Asking for a conversation with a different employee must still be scoped
    // to the requester's own admin thread.
    () => listConversation({ user: EMPLOYEE, params: { withId: "e2" } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen[0].where.OR, [
    { senderId: "e1", receiverId: "a1" },
    { senderId: "a1", receiverId: "e1" },
  ]);
});

test("listConversation: an EMPLOYEE cannot read a customer's conversation", async () => {
  const seen = [];
  const res = response();
  await withDb(
    {
      user: { findFirst: async () => ADMIN },
      message: { findMany: async (args) => { seen.push(args); return []; } },
    },
    () => listConversation({ user: EMPLOYEE, params: { withId: "u1" } }, res),
  );
  assert.equal(res.statusCode, 200);
  const serialized = JSON.stringify(seen[0].where);
  assert.equal(serialized.includes("u1"), false, "no customer id may enter the query");
  assert.equal(seen[0].where.OR.length, 2);
});

test("listConversation: the returned admin is a safe projection, never a full User row", async () => {
  let findFirstArgs = null;
  const res = response();
  await withDb(
    {
      user: {
        findFirst: async (args) => { findFirstArgs = args; return ADMIN; },
      },
      message: { findMany: async () => [] },
    },
    () => listConversation({ user: EMPLOYEE, params: { withId: "a1" } }, res),
  );
  // An explicit select is required: a bare findFirst would return the admin's
  // passwordHash to the client through res.body.admin.
  assert.ok(findFirstArgs.select, "the admin lookup must use an explicit select");
  const selected = Object.keys(findFirstArgs.select).sort();
  for (const forbidden of ["passwordHash", "address", "phone", "disabledAt"]) {
    assert.equal(forbidden in findFirstArgs.select, false, `${forbidden} must not be returned with the admin`);
  }
  assert.deepEqual(selected, ["email", "id", "name", "role", "status"]);
});

test("listConversation: a CUSTOMER still never receives the admin passwordHash", async () => {
  let findFirstArgs = null;
  const res = response();
  await withDb(
    {
      user: { findFirst: async (args) => { findFirstArgs = args; return ADMIN; } },
      message: { findMany: async () => [] },
    },
    () => listConversation({ user: CUSTOMER, params: { withId: "a1" } }, res),
  );
  assert.equal("passwordHash" in (findFirstArgs.select || {}), false);
  assert.equal(res.body.admin.passwordHash, undefined);
});
