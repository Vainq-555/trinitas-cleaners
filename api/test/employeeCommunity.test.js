import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requireAdmin, requireCustomer, requireEmployee, authenticate } from "../src/middleware/auth.js";
import { COMMUNITY_EMPLOYEE_AUDIENCE, ROLES } from "../src/config.js";
import { adminListCommunityMessages, listCommunityMessages } from "../src/controllers/community.js";
import {
  adminBlockEmployee,
  adminDeleteEmployeeCommunityMessage,
  adminEmployeeCommunityActionLimiter,
  adminListEmployeeCommunityMessages,
  adminListEmployeeCommunityUsers,
  adminUnblockEmployee,
  createEmployeeCommunityMessage,
  employeeCommunityPostLimiter,
  listMyEmployeeCommunityMessages,
} from "../src/controllers/employeeCommunity.js";
import { COMMUNITY_MESSAGE_MAX_LENGTH } from "../src/utils/validators.js";

// `json` does a real JSON round-trip, because Express does: a Date in a response
// body becomes an ISO string on the wire, and a test that skips that step would
// assert on a shape the client never receives.
const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
});

const t = (s) => new Date(s);

const EMP1 = { id: "emp1", name: "Erin Employee", role: ROLES.EMPLOYEE, communityBlockedAt: null };
const EMP2 = { id: "emp2", name: "Sam Second", role: ROLES.EMPLOYEE, communityBlockedAt: null };
const CUS1 = { id: "cus1", name: "Alice Customer", role: ROLES.CUSTOMER, communityBlockedAt: null };
const ADMIN = { id: "adm1", name: "Admin", role: ROLES.ADMIN, communityBlockedAt: null };
const STRANGER = { id: "zz1", name: "Contractor", role: "contractor", communityBlockedAt: null };

// Rows carry BOTH audiences so every isolation test can prove the pin works by
// reading the same fixture from both sides.
const employeePost = (overrides = {}) => ({
  id: "cm-e1",
  customerId: "emp1",
  content: "Team note",
  createdAt: t("2026-09-01T00:00:00Z"),
  audience: COMMUNITY_EMPLOYEE_AUDIENCE,
  deletedAt: null,
  deletedById: null,
  customer: { id: "emp1", name: "Erin Employee" },
  ...overrides,
});

const customerPost = (overrides = {}) => ({
  id: "cm-c1",
  customerId: "cus1",
  content: "Customer hello",
  createdAt: t("2026-09-01T00:00:00Z"),
  audience: "customer",
  deletedAt: null,
  deletedById: null,
  customer: { id: "cus1", name: "Alice Customer" },
  ...overrides,
});

// In-memory fake prisma for the injected-db pattern used by community.test.js.
// Deliberately exposes NO `.message` accessor, so any code that reaches for the
// existing Message model throws here — proving the employee community does not
// reuse customer/admin messaging.
const makeDb = ({ messages = [], users = [] } = {}) => {
  const msgRows = messages.map((m) => ({ ...m }));
  const userRows = users.map((u) => ({ ...u }));
  let seq = msgRows.length;
  const captured = {};

  function leafMatch(row, k, v) {
    if (v instanceof Date) return row[k] instanceof Date ? row[k].getTime() === v.getTime() : row[k] === v;
    if (v !== null && typeof v === "object" && v.lt !== undefined) return row[k] < v.lt;
    return row[k] === v;
  }
  function condMatch(row, cond) {
    return Object.entries(cond).every(([k, v]) => leafMatch(row, k, v));
  }
  function rowMatch(row, where) {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === "OR") return v.some((sub) => condMatch(row, sub));
      return leafMatch(row, k, v);
    });
  }
  function sortRows(rows, orderBy) {
    const cmp = (a, b) => (typeof a === "string" ? (a < b ? -1 : a > b ? 1 : 0) : a - b);
    return [...rows].sort((a, b) => {
      for (const ob of orderBy || []) {
        const key = Object.keys(ob)[0];
        const c = cmp(a[key], b[key]);
        if (c !== 0) return ob[key] === "desc" ? -c : c;
      }
      return 0;
    });
  }

  return {
    captured,
    communityMessage: {
      findMany: async (args = {}) => {
        captured.findMany = args;
        let out = msgRows.filter((r) => rowMatch(r, args.where));
        out = sortRows(out, args.orderBy);
        if (args.take !== undefined) out = out.slice(0, args.take);
        return out;
      },
      findFirst: async (args = {}) => {
        captured.findFirst = args;
        return msgRows.find((r) => rowMatch(r, args.where)) ?? null;
      },
      create: async ({ data }) => {
        captured.create = data;
        const owner = userRows.find((u) => u.id === data.customerId);
        const m = {
          id: `cm-${++seq}`,
          createdAt: t("2026-09-30T00:00:00Z"),
          deletedAt: null,
          deletedById: null,
          customer: { id: data.customerId, name: owner?.name ?? null },
          ...data,
        };
        msgRows.push(m);
        return m;
      },
      update: async ({ where, data }) => {
        captured.update = { where, data };
        const i = msgRows.findIndex((m) => m.id === where.id);
        msgRows[i] = { ...msgRows[i], ...data };
        return msgRows[i];
      },
    },
    user: {
      findUnique: async ({ where } = {}) => userRows.find((u) => u.id === where.id) ?? null,
      findMany: async ({ where = {}, orderBy } = {}) =>
        sortRows(userRows.filter((u) => rowMatch(u, where)), orderBy),
      update: async ({ where, data } = {}) => {
        const i = userRows.findIndex((u) => u.id === where.id);
        userRows[i] = { ...userRows[i], ...data };
        return userRows[i];
      },
    },
  };
}

