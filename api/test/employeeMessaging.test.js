import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import prisma from "../src/utils/prisma.js";
import { ROLES } from "../src/config.js";
import { authenticate } from "../src/middleware/auth.js";
import { COOKIE_NAME } from "../src/config.js";
import { adminListThreads, listConversation, markRead, sendMessage } from "../src/controllers/messages.js";

// PHASE 2B-3 — employee <-> admin messaging.
//
// The Phase 2A.1 employee authorization (employee may contact only an admin)
// already exists in api/src/controllers/messages.js and is already proven by
// test/messages.test.js. It is deliberately NOT rewritten here, and NOT
// re-asserted wholesale.
//
// This file covers what Phase 2B-3 actually adds or depends on:
//
//   * adminListThreads labels the counterpart from the STORED User.role, so an
//     employee conversation stops masquerading as a customer conversation,
//     while the pre-existing `customer` field is preserved for compatibility.
//   * admin -> employee replies are allowed, and admin -> customer still works.
//   * the employee identity is derived from auth, never from the request body.
//   * read state can only ever be changed for messages the caller RECEIVED.
//   * a customer can never reach an employee's thread, and a test-only
//     unregistered role is denied rather than given employee/admin reach.
//   * no passwordHash (Phase 2A.1) and no unrelated user columns are returned.
//   * a disabled employee is rejected by the existing `authenticate` middleware.

const response = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
});

const t = (iso) => new Date(iso);
const NOW = t("2026-09-26T10:00:00Z");

const ADMIN = { id: "adm1", name: "Admin", email: "admin@x.test", role: ROLES.ADMIN, status: "online" };
const EMP1 = { id: "emp1", name: "Erin Employee", email: "e1@x.test", role: ROLES.EMPLOYEE, status: "offline" };
const EMP2 = { id: "emp2", name: "Evan Employee", email: "e2@x.test", role: ROLES.EMPLOYEE, status: "offline" };
const CUS1 = { id: "cus1", name: "Cody Customer", email: "c1@x.test", role: ROLES.CUSTOMER, status: "offline" };
const UNREGISTERED = { id: "x1", role: "contractor" }; // test-only; NOT in ROLES

const msg = (over = {}) => ({
  id: "m1",
  senderId: EMP1.id,
  receiverId: ADMIN.id,
  content: "hello",
  readAt: null,
  createdAt: NOW,
  sender: EMP1,
  receiver: ADMIN,
  ...over,
});

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

const stubMessageCreate = (sink) => async ({ data }) => {
  sink.push(data);
  return { id: "m1", ...data };
};

const threadsFrom = async (rows) => {
  const res = response();
  await withDb({ message: { findMany: async () => rows } }, () =>
    adminListThreads({ user: { id: ADMIN.id } }, res),
  );
  return { res, threads: res.body.threads };
};

// =================== ADMIN THREAD LABELING (the Phase 2B-3 fix) ===================

test("adminListThreads: an employee conversation is labeled employee", async () => {
  const { res, threads } = await threadsFrom([msg()]);
  assert.equal(res.statusCode, 200);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].counterpartType, ROLES.EMPLOYEE);
  assert.equal(threads[0].counterpartType, "employee");
});

test("adminListThreads: a customer conversation is STILL labeled customer", async () => {
  // Regression guard: the employee labeling must not relabel existing threads.
  const row = msg({ senderId: CUS1.id, receiverId: ADMIN.id, sender: CUS1, receiver: ADMIN });
  const { threads } = await threadsFrom([row]);
  assert.equal(threads[0].counterpartType, ROLES.CUSTOMER);
  assert.equal(threads[0].counterpartType, "customer");
});

test("adminListThreads: the label is an admin-sent message's counterpart role too", async () => {
  // The counterpart is derived from whichever side is not the admin, so the
  // label holds regardless of who sent the newest message.
  const row = msg({ senderId: ADMIN.id, receiverId: EMP1.id, sender: ADMIN, receiver: EMP1 });
  const { threads } = await threadsFrom([row]);
  assert.equal(threads[0].counterpartType, ROLES.EMPLOYEE);
});

