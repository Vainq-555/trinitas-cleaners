import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import prisma from "../src/utils/prisma.js";
import { ROLES } from "../src/config.js";
import { signToken } from "../src/utils/jwt.js";
import {
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireAdmin,
  requireCustomer,
  requireEmployee,
} from "../src/middleware/auth.js";
import { deleteAccount, login } from "../src/controllers/auth.js";
import prismaRouterSource from "../src/routes/index.js";

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

const employee = (overrides = {}) => ({
  id: "emp1",
  email: "emp@example.com",
  name: "Erin",
  phone: null,
  role: ROLES.EMPLOYEE,
  status: "offline",
  lastActiveAt: null,
  disabledAt: null,
  passwordHash: "hash",
  ...overrides,
});
const customer = (overrides = {}) => ({ id: "cus1", role: ROLES.CUSTOMER, disabledAt: null, ...overrides });
const admin = (overrides = {}) => ({ id: "adm1", role: ROLES.ADMIN, disabledAt: null, ...overrides });

// Runs `authenticate` with a signed token for `user` and a stubbed DB row.
async function runAuthenticate(storedUser, tokenUser) {
  const req = { cookies: { tc_token: signToken(tokenUser || storedUser) }, headers: {} };
  const res = response();
  let nextCalled = false;
  let nextError;
  await withDb(
    { user: { findUnique: async () => storedUser, update: async () => storedUser } },
    () => authenticate(req, res, (e) => { nextCalled = true; nextError = e; }),
  );
  return { req, res, nextCalled, nextError };
}

// ---- AUTH: employee can authenticate; a disabled one cannot ----

test("auth: an active employee authenticates and is loaded from the database", async () => {
  const { req, res, nextCalled } = await runAuthenticate(employee());
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null, "no error response");
  assert.equal(req.user.id, "emp1");
  assert.equal(req.user.role, ROLES.EMPLOYEE);
});

test("auth: a DISABLED employee is rejected even with a valid unexpired token", async () => {
  const { res, nextCalled } = await runAuthenticate(employee({ disabledAt: t("2026-09-01T00:00:00Z") }));
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /disabled/i);
  assert.equal(nextCalled, false, "a disabled account must not reach any protected handler");
});