const mixedDb = () =>
  makeDb({ messages: [employeePost(), customerPost()], users: [EMP1, EMP2, CUS1, ADMIN] });

// =================== ISOLATION: the headline guarantee ===================

test("ISOLATION: the employee feed returns employee posts and zero customer posts", async () => {
  const db = mixedDb();
  const res = response();
  await listMyEmployeeCommunityMessages({ user: EMP1, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].id, "cm-e1");
});

test("ISOLATION: the customer feed returns customer posts and zero employee posts", async () => {
  const db = mixedDb();
  const res = response();
  await listCommunityMessages({ user: CUS1, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].id, "cm-c1");
});

test("ISOLATION: the admin employee feed shows employee posts only", async () => {
  const db = mixedDb();
  const res = response();
  await adminListEmployeeCommunityMessages({ user: ADMIN, query: {} }, res, db);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].id, "cm-e1");
});

test("ISOLATION: the admin customer feed shows customer posts only", async () => {
  const db = mixedDb();
  const res = response();
  await adminListCommunityMessages({ user: ADMIN, query: {} }, res, db);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].id, "cm-c1");
});

// =================== audience query manipulation ===================

test("MUTATION: ?audience=employee on the CUSTOMER feed cannot widen it", async () => {
  const db = mixedDb();
  const res = response();
  // A client asking the customer endpoint for the employee audience.
  await listCommunityMessages({ user: CUS1, query: { audience: "employee" } }, res, db);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].id, "cm-c1");
  assert.equal(JSON.stringify(res.body).includes("cm-e1"), false);
});

test("MUTATION: ?audience=customer on the EMPLOYEE feed cannot widen or narrow past the pin", async () => {
  const db = mixedDb();
  const res = response();
  await listMyEmployeeCommunityMessages({ user: EMP1, query: { audience: "customer" } }, res, db);
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].id, "cm-e1");
  assert.equal(JSON.stringify(res.body).includes("cm-c1"), false);
});

test("MUTATION: every feed query pins the audience to a literal in the where clause", async () => {
  const cases = [
    [listMyEmployeeCommunityMessages, EMP1, COMMUNITY_EMPLOYEE_AUDIENCE],
    [listCommunityMessages, CUS1, "customer"],
    [adminListEmployeeCommunityMessages, ADMIN, COMMUNITY_EMPLOYEE_AUDIENCE],
    [adminListCommunityMessages, ADMIN, "customer"],
  ];
  for (const [fn, user, expected] of cases) {
    const db = mixedDb();
    const res = response();
    await fn({ user, query: { audience: "tampered" } }, res, db);
    assert.equal(db.captured.findMany.where.audience, expected, `${fn.name} must pin its audience`);
  }
});

test("MUTATION: no handler reads an audience from the request", async () => {
  const src = readFileSync(new URL("../src/controllers/employeeCommunity.js", import.meta.url), "utf8");
  for (const forbidden of ["req.query.audience", "query.audience", "req.body.audience", "body.audience", "params.audience"]) {
    assert.equal(src.includes(forbidden), false, `employee community must never read ${forbidden}`);
  }
});

// =================== cross-role access ===================