test("adminListThreads: the label comes from the stored role, not the name or email", async () => {
  // A customer-named/employee-named thread must not be guessed from display data.
  const disguised = {
    ...EMP1,
    name: "Customer Support",
    email: "support@x.test",
  };
  const { threads } = await threadsFrom([msg({ sender: disguised, receiver: ADMIN })]);
  assert.equal(threads[0].counterpartType, ROLES.EMPLOYEE, "display strings must not affect the label");
});

test("adminListThreads: the pre-existing `customer` field is preserved for compatibility", async () => {
  // The admin UI and any existing consumer read `customer`; Phase 2B-3 only ADDS
  // counterpartType and must not remove or rename the old field.
  const { threads } = await threadsFrom([msg()]);
  assert.equal(threads[0].customer.id, EMP1.id);
  assert.equal(threads[0].customer.name, EMP1.name);
});

test("adminListThreads: two employees produce two SEPARATE threads, not one shared thread", async () => {
  // Conversation isolation: sharing an admin counterpart must not merge threads.
  const rows = [
    msg({ id: "m1", senderId: EMP1.id, receiverId: ADMIN.id, sender: EMP1, receiver: ADMIN }),
    msg({ id: "m2", senderId: EMP2.id, receiverId: ADMIN.id, sender: EMP2, receiver: ADMIN }),
  ];
  const { threads } = await threadsFrom(rows);
  assert.equal(threads.length, 2);
  const ids = threads.map((th) => th.customer.id).sort();
  assert.deepEqual(ids, [EMP1.id, EMP2.id]);
  assert.deepEqual(
    threads.map((th) => th.counterpartType),
    [ROLES.EMPLOYEE, ROLES.EMPLOYEE],
  );
});

test("adminListThreads: unread is still derived from readAt, unchanged by the new field", async () => {
  const unreadFromEmployee = await threadsFrom([msg({ id: "m1", readAt: null })]);
  assert.equal(unreadFromEmployee.threads[0].unread, true, "an unread employee message is unread for the admin");

  const readByAdmin = await threadsFrom([
    msg({ id: "m2", senderId: ADMIN.id, receiverId: EMP1.id, sender: ADMIN, receiver: EMP1, readAt: NOW }),
  ]);
  assert.equal(readByAdmin.threads[0].unread, false);
});

test("adminListThreads: the counterpart query projects only the safe user columns", async () => {
  // Proves "no passwordHash / no unrelated user data" STRUCTURALLY. A leaky
  // fixture cannot prove it: a stubbed findMany returns whatever the fixture
  // holds and never applies the projection, so the guarantee lives in `select`.
  const seen = [];
  const res = response();
  await withDb({ message: { findMany: async (a) => { seen.push(a); return []; } } }, () =>
    adminListThreads({ user: { id: ADMIN.id } }, res),
  );
  const { sender, receiver } = seen[0].include;
  assert.deepEqual(sender.select, { id: true, name: true, email: true, role: true, status: true });
  assert.deepEqual(receiver.select, sender.select);
  for (const forbidden of [
    "passwordHash", "address", "phone", "disabledAt",
    "passwordResetToken", "invitationToken", "lastActiveAt",
  ]) {
    assert.equal(forbidden in sender.select, false, `${forbidden} must not be projected`);
    assert.equal(forbidden in receiver.select, false, `${forbidden} must not be projected`);
  }
});

// =================== ADMIN -> EMPLOYEE REPLY ===================

