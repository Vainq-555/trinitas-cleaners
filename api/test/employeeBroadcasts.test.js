import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import prisma from "../src/utils/prisma.js";
import { COOKIE_NAME, ROLES } from "../src/config.js";
import { authenticate, requireAdmin, requireCustomer, requireEmployee } from "../src/middleware/auth.js";
import {
  adminCreateBroadcast,
  adminListBroadcasts,
  listMyBroadcasts,
  listMyEmployeeBroadcasts,
  listPublicBroadcasts,
  markBroadcastRead,
  markEmployeeBroadcastRead,
} from "../src/controllers/broadcasts.js";

// Phase 2B-2 — employee announcements.
//
// The important tests here run the controller's `where` clause through a real
// evaluator (see `matchesWhere`) over a set of rows, so audience separation is
// proven at the ROW level rather than by asserting that a where clause mentions a
// field. A string assertion would still pass if the AND/OR logic were wrong.

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
    for (const method of Object.keys(methods)) {
      originals[`${model}.${method}`] = prisma[model][method];
      prisma[model][method] = methods[method];
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      const [model, method] = key.split(".");
      prisma[model][method] = value;
    }
  }
}

// Minimal Prisma `where` evaluator covering exactly the operators these
// controllers use: field equality, AND, and OR. Anything richer would be a false
// positive, so an unsupported operator throws instead of silently passing.
function matchesWhere(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every((sub) => matchesWhere(row, sub));
    if (key === "OR") return value.some((sub) => matchesWhere(row, sub));
    if (key === "NOT") return !matchesWhere(row, value);
    return row[key] === value;
  });
}

// A broadcast row as stored. `audience` is always explicit here because the
// migration backfills every pre-existing row to "customer".
const bc = (over = {}) => ({
  id: "b1",
  type: "announcement",
  target: "all",
  audience: "customer",
  title: "Title",
  content: "Content",
  userId: null,
  createdAt: t("2026-09-20T12:00:00Z"),
  ...over,
});

const EMP1 = { id: "emp1", role: ROLES.EMPLOYEE, disabledAt: null };
const EMP2 = { id: "emp2", role: ROLES.EMPLOYEE, disabledAt: null };
const CUS1 = { id: "cus1", role: ROLES.CUSTOMER };
const ADMIN = { id: "adm1", role: ROLES.ADMIN };

// The full cross-product of audiences and targets, as stored data.
const ROWS = [
  bc({ id: "cust_all", audience: "customer", target: "all" }),
  bc({ id: "cust_specific_other", audience: "customer", target: "specific_user", userId: "cus9" }),
  bc({ id: "cust_specific_mine", audience: "customer", target: "specific_user", userId: "cus1" }),
  bc({ id: "cust_public", audience: "customer", target: "public" }),
  bc({ id: "emp_all", audience: "employee", target: "all" }),
  bc({ id: "emp_specific_me", audience: "employee", target: "specific_user", userId: "emp1" }),
  bc({ id: "emp_specific_other", audience: "employee", target: "specific_user", userId: "emp2" }),
];

// Prisma applies `select` server-side, so the fake must too — otherwise a test
// asserting "this field is not exposed" would pass or fail for the wrong reason
// (it would be measuring the fixture, not the query).
const applySelect = (row, select) => {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
};

// Runs a controller against ROWS, honouring its where clause, and returns the ids
// it actually delivered. `reads` are the UserBroadcastRead rows for that user.
async function deliver(fn, req, { reads = [] } = {}) {
  const res = response();
  const captured = {};
  await withDb(
    {
      broadcast: {
        findMany: async (args) => {
          captured.findMany = args;
          return ROWS.filter((row) => matchesWhere(row, args.where)).map((r) => applySelect(r, args.select));
        },
        findFirst: async (args) => {
          captured.findFirst = args;
          const row = ROWS.find((r) => matchesWhere(r, args.where));
          return row ? applySelect(row, args.select) : null;
        },
      },
      userBroadcastRead: {
        findMany: async (args) => {
          captured.reads = args;
          return reads
            .filter((r) => r.userId === args.where.userId)
            .map((r) => ({ broadcastId: r.broadcastId }));
        },
        findUnique: async (args) => {
          captured.findUnique = args;
          const { userId, broadcastId } = args.where.userId_broadcastId;
          return reads.find((r) => r.userId === userId && r.broadcastId === broadcastId)
            ? { userId, broadcastId }
            : null;
        },
        create: async (args) => {
          captured.created = [...(captured.created ?? []), args.data];
          reads.push(args.data);
          return args.data;
        },
      },
    },
    () => fn(req, res),
  );
  return { res, captured };
}