test("GUARDS: requireEmployee admits an employee and refuses customer, admin and an unknown role", () => {
  const run = (user) => {
    const res = response();
    let passed = false;
    requireEmployee({ user }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal(run(EMP1).passed, true);
  for (const user of [CUS1, ADMIN, STRANGER]) {
    const { passed, res } = run(user);
    assert.equal(passed, false, `${user.role} must not reach an employee route`);
    assert.equal(res.statusCode, 403);
  }
});

test("GUARDS: requireCustomer still refuses an employee (no role hierarchy)", () => {
  const res = response();
  let passed = false;
  requireCustomer({ user: EMP1 }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("GUARDS: an unauthenticated request to the guard is 401, not 403", () => {
  const res = response();
  requireEmployee({}, res, () => assert.fail("anonymous must not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("MUTATION: a customer posting to the employee community is refused in-handler", async () => {
  const db = mixedDb();
  const res = response();
  await createEmployeeCommunityMessage({ user: CUS1, body: { content: "let me in" } }, res, db);
  assert.equal(res.statusCode, 403);
  assert.equal(db.captured.create, undefined, "no row may be written");
});

test("MUTATION: an ADMIN posting to the employee community is refused — admins never author", async () => {
  const db = mixedDb();
  const res = response();
  await createEmployeeCommunityMessage({ user: ADMIN, body: { content: "admin post" } }, res, db);
  assert.equal(res.statusCode, 403);
  assert.equal(db.captured.create, undefined, "an admin must never become an author");
});

test("MUTATION: an anonymous request with no req.user is refused, not crashed on", async () => {
  const db = mixedDb();
  const res = response();
  await createEmployeeCommunityMessage({ body: { content: "anon" } }, res, db);
  assert.equal(res.statusCode, 403);
});

test("MUTATION: every admin moderation handler re-checks the admin role itself", async () => {
  const cases = [
    adminListEmployeeCommunityMessages,
    adminDeleteEmployeeCommunityMessage,
    adminListEmployeeCommunityUsers,
    adminBlockEmployee,
    adminUnblockEmployee,
  ];
  for (const fn of cases) {
    const db = mixedDb();
    const res = response();
    await fn({ user: EMP1, params: { messageId: "cm-e1", id: "emp1" }, query: {} }, res, db);
    assert.equal(res.statusCode, 403, `${fn.name} must refuse a non-admin`);
    assert.equal(db.captured.findFirst, undefined);
    assert.equal(db.captured.update, undefined);
  }
});

// =================== disabledAt ===================

test("DISABLED: authenticate refuses a disabled employee with 401 before the handler runs", async () => {
  const { signToken } = await import("../src/utils/jwt.js");
  const { COOKIE_NAME } = await import("../src/config.js");
  const prisma = (await import("../src/utils/prisma.js")).default;
  const original = prisma.user.findUnique;
  prisma.user.findUnique = async () => ({ ...EMP1, disabledAt: t("2026-09-20T00:00:00Z") });
  try {
    const req = { cookies: { [COOKIE_NAME]: signToken({ sub: EMP1.id, role: ROLES.EMPLOYEE }) }, headers: {} };
    const res = response();
    let reached = false;
    await authenticate(req, res, () => { reached = true; });
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /disabled/);
    assert.equal(reached, false, "a disabled employee must never reach the community handler");
  } finally {
    prisma.user.findUnique = original;
  }
});

test("DISABLED: authenticate admits an enabled employee through to the guard", async () => {
  const { signToken } = await import("../src/utils/jwt.js");
  const { COOKIE_NAME } = await import("../src/config.js");
  const prisma = (await import("../src/utils/prisma.js")).default;
  const original = prisma.user.findUnique;
  prisma.user.findUnique = async () => ({ ...EMP1, disabledAt: null });
  try {
    const req = { cookies: { [COOKIE_NAME]: signToken({ sub: EMP1.id, role: ROLES.EMPLOYEE }) }, headers: {} };
    const res = response();
    let reached = false;
    await authenticate(req, res, () => { reached = true; });
    assert.equal(reached, true);
    assert.equal(res.statusCode, 200);
  } finally {
    prisma.user.findUnique = original;
  }
});

test("DISABLED: a blocked (not disabled) employee still authenticates — the two are separate", async () => {
  const { signToken } = await import("../src/utils/jwt.js");
  const { COOKIE_NAME } = await import("../src/config.js");
  const prisma = (await import("../src/utils/prisma.js")).default;
  const original = prisma.user.findUnique;
  prisma.user.findUnique = async () => ({ ...EMP1, disabledAt: null, communityBlockedAt: t("2026-09-20T00:00:00Z") });
  try {
    const req = { cookies: { [COOKIE_NAME]: signToken({ sub: EMP1.id, role: ROLES.EMPLOYEE }) }, headers: {} };
    const res = response();
    let reached = false;
    await authenticate(req, res, () => { reached = true; });
    assert.equal(reached, true, "a posting block must not log the employee out");
  } finally {
    prisma.user.findUnique = original;
  }
});

// =================== author identity + spoofing ===================

test("SPOOFING: authorId / customerId / userId in the body are all ignored", async () => {
  for (const field of ["authorId", "customerId", "userId", "employeeId"]) {
    employeeCommunityPostLimiter._reset();
    const db = mixedDb();
    const res = response();
    await createEmployeeCommunityMessage(
      { user: EMP1, body: { content: "hello", [field]: CUS1.id } },
      res,
      db,
    );
    assert.equal(res.statusCode, 201, field);
    assert.equal(db.captured.create.customerId, EMP1.id, `${field} must never choose the author`);
    assert.equal(db.captured.create.audience, COMMUNITY_EMPLOYEE_AUDIENCE);
  }
});

test("SPOOFING: an employee cannot post into the customer community", async () => {
  const db = mixedDb();
  const res = response();
  await createEmployeeCommunityMessage(
    { user: EMP1, body: { content: "hello", audience: "customer" } },
    res,
    db,
  );
  assert.equal(db.captured.create.audience, COMMUNITY_EMPLOYEE_AUDIENCE);
});

test("SPOOFING: the created post echoes the session employee as the author", async () => {
  employeeCommunityPostLimiter._reset();
  const db = mixedDb();
  const res = response();
  await createEmployeeCommunityMessage({ user: EMP2, body: { content: "hi team" } }, res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message.author.id, EMP2.id);
  assert.equal(res.body.message.author.name, "Sam Second");
});

// =================== credential leakage ===================

test("LEAK: the author projection is id + name only — no private User fields", async () => {
  const leaky = employeePost({
    customer: {
      id: "emp1",
      name: "Erin Employee",
      email: "erin@secret.test",
      phone: "555-1234",
      address: "1 Main St",
      passwordHash: "hashed-credential",
      status: "online",
      lastActiveAt: t("2026-09-01T00:00:00Z"),
      stripeCustomerId: "cus_stripe_secret",
      disabledAt: t("2026-09-01T00:00:00Z"),
      communityBlockedAt: null,
      role: ROLES.EMPLOYEE,
    },
  });
  const db = makeDb({ messages: [leaky], users: [EMP1] });
  const res = response();
  await listMyEmployeeCommunityMessages({ user: EMP1, query: {} }, res, db);

  assert.deepEqual(Object.keys(res.body.messages[0]).sort(), ["author", "content", "createdAt", "id"]);
  assert.deepEqual(Object.keys(res.body.messages[0].author).sort(), ["id", "name"]);

  const payload = JSON.stringify(res.body).toLowerCase();
  for (const forbidden of [
    "email", "phone", "address", "password", "stripe", "disabledat",
    "lastactiveat", "communityblockedat", "secret", "token", "credential",
  ]) {
    assert.equal(payload.includes(forbidden), false, `employee payload must not contain ${forbidden}`);
  }
});

test("LEAK: the admin moderation shape adds only deletedAt, never more author fields", async () => {
  const db = makeDb({ messages: [employeePost()], users: [EMP1] });
  const res = response();
  await adminListEmployeeCommunityMessages({ user: ADMIN, query: {} }, res, db);
  assert.deepEqual(
    Object.keys(res.body.messages[0]).sort(),
    ["author", "content", "createdAt", "deletedAt", "id"],
  );
  assert.deepEqual(Object.keys(res.body.messages[0].author).sort(), ["id", "name"]);
});

test("LEAK: the admin user list selects three fields and is scoped to employees", async () => {
  const db = makeDb({
    users: [
      { ...EMP1 },
      { ...CUS1 },
      { ...ADMIN },
      { ...EMP2, email: "sam@secret.test", phone: "555-9999" },
    ],
  });
  const res = response();
  await adminListEmployeeCommunityUsers({ user: ADMIN }, res, db);

  assert.equal(db.captured.findMany === undefined, true);
  const ids = res.body.users.map((u) => u.id).sort();
  assert.deepEqual(ids, ["emp1", "emp2"], "only employees may be listed");
  for (const u of res.body.users) {
    assert.deepEqual(Object.keys(u).sort(), ["communityBlockedAt", "id", "name"]);
  }
  const payload = JSON.stringify(res.body).toLowerCase();
  assert.equal(payload.includes("email"), false);
  assert.equal(payload.includes("phone"), false);
  assert.equal(payload.includes("password"), false);
});

test("LEAK: no employee route exposes the internal audience or moderation columns", async () => {
  const db = makeDb({ messages: [employeePost({ deletedAt: t("2026-09-05T00:00:00Z") })], users: [EMP1] });
  const res = response();
  await listMyEmployeeCommunityMessages({ user: EMP1, query: {} }, res, db);
  // The row is soft-deleted, so it must be absent entirely rather than exposed.
  assert.equal(res.body.messages.length, 0);
});

// =================== content validation ===================

test("VALIDATION: blank, whitespace-only, over-length and non-string content are rejected", async () => {
  const cases = [
    [{}, "missing body field"],
    [{ content: "" }, "empty"],
    [{ content: "   " }, "whitespace"],
    [{ content: null }, "null"],
    [{ content: 42 }, "number"],
    [{ content: "x".repeat(COMMUNITY_MESSAGE_MAX_LENGTH + 1) }, "too long"],
  ];
  for (const [body, label] of cases) {
    employeeCommunityPostLimiter._reset();
    const db = mixedDb();
    const res = response();
    await createEmployeeCommunityMessage({ user: EMP1, body }, res, db);
    assert.equal(res.statusCode, 400, `${label} must be rejected`);
    assert.equal(db.captured.create, undefined, `${label} must not write`);
  }
});

test("VALIDATION: exactly the max length is accepted and the content is trimmed", async () => {
  employeeCommunityPostLimiter._reset();
  const db = mixedDb();
  const res = response();
  await createEmployeeCommunityMessage(
    { user: EMP1, body: { content: `  ${"x".repeat(COMMUNITY_MESSAGE_MAX_LENGTH)}  ` } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(db.captured.create.content.length, COMMUNITY_MESSAGE_MAX_LENGTH);
});

// =================== blocking ===================

test("BLOCKED: a blocked employee may READ the community", async () => {
  const db = makeDb({ messages: [employeePost()], users: [EMP1] });
  const res = response();
  await listMyEmployeeCommunityMessages({ user: { ...EMP1, communityBlockedAt: t("2026-09-10T00:00:00Z") }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.messages.length, 1);
});

test("BLOCKED: a blocked employee may not POST", async () => {
  const db = mixedDb();
  const res = response();
  await createEmployeeCommunityMessage(
    { user: { ...EMP1, communityBlockedAt: t("2026-09-10T00:00:00Z") }, body: { content: "let me post" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(db.captured.create, undefined);
});

test("BLOCKED: blocking is what stops posting, not the read scope", async () => {
  // The block is stored on User.communityBlockedAt — the same column the customer
  // community already uses, so no new column exists for it.
  const src = readFileSync(new URL("../src/controllers/employeeCommunity.js", import.meta.url), "utf8");
  assert.match(src, /req\.user\.communityBlockedAt/);
  assert.equal(src.includes("communityBlockedAtDisabled"), false);
});

// =================== cross-role blocking ===================

test("CROSS-ROLE: blocking a CUSTOMER through the employee endpoint is refused with 404", async () => {
  const db = mixedDb();
  const res = response();
  await adminBlockEmployee({ user: ADMIN, params: { id: CUS1.id } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(db.captured.update, undefined, "a customer must never be blockable here");
});

test("CROSS-ROLE: blocking an ADMIN through the employee endpoint is refused with 404", async () => {
  const db = mixedDb();
  const res = response();
  await adminBlockEmployee({ user: ADMIN, params: { id: ADMIN.id } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(db.captured.update, undefined);
});

test("CROSS-ROLE: an unknown id and a customer id give the identical response (no oracle)", async () => {
  const unknown = response();
  await adminBlockEmployee({ user: ADMIN, params: { id: "does-not-exist" } }, unknown, mixedDb());
  const customer = response();
  await adminBlockEmployee({ user: ADMIN, params: { id: CUS1.id } }, customer, mixedDb());
  assert.equal(unknown.statusCode, 404);
  assert.equal(customer.statusCode, 404);
  assert.equal(JSON.stringify(unknown.body), JSON.stringify(customer.body));
});

test("CROSS-ROLE: blocking a real employee succeeds and writes communityBlockedAt", async () => {
  const db = mixedDb();
  const res = response();
  await adminBlockEmployee({ user: ADMIN, params: { id: EMP1.id } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.id, EMP1.id);
  assert.ok(res.body.user.communityBlockedAt, "the block timestamp must be returned");
});

test("CROSS-ROLE: unblocking clears communityBlockedAt back to null", async () => {
  const db = makeDb({ users: [{ ...EMP2, communityBlockedAt: t("2026-09-10T00:00:00Z") }] });
  const res = response();
  await adminUnblockEmployee({ user: ADMIN, params: { id: EMP2.id } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.communityBlockedAt, null);
});

test("CROSS-ROLE: a missing or empty id is a 400", async () => {
  for (const id of [undefined, "", 42]) {
    const db = mixedDb();
    const res = response();
    await adminBlockEmployee({ user: ADMIN, params: { id } }, res, db);
    assert.equal(res.statusCode, 400, `id ${JSON.stringify(id)} must be rejected`);
  }
});

// =================== soft delete ===================

test("DELETE: removing a post soft-deletes it — it is not destroyed", async () => {
  adminEmployeeCommunityActionLimiter._reset();
  const db = mixedDb();
  const res = response();
  await adminDeleteEmployeeCommunityMessage({ user: ADMIN, params: { messageId: "cm-e1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.message.deletedAt, "deletedAt must be stamped");
  assert.equal(db.captured.update.data.deletedById, ADMIN.id);
  // Soft delete: the row still exists in the store, it is only flagged.
  assert.ok(db.communityMessage);
});

test("DELETE: a soft-deleted post is hidden from employees but visible to the admin", async () => {
  adminEmployeeCommunityActionLimiter._reset();
  const removed = employeePost({ deletedAt: t("2026-09-05T00:00:00Z"), deletedById: "adm1" });

  const employeeView = response();
  const employeeDb = makeDb({ messages: [removed] });
  await listMyEmployeeCommunityMessages({ user: EMP1, query: {} }, employeeView, employeeDb);
  assert.equal(employeeView.body.messages.length, 0, "employees must not see a removed post");
  assert.equal(employeeDb.captured.findMany.where.deletedAt, null, "the employee feed must filter on deletedAt");

  const adminView = response();
  await adminListEmployeeCommunityMessages(
    { user: ADMIN, query: {} },
    adminView,
    makeDb({ messages: [removed] }),
  );
  assert.equal(adminView.body.messages.length, 1, "an admin must see what was removed");
  assert.equal(adminView.body.messages[0].deletedAt, "2026-09-05T00:00:00.000Z");
});

test("DELETE: soft delete is idempotent and keeps the original timestamp", async () => {
  adminEmployeeCommunityActionLimiter._reset();
  const already = t("2026-09-05T00:00:00Z");
  const db = makeDb({ messages: [employeePost({ deletedAt: already, deletedById: "adm1" })] });
  const res = response();
  await adminDeleteEmployeeCommunityMessage({ user: ADMIN, params: { messageId: "cm-e1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(db.captured.update, undefined, "an already-deleted post must not be rewritten");
  assert.equal(res.body.message.deletedAt, already.toISOString());
});

test("DELETE: a CUSTOMER message id returns 404 — never 403, never a deletion", async () => {
  adminEmployeeCommunityActionLimiter._reset();
  const db = mixedDb();
  const res = response();
  await adminDeleteEmployeeCommunityMessage({ user: ADMIN, params: { messageId: "cm-c1" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(db.captured.update, undefined, "a customer post must be untouched");
});

test("DELETE: unknown, missing and wrong-audience ids are indistinguishable 404s", async () => {
  adminEmployeeCommunityActionLimiter._reset();
  const unknown = response();
  await adminDeleteEmployeeCommunityMessage({ user: ADMIN, params: { messageId: "nope" } }, unknown, mixedDb());
  const customerRow = response();
  await adminDeleteEmployeeCommunityMessage({ user: ADMIN, params: { messageId: "cm-c1" } }, customerRow, mixedDb());
  assert.equal(unknown.statusCode, 404);
  assert.equal(customerRow.statusCode, 404);
  assert.equal(JSON.stringify(unknown.body), JSON.stringify(customerRow.body), "no existence oracle");
});

test("DELETE: a missing messageId is a 400", async () => {
  const db = mixedDb();
  const res = response();
  await adminDeleteEmployeeCommunityMessage({ user: ADMIN, params: { messageId: "" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(db.captured.findFirst, undefined);
});

// =================== pagination ===================

test("PAGINATION: default limit is 50 and limit is validated", async () => {
  const db = mixedDb();
  const res = response();
  await listMyEmployeeCommunityMessages({ user: EMP1, query: {} }, res, db);
  assert.equal(db.captured.findMany.take, 51, "take must be limit + 1");

  for (const bad of ["0", "101", "1.5", "abc", "-1"]) {
    const r = response();
    await listMyEmployeeCommunityMessages({ user: EMP1, query: { limit: bad } }, r, mixedDb());
    assert.equal(r.statusCode, 400, `limit=${bad} must be rejected`);
  }
});

test("PAGINATION: limit 100 is accepted", async () => {
  const db = mixedDb();
  const res = response();
  await listMyEmployeeCommunityMessages({ user: EMP1, query: { limit: "100" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(db.captured.findMany.take, 101);
});

test("PAGINATION: a malformed cursor is a 400, never a widened read", async () => {
  for (const before of ["not-base64-json", Buffer.from('{"t":"x","i":1}', "utf8").toString("base64url"), "e30"]) {
    const db = mixedDb();
    const res = response();
    await listMyEmployeeCommunityMessages({ user: EMP1, query: { before } }, res, db);
    assert.equal(res.statusCode, 400, `before=${before} must be rejected`);
    assert.equal(db.captured.findMany, undefined, "no query may run for a malformed cursor");
  }
});

test("PAGINATION: newest-first ordering with an id tie-break, and the audience survives the OR cursor", async () => {
  const rows = [
    employeePost({ id: "cm-e2", customerId: "emp2", createdAt: t("2026-09-02T00:00:00Z") }),
    employeePost({ id: "cm-e1", createdAt: t("2026-09-02T00:00:00Z") }),
  ];
  const db = makeDb({ messages: rows });
  const res = response();
  await listMyEmployeeCommunityMessages({ user: EMP1, query: {} }, res, db);
  assert.deepEqual(res.body.messages.map((m) => m.id), ["cm-e2", "cm-e1"], "id desc breaks the tie");

  const paged = makeDb({ messages: rows });
  const pagedRes = response();
  await listMyEmployeeCommunityMessages(
    { user: EMP1, query: { before: Buffer.from(JSON.stringify({ t: Date.parse("2026-09-02T00:00:00Z"), i: "cm-e2" }), "utf8").toString("base64url") } },
    pagedRes,
    paged,
  );
  // The audience pin and the cursor must coexist: audience is a top-level key,
  // the OR is nested under it, so neither can displace the other.
  assert.equal(paged.captured.findMany.where.audience, COMMUNITY_EMPLOYEE_AUDIENCE);
  assert.ok(Array.isArray(paged.captured.findMany.where.OR));
});

// =================== rate limiting ===================

test("RATE LIMIT: the 11th post in a window is 429 and writes nothing", async () => {
  employeeCommunityPostLimiter._reset();
  const db = mixedDb();
  for (let i = 0; i < 10; i += 1) {
    const res = response();
    await createEmployeeCommunityMessage({ user: EMP1, body: { content: `m${i}` } }, res, db);
    assert.equal(res.statusCode, 201);
  }
  const res = response();
  await createEmployeeCommunityMessage({ user: EMP1, body: { content: "eleven" } }, res, db);
  assert.equal(res.statusCode, 429);
  assert.match(res.body.error, /Too many requests/);
});

test("RATE LIMIT: the limiter key is namespaced per EMPLOYEE and away from the customer community", () => {
  employeeCommunityPostLimiter._reset();
  for (let i = 0; i < 10; i += 1) employeeCommunityPostLimiter.record(`employeeCommunity:${EMP1.id}`);
  assert.equal(employeeCommunityPostLimiter.allow(`employeeCommunity:${EMP1.id}`), false);
  assert.equal(employeeCommunityPostLimiter.allow(`employeeCommunity:${EMP2.id}`), true, "one employee must not throttle another");
  // The customer community uses the key `community:<id>`. This limiter must not
  // answer for it, or the two surfaces would share one budget.
  assert.equal(employeeCommunityPostLimiter.allow(`community:${CUS1.id}`), true);
  employeeCommunityPostLimiter._reset();
});

test("RATE LIMIT: a rejected attempt is not recorded, so it cannot extend the block", async () => {
  employeeCommunityPostLimiter._reset();
  const db = mixedDb();
  for (let i = 0; i < 10; i += 1) {
    await createEmployeeCommunityMessage({ user: EMP1, body: { content: `m${i}` } }, response(), db);
  }
  // An invalid draft must be rejected without touching the budget.
  const bad = response();
  await createEmployeeCommunityMessage({ user: EMP1, body: { content: "   " } }, bad, db);
  assert.equal(bad.statusCode, 400);
  assert.equal(employeeCommunityPostLimiter.allow(`employeeCommunity:${EMP1.id}`), false, "still at the limit");
  employeeCommunityPostLimiter._reset();
});

test("RATE LIMIT: admin moderation actions have their own limiter, separate from posting", () => {
  adminEmployeeCommunityActionLimiter._reset();
  employeeCommunityPostLimiter._reset();
  for (let i = 0; i < 30; i += 1) adminEmployeeCommunityActionLimiter.record(`employeeCommunity:admin:${ADMIN.id}`);
  assert.equal(adminEmployeeCommunityActionLimiter.allow(`employeeCommunity:admin:${ADMIN.id}`), false);
  assert.equal(employeeCommunityPostLimiter.allow(`employeeCommunity:${EMP1.id}`), true, "posting budget is unaffected");
  adminEmployeeCommunityActionLimiter._reset();
});

// =================== route wiring (source text) ===================

const routesSrc = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");

test("ROUTES: both employee routes are authenticate + requireEmployee", () => {
  assert.ok(
    routesSrc.includes(
      'router.get("/employee/community/messages", authenticate, requireEmployee, employeeCommunity.listMyEmployeeCommunityMessages)',
    ),
    "GET /employee/community/messages must be authenticate + requireEmployee",
  );
  assert.ok(
    routesSrc.includes(
      'router.post("/employee/community/messages", authenticate, requireEmployee, employeeCommunity.createEmployeeCommunityMessage)',
    ),
    "POST /employee/community/messages must be authenticate + requireEmployee",
  );
});

test("ROUTES: every admin moderation route is adminOnly", () => {
  for (const line of [
    'router.get("/admin/community/employee/messages", adminOnly, employeeCommunity.adminListEmployeeCommunityMessages)',
    'router.delete("/admin/community/employee/messages/:messageId", adminOnly, employeeCommunity.adminDeleteEmployeeCommunityMessage)',
    'router.get("/admin/community/employee/users", adminOnly, employeeCommunity.adminListEmployeeCommunityUsers)',
    'router.post("/admin/community/employee/users/:id/block", adminOnly, employeeCommunity.adminBlockEmployee)',
    'router.post("/admin/community/employee/users/:id/unblock", adminOnly, employeeCommunity.adminUnblockEmployee)',
  ]) {
    assert.ok(routesSrc.includes(line), `missing or miswired route: ${line}`);
  }
});

test("ROUTES: no route lets an employee address another employee or a customer", () => {
  for (const forbidden of [
    '"/employee/community/users',
    '"/employee/community/messages/:',
    "employeeCommunity.listMyCommunityMessages",
    'router.post("/admin/community/employee/messages"',
  ]) {
    assert.equal(routesSrc.includes(forbidden), false, `unexpected route surface: ${forbidden}`);
  }
});

test("ROUTES: there is no admin CREATE route for the employee community", () => {
  const adminLines = routesSrc.split("\n").filter((l) => l.includes("/admin/community/employee"));
  for (const line of adminLines) {
    assert.equal(/router\.post\([^)]*create/i.test(line), false, "admins must never author: " + line.trim());
  }
});

test("ROUTES: the employee community sits on its own prefix, never under /community", () => {
  assert.equal(routesSrc.includes('"/community/messages", authenticate, requireCustomer'), true, "the customer route is unchanged");
  assert.equal(routesSrc.includes('"/employee/community/messages"'), true);
});

// =================== scope: no employee<->customer messaging ===================

test("SCOPE: the employee community controller never touches the Message model", async () => {
  const src = readFileSync(new URL("../src/controllers/employeeCommunity.js", import.meta.url), "utf8");
  assert.equal(/\bdb\.message\b/.test(src), false);
  assert.equal(src.includes("receiverId"), false);
  assert.equal(src.includes("senderId"), false);
});

test("SCOPE: the existing messages controller is not modified to add employee routes", () => {
  const src = readFileSync(new URL("../src/controllers/messages.js", import.meta.url), "utf8");
  assert.equal(src.includes("employeeCommunity"), false);
});

test("SCOPE: no customer-facing community route is left unpinned", () => {
  const customerLines = routesSrc.split("\n").filter((l) => l.includes('"/community/'));
  assert.ok(customerLines.length >= 2);
  for (const line of customerLines) {
    assert.match(line, /requireCustomer/, "customer community route lost its guard: " + line.trim());
  }
});

// =================== shared reader integrity ===================

test("READER: the shared reader has no default audience — omitting one cannot silently mean 'all'", async () => {
  const { readCommunityFeed } = await import("../src/controllers/community.js");
  // A missing audience leaves `where.audience` undefined rather than defaulting
  // to a community. In Prisma an undefined field is dropped from the filter, so
  // the query would read EVERY audience — which is precisely why every call
  // site in this codebase passes a literal. This test pins that there is no
  // default argument to fall back on.
  const db = makeDb({ messages: [employeePost(), customerPost()] });
  const res = response();
  await readCommunityFeed({ query: {} }, res, db, { shape: (m) => ({ id: m.id }) });
  assert.equal(db.captured.findMany.where.audience, undefined, "no audience may be invented");
  // The fake matches `audience === undefined` literally, so it returns nothing.
  // Real Prisma DROPS an undefined field from the filter and would return EVERY
  // audience. The asymmetry is the point: the reader must never be able to
  // invent a default, because the safe-looking fallback in Prisma is the leak.
  assert.equal(res.body.messages.length, 0);
  // Guard the guard: the reader must never contain a hardcoded fallback.
  const src = readFileSync(new URL("../src/controllers/community.js", import.meta.url), "utf8");
  const signature = src.split("\n").find((l) => l.includes("export async function readCommunityFeed"));
  assert.equal(signature.includes("="), false, "options must not have a destructuring default: " + signature.trim());
  assert.equal(/audience\s*=\s*[A-Z_]/.test(src), false, "no audience may be defaulted from a constant");
});

test("READER: hideDeleted adds the filter and its absence leaves rows untouched", async () => {
  const { readCommunityFeed } = await import("../src/controllers/community.js");
  const shape = (m) => ({ id: m.id });

  const hidden = makeDb({ messages: [employeePost({ deletedAt: t("2026-09-05T00:00:00Z") })] });
  await readCommunityFeed({ query: {} }, response(), hidden, {
    audience: COMMUNITY_EMPLOYEE_AUDIENCE, shape, hideDeleted: true,
  });
  assert.equal(hidden.captured.findMany.where.deletedAt, null);

  const shown = makeDb({ messages: [employeePost({ deletedAt: t("2026-09-05T00:00:00Z") })] });
  await readCommunityFeed({ query: {} }, response(), shown, {
    audience: COMMUNITY_EMPLOYEE_AUDIENCE, shape,
  });
  assert.equal(shown.captured.findMany.where.deletedAt, undefined);
});