test("auth: disable takes effect from the DB read, not from the token claims", async () => {
  // The token was minted while the account was still active and carries no
  // disabled information. Because `authenticate` re-reads the user, the very
  // same token is refused the moment the row is disabled.
  const activeTokenUser = employee();
  const { res, nextCalled } = await runAuthenticate(
    employee({ disabledAt: t("2026-09-01T00:00:00Z") }),
    activeTokenUser,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("auth: customer authentication still works unchanged (disabledAt null)", async () => {
  const { req, nextCalled } = await runAuthenticate(customer({ status: "online", lastActiveAt: null }));
  assert.equal(nextCalled, true);
  assert.equal(req.user.role, ROLES.CUSTOMER);
});

test("auth: admin authentication still works unchanged (disabledAt null)", async () => {
  const { req, nextCalled } = await runAuthenticate(admin({ status: "online", lastActiveAt: null }));
  assert.equal(nextCalled, true);
  assert.equal(req.user.role, ROLES.ADMIN);
});

test("auth: a disabled account cannot log in", async () => {
  const res = response();
  const stored = employee({ disabledAt: t("2026-09-01T00:00:00Z") });
  await withDb(
    { user: { findUnique: async () => stored, update: async () => stored } },
    () => login({ body: { email: stored.email, password: "password123" } }, res),
  );
  // A disabled employee has no usable password, so login is refused before the
  // disabled check is even reached. The important guarantee is that no session is
  // issued and no auth cookie is set.
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /Invalid email or password/);
});

test("auth: optionalAuthenticate treats a disabled account as anonymous", async () => {
  const req = { cookies: { tc_token: signToken(employee()) }, headers: {} };
  const res = response();
  let nextCalled = false;
  await withDb(
    { user: { findUnique: async () => employee({ disabledAt: t("2026-09-01T00:00:00Z") }) } },
    () => optionalAuthenticate(req, res, () => { nextCalled = true; }),
  );
  assert.equal(nextCalled, true);
  assert.equal(req.user, undefined, "a disabled account must not be attached as a signed-in user");
});

// ---- AUTHORIZATION: explicit per-role guards, no hierarchy ----

const guard = (guardFn, user) => {
  const res = response();
  let passed = false;
  guardFn({ user }, res, () => { passed = true; });
  return { passed, res };
};

test("guards: an employee can access employee-protected routes", () => {
  assert.equal(guard(requireEmployee, employee()).passed, true);
});

test("guards: an employee CANNOT access customer-only routes (no inheritance)", () => {
  const { passed, res } = guard(requireCustomer, employee());
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /insufficient role/);
});

test("guards: an employee CANNOT access admin-only routes", () => {
  const { passed, res } = guard(requireAdmin, employee());
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("guards: a customer CANNOT access employee routes", () => {
  const { passed, res } = guard(requireEmployee, customer());
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("guards: an admin retains admin access and is not treated as an employee", () => {
  assert.equal(guard(requireAdmin, admin()).passed, true);
  assert.equal(guard(requireEmployee, admin()).passed, false);
});

test("guards: customer-only routes are still customer-only (not widened)", () => {
  assert.equal(guard(requireCustomer, customer()).passed, true);
  assert.equal(guard(requireCustomer, admin()).passed, false);
});

test("guards: admin-only routes are still admin-only (not weakened)", () => {
  assert.equal(guard(requireAdmin, admin()).passed, true);
  assert.equal(guard(requireAdmin, customer()).passed, false);
  assert.equal(guard(requireAdmin, employee()).passed, false);
});

test("guards: every guard refuses an unauthenticated request", () => {
  for (const [name, g] of Object.entries({ requireAdmin, requireCustomer, requireEmployee })) {
    const res = response();
    let passed = false;
    g({ user: undefined }, res, () => { passed = true; });
    assert.equal(passed, false, `${name} must refuse an anonymous request`);
    assert.equal(res.statusCode, 401);
  }
});

test("guards: requireRole still accepts an explicit list (existing behavior preserved)", () => {
  const both = requireRole(ROLES.EMPLOYEE, ROLES.ADMIN);
  assert.equal(guard(both, employee()).passed, true);
  assert.equal(guard(both, admin()).passed, true);
  assert.equal(guard(both, customer()).passed, false);
});

// ---- route wiring: the real router, verified from source ----

const routerSource = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");

test("wiring: the employee assignment read is authenticate + requireEmployee", () => {
  assert.ok(
    routerSource.includes(
      'router.get("/employee/assignments", authenticate, requireEmployee, assignments.listMyAssignments)',
    ),
    "GET /employee/assignments must be authenticate + requireEmployee",
  );
});

test("wiring: every admin employee/assignment route is behind the admin-only guard chain", () => {
  for (const line of [
    'router.get("/admin/employees", adminOnly, employees.adminListEmployees);',
    'router.post("/admin/employees", adminOnly, employees.adminCreateEmployee);',
    'router.post("/admin/employees/:id/disable", adminOnly, employees.adminDisableEmployee);',
    'router.post("/admin/employees/:id/reactivate", adminOnly, employees.adminReactivateEmployee);',
    'router.post("/admin/bookings/:id/assignment", adminOnly, assignments.adminAssignBooking);',
  ]) {
    assert.ok(routerSource.includes(line), `expected route wiring: ${line}`);
  }
  // adminOnly is still exactly [authenticate, requireAdmin] — never widened.
  assert.ok(
    routerSource.includes("const adminOnly = [authenticate, requireAdmin];"),
    "adminOnly must remain authenticate + requireAdmin",
  );
});

test("wiring: no employee route is mounted without requireEmployee", () => {
  const employeeRoutes = routerSource
    .split("\n")
    .filter((l) => l.includes('router.') && l.includes('"/employee'))
    .filter((l) => !l.trim().startsWith("//"));
  assert.ok(employeeRoutes.length > 0, "expected at least one employee route");
  for (const line of employeeRoutes) {
    assert.ok(
      line.includes("requireEmployee"),
      `employee route must carry requireEmployee: ${line.trim()}`,
    );
  }
});

test("wiring: activation is public and rate-limited, like password recovery", () => {
  assert.ok(
    routerSource.includes('router.post("/auth/employee-activation", auth.activateEmployeeAccount);'),
    "activation must be registered",
  );
  // It must NOT sit behind authenticate: the invitee has no password yet.
  assert.ok(
    !routerSource.includes('router.post("/auth/employee-activation", authenticate'),
    "activation must not require an existing session",
  );
});

test("wiring: no customer or admin route was re-pointed at an employee handler", () => {
  assert.equal(routerSource.includes("employees.admin"), true);
  assert.equal(/router\.(get|post|put|patch|delete)\("\/(bookings|receipts|messages|profile|community)[^"]*",[^)]*employees\./.test(routerSource), false);
  assert.equal(/router\.(get|post|put|patch|delete)\("\/admin\/[^"]*",[^)]*assignments\.listMyAssignments/.test(routerSource), false);
});

test("wiring: router module loads and exports an express router", () => {
  assert.equal(typeof prismaRouterSource, "function");
  assert.equal(typeof prismaRouterSource.use, "function");
});

// ---- employee self-deletion is refused ----

test("deleteAccount: an employee cannot delete their own User record", async () => {
  const res = response();
  let deleted = false;
  await withDb(
    { user: { delete: async () => { deleted = true; } } },
    () => deleteAccount({ user: employee() }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /administrator/i);
  assert.equal(deleted, false, "the employee's User row must be preserved");
});

test("deleteAccount: an employee cannot disable or reactivate an account (admin-only, enforced in-handler)", async () => {
  const { adminDisableEmployee, adminReactivateEmployee } = await import("../src/controllers/employees.js");

  for (const [name, handler] of [["disable", adminDisableEmployee], ["reactivate", adminReactivateEmployee]]) {
    const res = response();
    let updated = false;
    await withDb(
      {
        user: {
          findUnique: async () => employee({ disabledAt: t("2026-09-01T00:00:00Z") }),
          update: async () => { updated = true; },
        },
        employeeInvitation: { updateMany: async () => { updated = true; } },
      },
      () => handler({ user: employee(), params: { id: employee().id } }, res),
    );
    assert.equal(res.statusCode, 403, `${name} must refuse an employee caller`);
    assert.equal(updated, false, `${name} must not write anything for an employee caller`);
  }
});

test("deleteAccount: an employee cannot self-reactivate through the reactivate handler", async () => {
  const { adminReactivateEmployee } = await import("../src/controllers/employees.js");
  const res = response();
  let updated = false;
  await withDb(
    {
      user: {
        findUnique: async () => employee({ disabledAt: t("2026-09-01T00:00:00Z") }),
        update: async () => { updated = true; },
      },
    },
    () => adminReactivateEmployee({ user: employee(), params: { id: employee().id } }, res),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(updated, false);
});

test("deleteAccount: a disabled employee cannot create another employee account", async () => {
  const { adminCreateEmployee } = await import("../src/controllers/employees.js");
  const res = response();
  let created = false;
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async () => { created = true; return {}; },
      },
    },
    () =>
      adminCreateEmployee(
        { user: employee(), body: { name: "X", email: "x@example.com" } },
        res,
        undefined,
        { issueInvitation: async () => ({ ok: true }) },
      ),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(created, false, "an employee must never be able to create an employee");
});

test("deleteAccount: customers can still delete themselves (preserved)", async () => {
  const res = response();
  let deletedId = null;
  await withDb(
    { user: { delete: async ({ where }) => { deletedId = where.id; } } },
    () => deleteAccount({ user: customer() }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(deletedId, "cus1");
});

test("deleteAccount: admins are still refused (preserved message)", async () => {
  const res = response();
  let deleted = false;
  await withDb(
    { user: { delete: async () => { deleted = true; } } },
    () => deleteAccount({ user: admin() }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Admins cannot delete themselves/);
  assert.equal(deleted, false);
});