const ids = (body) => body.broadcasts.map((b) => b.id);

// =================== EMPLOYEE READ: audience separation ===================

test("employee: sees all-employees and own-specific announcements, and nothing else", async () => {
  const { res } = await deliver(listMyEmployeeBroadcasts, { user: EMP1 });
  assert.equal(res.statusCode, 200);
  // Only employee-audience rows, and only those actually aimed at this employee.
  assert.deepEqual(ids(res.body).sort(), ["emp_all", "emp_specific_me"]);
});

test("employee: another employee's specific announcement is NOT delivered", async () => {
  const { res } = await deliver(listMyEmployeeBroadcasts, { user: EMP1 });
  assert.equal(
    res.body.broadcasts.some((b) => b.id === "emp_specific_other"),
    false,
    "an announcement aimed at a different employee must never be delivered",
  );
});

test("employee: no customer announcement is ever delivered, whatever its target", async () => {
  const { res } = await deliver(listMyEmployeeBroadcasts, { user: EMP1 });
  const customerIds = ROWS.filter((r) => r.audience === "customer").map((r) => r.id);
  for (const id of customerIds) {
    assert.equal(
      res.body.broadcasts.some((b) => b.id === id),
      false,
      `customer announcement ${id} must not reach an employee`,
    );
  }
});

test("employee: a customer 'all' announcement is NOT delivered — target=all never means everybody", async () => {
  // The single most important regression guard in this phase: this is the exact
  // row that the pre-2B-2 query shape (OR target=all) would have leaked.
  const { res } = await deliver(listMyEmployeeBroadcasts, { user: EMP1 });
  assert.equal(
    res.body.broadcasts.some((b) => b.id === "cust_all"),
    false,
    'target="all" with audience="customer" must not reach an employee',
  );
});

test("employee: the read query is scoped to the session employee, never a request-supplied id", async () => {
  const { captured } = await deliver(listMyEmployeeBroadcasts, { user: EMP1 });
  assert.equal(captured.findMany.where.AND[1].OR[1].AND[1].userId, "emp1");
  // A userId query parameter must not exist anywhere in the args.
  assert.equal(JSON.stringify(captured.findMany).includes("userId2"), false);
});

test("employee: the response exposes only display fields — no targeting internals", async () => {
  const { res, captured } = await deliver(listMyEmployeeBroadcasts, { user: EMP1 });
  assert.deepEqual(Object.keys(captured.findMany.select).sort(), [
    "content",
    "createdAt",
    "id",
    "title",
    "type",
  ]);
  for (const b of res.body.broadcasts) {
    for (const forbidden of ["userId", "target", "audience", "user", "readBy"]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(b, forbidden),
        false,
        `employee response must not expose ${forbidden}`,
      );
    }
  }
});

test("employee: read state is returned per announcement", async () => {
  const { res } = await deliver(listMyEmployeeBroadcasts, { user: EMP1 }, {
    reads: [{ userId: "emp1", broadcastId: "emp_all" }],
  });
  const byId = Object.fromEntries(res.body.broadcasts.map((b) => [b.id, b.read]));
  assert.equal(byId.emp_all, true);
  assert.equal(byId.emp_specific_me, false);
});

// =================== CUSTOMER READ: unchanged, and now isolated ===================

test("customer: still receives customer 'all' and own-specific announcements", async () => {
  const { res } = await deliver(listMyBroadcasts, { user: CUS1 });
  // This is the pre-Phase-2B-2 customer behavior, preserved exactly.
  assert.deepEqual(ids(res.body).sort(), ["cust_all", "cust_specific_mine"]);
});