test("sendMessage: an ADMIN may reply to an employee → 201", async () => {
  const sink = [];
  const res = response();
  await withDb(
    { user: { findUnique: async () => EMP1 }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: { id: ADMIN.id, role: ROLES.ADMIN }, body: { receiverId: EMP1.id, content: "On it" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(sink[0].senderId, ADMIN.id);
  assert.equal(sink[0].receiverId, EMP1.id);
});

test("sendMessage: an ADMIN may still message a customer → 201 (preserved)", async () => {
  const sink = [];
  const res = response();
  await withDb(
    { user: { findUnique: async () => CUS1 }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: { id: ADMIN.id, role: ROLES.ADMIN }, body: { receiverId: CUS1.id, content: "hi" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(sink[0].receiverId, CUS1.id);
});

test("sendMessage: the sender is taken from auth, never from the request body", async () => {
  // A body-supplied senderId must not let an employee (or anyone) send AS
  // another user — the identity is req.user.id only.
  const sink = [];
  const res = response();
  await withDb(
    { user: { findUnique: async () => ADMIN }, message: { create: stubMessageCreate(sink) } },
    () =>
      sendMessage(
        { user: { id: EMP1.id, role: ROLES.EMPLOYEE }, body: { receiverId: ADMIN.id, content: "hi", senderId: EMP2.id } },
        res,
      ),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(sink[0].senderId, EMP1.id, "senderId must come from the session, not the body");
  assert.notEqual(sink[0].senderId, EMP2.id);
});

// =================== CUSTOMER REGRESSION ===================

test("sendMessage: a CUSTOMER may not message an employee → 403", async () => {
  const sink = [];
  const res = response();
  await withDb(
    { user: { findUnique: async () => EMP1 }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: { id: CUS1.id, role: ROLES.CUSTOMER }, body: { receiverId: EMP1.id, content: "hi" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(sink.length, 0, "a customer has no employee contact");
});

test("listConversation: a CUSTOMER never receives an employee's messages", async () => {
  // The customer's query is pinned to the session id, so an employee's admin
  // thread is unreachable even though both include the same admin.
  const seen = [];
  const res = response();
  await withDb(
    {
      user: { findFirst: async () => ADMIN },
      message: { findMany: async (a) => { seen.push(a); return []; } },
    },
    () => listConversation({ user: { id: CUS1.id, role: ROLES.CUSTOMER }, params: { withId: EMP1.id } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen[0].where.OR, [
    { senderId: CUS1.id, receiverId: ADMIN.id },
    { senderId: ADMIN.id, receiverId: CUS1.id },
  ]);
  for (const clause of seen[0].where.OR) {
    assert.ok(
      clause.senderId !== EMP1.id && clause.receiverId !== EMP1.id,
      "no clause may reference another user's id",
    );
  }
});

test("listConversation: the returned admin exposes ONLY the safe columns", async () => {
  // "No unrelated user data": asserted on the `select` the controller sends, not
  // on a stub fixture (a stubbed findFirst ignores `select` and would return
  // every column, which is not what the real query does).
  let findFirstArgs = null;
  const res = response();
  await withDb(
    {
      user: { findFirst: async (args) => { findFirstArgs = args; return ADMIN; } },
      message: { findMany: async () => [] },
    },
    () => listConversation({ user: { id: EMP1.id, role: ROLES.EMPLOYEE }, params: { withId: "admin" } }, res),
  );
  assert.ok(findFirstArgs.select, "the admin lookup must use an explicit select");
  assert.deepEqual(Object.keys(findFirstArgs.select).sort(), ["email", "id", "name", "role", "status"]);
  for (const forbidden of [
    "passwordHash", "address", "phone", "disabledAt",
    "passwordResetToken", "invitationToken", "lastActiveAt",
  ]) {
    assert.equal(forbidden in findFirstArgs.select, false, `${forbidden} must not be returned with the admin`);
  }
});

// =================== READ STATE ===================

test("markRead: only messages RECEIVED by the caller are ever in scope", async () => {
  const seen = [];
  const res = response();
  await withDb({ message: { updateMany: async (a) => { seen.push(a); return { count: 0 }; } } }, () =>
    markRead({ user: { id: EMP1.id, role: ROLES.EMPLOYEE }, params: { fromId: ADMIN.id } }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(seen[0].where.receiverId, EMP1.id, "the caller must be the receiver");
  assert.equal(seen[0].where.senderId, ADMIN.id);
  assert.equal(seen[0].where.readAt, null);
});

test("markRead: an employee cannot mark ANOTHER employee's messages read", async () => {
  // The scope pins receiverId to the caller, so a row where the caller is the
  // SENDER (or a row addressed to someone else) can never be matched.
  const seen = [];
  const res = response();
  await withDb(
    {
      message: {
        updateMany: async (a) => {
          seen.push(a);
          // Emulate the real filter: nothing is addressed to emp1 by emp2.
          return { count: 0 };
        },
      },
    },
    () => markRead({ user: { id: EMP1.id, role: ROLES.EMPLOYEE }, params: { fromId: EMP2.id } }, res),
  );
  assert.equal(seen[0].where.receiverId, EMP1.id);
  assert.notEqual(seen[0].where.senderId, EMP1.id, "a caller can never be the sender in scope");
});

test("markRead: a customer cannot mark an employee's messages read", async () => {
  const seen = [];
  const res = response();
  await withDb({ message: { updateMany: async (a) => { seen.push(a); return { count: 0 }; } } }, () =>
    markRead({ user: { id: CUS1.id, role: ROLES.CUSTOMER }, params: { fromId: EMP1.id } }, res),
  );
  // The security boundary is the receiver pin: only messages ADDRESSED TO the
  // caller are ever in scope, so one customer can never mark a message
  // belonging to another user's conversation. (An employee->customer row cannot
  // even exist: that send is 403.)
  assert.equal(seen[0].where.receiverId, CUS1.id, "the scope must be the caller's own inbox");
  assert.equal(seen[0].where.senderId, EMP1.id);
});

// =================== FAIL-CLOSED ===================

test("listConversation: an unregistered role is denied, even aiming at an employee → 403", async () => {
  const calls = [];
  const res = response();
  await withDb(
    {
      user: { findFirst: async () => { calls.push("findFirst"); return ADMIN; } },
      message: { findMany: async () => { calls.push("findMany"); return []; } },
    },
    () => listConversation({ user: { id: UNREGISTERED.id, role: UNREGISTERED.role }, params: { withId: EMP1.id } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.deepEqual(calls, [], "no thread may be read for an unknown role");
});

test("sendMessage: an unregistered role may not message an employee → 403", async () => {
  const sink = [];
  const res = response();
  await withDb(
    { user: { findUnique: async () => EMP1 }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: { id: UNREGISTERED.id, role: UNREGISTERED.role }, body: { receiverId: EMP1.id, content: "hi" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(sink.length, 0);
});

test("listConversation: an employee with a bogus/other-party withId still reads ONLY their own thread", async () => {
  // Malformed / unowned conversation ids must not widen access.
  for (const withId of [EMP2.id, CUS1.id, "not-a-cuid", "../../etc", ""]) {
    const seen = [];
    const res = response();
    await withDb(
      {
        user: { findFirst: async () => ADMIN },
        message: { findMany: async (a) => { seen.push(a); return []; } },
      },
      () => listConversation({ user: { id: EMP1.id, role: ROLES.EMPLOYEE }, params: { withId } }, res),
    );
    assert.equal(res.statusCode, 200, `withId=${withId} must not error out to a different thread`);
    assert.deepEqual(seen[0].where.OR, [
      { senderId: EMP1.id, receiverId: ADMIN.id },
      { senderId: ADMIN.id, receiverId: EMP1.id },
    ], `withId=${withId} must not change the scope`);
  }
});

test("sendMessage: an employee may not message themselves → 403", async () => {
  const sink = [];
  const res = response();
  await withDb(
    { user: { findUnique: async () => EMP1 }, message: { create: stubMessageCreate(sink) } },
    () => sendMessage({ user: { id: EMP1.id, role: ROLES.EMPLOYEE }, body: { receiverId: EMP1.id, content: "note to self" } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(sink.length, 0);
});

test("sendMessage: an empty or whitespace-only message is rejected before any write", async () => {
  for (const content of ["", "   ", "\n\t "]) {
    const sink = [];
    const res = response();
    await withDb(
      { user: { findUnique: async () => ADMIN }, message: { create: stubMessageCreate(sink) } },
      () => sendMessage({ user: { id: EMP1.id, role: ROLES.EMPLOYEE }, body: { receiverId: ADMIN.id, content } }, res),
    );
    assert.equal(res.statusCode, 400, `content=${JSON.stringify(content)} must be rejected`);
    assert.equal(sink.length, 0);
  }
});

// =================== DISABLED EMPLOYEE ===================

test("a disabled employee is denied on every message endpoint by the existing middleware", async () => {
  // No new mechanism: `authenticate` re-reads disabledAt on each request, and
  // all three customer-facing message routes start with it.
  const { signToken } = await import("../src/utils/jwt.js");
  const disabled = { ...EMP1, disabledAt: t("2026-09-26T00:00:00Z") };

  for (const route of [
    "GET /messages/with/:withId",
    "POST /messages",
    "POST /messages/read/:fromId",
  ]) {
    const res = response();
    let reached = false;
    const req = {
      cookies: { [COOKIE_NAME]: signToken({ sub: EMP1.id, role: ROLES.EMPLOYEE }) },
      headers: {},
    };
    await withDb({ user: { findUnique: async () => disabled } }, () =>
      authenticate(req, res, () => { reached = true; }),
    );
    assert.equal(res.statusCode, 401, `${route} must reject a disabled employee`);
    assert.match(res.body.error, /disabled/);
    assert.equal(reached, false, `${route} must not reach the controller`);
  }
});

test("an enabled employee is allowed through the same middleware", async () => {
  const { signToken } = await import("../src/utils/jwt.js");
  const res = response();
  let reached = false;
  const req = {
    cookies: { [COOKIE_NAME]: signToken({ sub: EMP1.id, role: ROLES.EMPLOYEE }) },
    headers: {},
  };
  await withDb({ user: { findUnique: async () => ({ ...EMP1, disabledAt: null }) } }, () =>
    authenticate(req, res, () => { reached = true; }),
  );
  assert.equal(reached, true, "an active employee must not be blocked by the disabled check");
  assert.equal(res.statusCode, null);
});

// =================== NO DUPLICATE INFRASTRUCTURE ===================

// Every registered route whose path mentions "message", with the separate
// customer-only /community/* feature filtered out (it is out of scope here).
const messageRouteRows = (src) =>
  [...src.matchAll(/router\.(get|post|put|patch|delete)\("([^"]*message[^"]*)",?([^)]*)\)/g)]
    .filter(([, , path]) => !path.includes("/community/"))
    .map(([, method, path, guards]) => ({ method, path, guards: guards ?? "" }));

test("no employee-specific messaging routes were added (existing endpoints reused)", () => {
  const src = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  const paths = messageRouteRows(src).map((r) => r.path);

  // Exactly the pre-existing message surface: no /employee/messages variants.
  assert.deepEqual(paths.sort(), [
    "/admin/messages/threads",
    "/admin/messages/with/:withId",
    "/messages",
    "/messages/read/:fromId",
    "/messages/with/:withId",
  ]);
  assert.equal(paths.some((p) => p.startsWith("/employee")), false, "no duplicate employee messaging route");
});

test("every message route is behind authenticate, and the admin thread route behind adminOnly", () => {
  const src = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  const rows = messageRouteRows(src);

  for (const { method, path, guards } of rows) {
    if (path.startsWith("/admin/")) {
      assert.match(guards, /adminOnly/, `${method.toUpperCase()} ${path} must require adminOnly`);
    } else {
      assert.match(guards, /authenticate/, `${method.toUpperCase()} ${path} must require authenticate`);
    }
  }
  assert.equal(rows.length, 5, "all five message routes must be found by this guard");
});