test("customer: 'all' still means all CUSTOMERS — proven by row-level evaluation", async () => {
  const { res } = await deliver(listMyBroadcasts, { user: CUS1 });
  assert.equal(
    res.body.broadcasts.some((b) => b.id === "cust_all"),
    true,
    'target="all" must keep meaning all customers for existing data',
  );
});

test("customer: another customer's specific announcement is not delivered", async () => {
  const { res } = await deliver(listMyBroadcasts, { user: CUS1 });
  assert.equal(res.body.broadcasts.some((b) => b.id === "cust_specific_other"), false);
});

test("customer: NO employee announcement reaches a customer", async () => {
  const { res } = await deliver(listMyBroadcasts, { user: CUS1 });
  for (const id of ["emp_all", "emp_specific_me", "emp_specific_other"]) {
    assert.equal(
      res.body.broadcasts.some((b) => b.id === id),
      false,
      `employee announcement ${id} must not reach a customer`,
    );
  }
});

test("customer: the customer response shape is unchanged (type is still returned)", async () => {
  // The customer dashboard renders a badge from b.type, so this field must not be
  // narrowed away.
  const { res, captured } = await deliver(listMyBroadcasts, { user: CUS1 });
  assert.equal(captured.findMany.select, undefined, "customer projection must stay un-narrowed");
  assert.equal(res.body.broadcasts[0].type, "announcement");
});

test("public site: only customer-audience public announcements are served", async () => {
  const { res } = await deliver(listPublicBroadcasts, {});
  assert.deepEqual(ids(res.body), ["cust_public"]);
});

// =================== READ STATE ===================

test("employee: can mark their own visible announcement read", async () => {
  const { res, captured } = await deliver(markEmployeeBroadcastRead, {
    user: EMP1,
    params: { id: "emp_all" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  // Written against the session employee, never a request-supplied user id.
  assert.deepEqual(captured.created, [{ userId: "emp1", broadcastId: "emp_all" }]);
});

test("employee: cannot mark another employee's announcement read", async () => {
  const { res, captured } = await deliver(markEmployeeBroadcastRead, {
    user: EMP1,
    params: { id: "emp_specific_other" },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(captured.created, undefined, "no read row may be written");
});

test("employee: cannot mark a customer announcement read", async () => {
  for (const id of ["cust_all", "cust_specific_mine"]) {
    const { res, captured } = await deliver(markEmployeeBroadcastRead, {
      user: EMP1,
      params: { id },
    });
    assert.equal(res.statusCode, 404, `${id} must not be markable by an employee`);
    assert.equal(captured.created, undefined);
  }
});

test("employee: marking read twice is idempotent, and writes one row", async () => {
  const reads = [];
  const first = await deliver(markEmployeeBroadcastRead, { user: EMP1, params: { id: "emp_all" } }, { reads });
  assert.equal(first.res.statusCode, 200);
  assert.equal(first.captured.created.length, 1);
  // Second identical request: the existing row is found, so nothing is created.
  const second = await deliver(markEmployeeBroadcastRead, { user: EMP1, params: { id: "emp_all" } }, { reads });
  assert.equal(second.res.statusCode, 200);
  assert.equal(second.captured.created, undefined, "an existing read row must not be recreated");
  assert.equal(reads.length, 1, "exactly one read record exists");
});

test("employee: a concurrent duplicate insert cannot surface as a 500", async () => {
  // Simulates losing the race: findUnique reports no row, then create throws the
  // unique-constraint error a real concurrent insert would raise.
  const res = response();
  await withDb(
    {
      broadcast: { findFirst: async () => ({ id: "emp_all" }) },
      userBroadcastRead: {
        findUnique: async () => null,
        create: async () => {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        },
      },
    },
    () => markEmployeeBroadcastRead({ user: EMP1, params: { id: "emp_all" } }, res),
  );
  assert.equal(res.statusCode, 200, "a lost race is the desired end state, not an error");
});

test("customer: cannot mark an employee announcement read (pre-2B-2 defect now closed)", async () => {
  const { res, captured } = await deliver(markBroadcastRead, {
    user: CUS1,
    params: { id: "emp_all" },
  });
  assert.equal(res.statusCode, 404, "a customer must not write read state for employee announcements");
  assert.equal(captured.created, undefined);
});

test("customer: can still mark their own visible announcement read", async () => {
  const { res, captured } = await deliver(markBroadcastRead, { user: CUS1, params: { id: "cust_all" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(captured.created, [{ userId: "cus1", broadcastId: "cust_all" }]);
});

test("read state is keyed to the session user, so one employee's read never marks another's", async () => {
  const reads = [{ userId: "emp2", broadcastId: "emp_all" }];
  const { res, captured } = await deliver(markEmployeeBroadcastRead, {
    user: EMP1,
    params: { id: "emp_all" },
  }, { reads });
  // emp1 has not read it, so emp1's own row is created alongside emp2's.
  assert.equal(res.statusCode, 200);
  assert.deepEqual(captured.created, [{ userId: "emp1", broadcastId: "emp_all" }]);
  assert.equal(reads.length, 2);
});

// =================== ADMIN CREATION ===================

const adminCreate = (body, { users = {} } = {}) => {
  const res = response();
  let created = null;
  return withDb(
    {
      user: {
        findUnique: async ({ where }) => {
          const u = users[where.id];
          return u ? { id: u.id, role: u.role } : null;
        },
      },
      broadcast: {
        create: async ({ data }) => {
          created = data;
          return { id: "bnew", ...data };
        },
      },
    },
    () => adminCreateBroadcast({ user: ADMIN, body }, res),
  ).then(() => ({ res, created }));
};

test("admin: can create an all-employees announcement", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    audience: "employee",
    target: "all",
    content: "Staff meeting Friday 9am",
  });
  assert.equal(res.statusCode, 201);
  assert.equal(created.audience, "employee");
  assert.equal(created.target, "all");
  assert.equal(created.userId, null, "an all-employees announcement targets no individual");
});

test("admin: can target one specific employee", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    audience: "employee",
    target: "specific_user",
    userId: "emp1",
    content: "You are assigned to the Oak Park job",
  }, { users: { emp1: EMP1 } });
  assert.equal(res.statusCode, 201);
  assert.equal(created.audience, "employee");
  assert.equal(created.userId, "emp1");
});

test("admin: a customer id may NOT be delivered as an employee announcement", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    audience: "employee",
    target: "specific_user",
    userId: "cus1",
    content: "Cross-audience attempt",
  }, { users: { cus1: CUS1 } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /is a customer, not a employee/);
  assert.equal(created, null, "nothing may be written");
});

test("admin: an employee id may NOT be delivered as a customer announcement", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    audience: "customer",
    target: "specific_user",
    userId: "emp1",
    content: "Cross-audience attempt",
  }, { users: { emp1: EMP1 } });
  assert.equal(res.statusCode, 400);
  assert.equal(created, null);
});

test("admin: an audience is required — it is never inferred from target", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    target: "all",
    content: "No audience stated",
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /audience is required/);
  assert.equal(created, null);
});

test("admin: an unknown audience is rejected", async () => {
  for (const audience of ["everyone", "public", "CUSTOMER", "", "all"]) {
    const { res, created } = await adminCreate({
      type: "announcement",
      audience,
      target: "all",
      content: "Bad audience",
    });
    assert.equal(res.statusCode, 400, `audience=${JSON.stringify(audience)} must be rejected`);
    assert.equal(created, null);
  }
});

test("admin: an employee announcement cannot be published to the public site", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    audience: "employee",
    target: "public",
    content: "Should not be public",
  });
  assert.equal(res.statusCode, 400);
  assert.equal(created, null);
});

test("admin: targeting a specific user requires a userId", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    audience: "employee",
    target: "specific_user",
    content: "No id",
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /userId is required/);
  assert.equal(created, null);
});

test("admin: a nonexistent target account is rejected", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    audience: "employee",
    target: "specific_user",
    userId: "ghost",
    content: "Ghost",
  }, { users: {} });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /does not exist/);
  assert.equal(created, null);
});

test("admin: existing customer announcement creation is unchanged", async () => {
  const { res, created } = await adminCreate({
    type: "announcement",
    audience: "customer",
    target: "all",
    content: "Holiday hours",
  });
  assert.equal(res.statusCode, 201);
  assert.equal(created.audience, "customer");
  assert.equal(created.target, "all");
});

test("admin: the admin list still returns the audience so the UI can label it", async () => {
  const res = response();
  let args = null;
  await withDb(
    { broadcast: { findMany: async (a) => { args = a; return []; } } },
    () => adminListBroadcasts({ user: ADMIN }, res),
  );
  assert.equal(res.statusCode, 200);
  // Un-narrowed, so `audience` is present in each row for labelling.
  assert.equal(args.select, undefined, "admin view must stay un-narrowed");
});

// =================== ROUTE-LEVEL AUTHORIZATION ===================

function guard(fn, user) {
  const res = response();
  let passed = false;
  fn({ user }, res, () => { passed = true; });
  return { passed, res };
}

test("guards: requireEmployee admits an employee and refuses customer and admin", () => {
  assert.equal(guard(requireEmployee, EMP1).passed, true);
  assert.equal(guard(requireEmployee, CUS1).passed, false);
  assert.equal(guard(requireEmployee, ADMIN).passed, false);
});

test("guards: requireCustomer still refuses an employee, so the employee feed stays separate", () => {
  // An employee must not be able to read the customer feed at all.
  assert.equal(guard(requireCustomer, EMP1).passed, false);
  assert.equal(guard(requireCustomer, CUS1).passed, true);
  assert.equal(guard(requireCustomer, ADMIN).passed, false);
});

test("guards: requireAdmin still admits only an admin", () => {
  assert.equal(guard(requireAdmin, ADMIN).passed, true);
  assert.equal(guard(requireAdmin, EMP1).passed, false);
  assert.equal(guard(requireAdmin, CUS1).passed, false);
});

test("wiring: both employee announcement routes are authenticate + requireEmployee", () => {
  const src = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  assert.ok(
    src.includes('router.get("/employee/broadcasts", authenticate, requireEmployee, broadcasts.listMyEmployeeBroadcasts)'),
    "GET /employee/broadcasts must be authenticate + requireEmployee",
  );
  assert.ok(
    src.includes("broadcasts.markEmployeeBroadcastRead"),
    "the employee mark-read route must exist",
  );
  // Both must be behind the same guard, never a bare handler.
  const markReadRoute = src.slice(src.indexOf('"/employee/broadcasts/:id/read"') - 40);
  assert.match(
    markReadRoute,
    /authenticate,\s*\n?\s*requireEmployee,\s*\n?\s*broadcasts\.markEmployeeBroadcastRead/,
    "POST /employee/broadcasts/:id/read must be authenticate + requireEmployee",
  );
});

test("wiring: employees are given no admin or customer broadcast capability", () => {
  const src = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  // No employee-writable broadcast route of any kind.
  for (const forbidden of [
    'router.post("/employee/broadcasts"',
    'router.put("/employee/broadcasts',
    'router.patch("/employee/broadcasts',
    'router.delete("/employee/broadcasts',
  ]) {
    assert.equal(src.includes(forbidden), false, `employees must not be able to call ${forbidden}`);
  }
  // The existing admin and customer routes keep their own guards.
  assert.ok(src.includes('router.get("/broadcasts/mine", authenticate, requireCustomer, broadcasts.listMyBroadcasts)'));
  assert.ok(src.includes('router.post("/broadcasts/mine/:id/read", authenticate, requireCustomer, broadcasts.markBroadcastRead)'));
  assert.ok(src.includes("const adminOnly = [authenticate, requireAdmin];"));
  for (const line of [
    'router.get("/admin/broadcasts", adminOnly, broadcasts.adminListBroadcasts);',
    'router.post("/admin/broadcasts", adminOnly, broadcasts.adminCreateBroadcast);',
    'router.delete("/admin/broadcasts/:id", adminOnly, broadcasts.adminDeleteBroadcast);',
  ]) {
    assert.ok(src.includes(line), `admin route must be unchanged: ${line}`);
  }
});

test("wiring: no employee broadcast route accepts a user id or audience from the request", () => {
  const src = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  for (const forbidden of [
    '/employee/broadcasts/:userId',
    '/employee/broadcasts?',
    'employeeId',
  ]) {
    assert.equal(src.includes(forbidden), false, `employee broadcast routing must not expose ${forbidden}`);
  }
});

test("wiring: the customer feed is pinned to the customer audience in the query", () => {
  const src = readFileSync(new URL("../src/controllers/broadcasts.js", import.meta.url), "utf8");
  // Both the customer list and the public list must carry the audience filter.
  const listStart = src.indexOf("export async function listMyBroadcasts");
  const markStart = src.indexOf("export async function markBroadcastRead");
  const segment = src.slice(listStart, markStart);
  assert.match(segment, /visibleToUser\(\{ userId: req\.user\.id, audience: BROADCAST_AUDIENCE_DEFAULT \}\)/);
  assert.match(src.slice(0, listStart), /target: "public", type: "announcement", \.\.\.CUSTOMER_AUDIENCE/);
});

// =================== DISABLED EMPLOYEE ===================

test("a disabled employee cannot reach the employee announcement endpoints", async () => {
  // The existing middleware handles this — there is no separate disabled-user
  // mechanism for announcements. `authenticate` re-reads disabledAt on every
  // request, and both employee routes start with it, so an already-issued session
  // stops working on its very next call.
  const { signToken } = await import("../src/utils/jwt.js");
  const disabled = { id: "emp1", role: ROLES.EMPLOYEE, disabledAt: t("2026-09-26T00:00:00Z") };

  for (const route of ["GET /employee/broadcasts", "POST /employee/broadcasts/:id/read"]) {
    const res = response();
    let reached = false;
    const req = {
      cookies: { [COOKIE_NAME]: signToken({ sub: "emp1", role: ROLES.EMPLOYEE }) },
      headers: {},
    };
    await withDb(
      { user: { findUnique: async () => disabled } },
      () => authenticate(req, res, () => { reached = true; }),
    );
    assert.equal(res.statusCode, 401, `${route} must reject a disabled employee`);
    assert.match(res.body.error, /disabled/);
    assert.equal(reached, false, `${route} must not reach its handler for a disabled employee`);
  }
});

test("an enabled employee passes the same gate", async () => {
  const { signToken } = await import("../src/utils/jwt.js");
  const res = response();
  let reached = false;
  const req = {
    cookies: { [COOKIE_NAME]: signToken({ sub: "emp1", role: ROLES.EMPLOYEE }) },
    headers: {},
  };
  await withDb(
    { user: { findUnique: async () => ({ id: "emp1", role: ROLES.EMPLOYEE, disabledAt: null }) } },
    () => authenticate(req, res, () => { reached = true; }),
  );
  assert.equal(res.statusCode, null, "an enabled employee must not be rejected");
  assert.equal(reached, true);
});

test("a missing or invalid session cannot reach the employee announcement endpoints", async () => {
  for (const cookies of [{}, { [COOKIE_NAME]: "not-a-real-token" }]) {
    const res = response();
    let reached = false;
    await withDb({}, () => authenticate({ cookies, headers: {} }, res, () => { reached = true; }));
    assert.equal(res.statusCode, 401);
    assert.equal(reached, false);
  }
});

test("schema: the audience column is additive with a customer default", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const model = schema.slice(schema.indexOf("model Broadcast {"), schema.indexOf("model UserBroadcastRead"));
  assert.match(model, /audience\s+String\s+@default\("customer"\)/);
  // Nothing removed or renamed.
  for (const kept of [/type\s+String/, /target\s+String/, /userId\s+String\?/, /title\s+String\?/, /content\s+String/]) {
    assert.match(model, kept, "existing Broadcast fields must be preserved");
  }
  // The read model is untouched: still keyed by the authenticated user.
  const readModel = schema.slice(schema.indexOf("model UserBroadcastRead"));
  assert.match(readModel.slice(0, 400), /@@id\(\[userId, broadcastId\]\)/);
});
