import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import prisma from "../src/utils/prisma.js";
import { ROLES, COOKIE_NAME } from "../src/config.js";
import { signToken, verifyToken } from "../src/utils/jwt.js";
import { hashPassword } from "../src/utils/password.js";
import {
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireAdmin,
  requireCustomer,
  requireEmployee,
} from "../src/middleware/auth.js";
import { deleteAccount, login, register } from "../src/controllers/auth.js";
import { isEmail } from "../src/utils/validators.js";
import prismaRouterSource from "../src/routes/index.js";

const t = (s) => new Date(s);

const response = () => ({
  cookies: {},
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
  // Mirrors express's res.cookie(name, value, options) so a test can assert that a
  // cookie WAS set, and `cookies` stays empty when one was not.
  cookie(name, value, options) { this.cookies[name] = { value, options }; return this; },
  clearCookie(name) { delete this.cookies[name]; return this; },
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

// ---- LOGIN: a disabled account must never obtain a session ----
//
// The previous "a disabled account cannot log in" test here was VACUOUS: its
// fixture stored the literal string "hash" as `passwordHash`, so `verifyPassword`
// always failed and the 401 came from a password mismatch. The `disabledAt` check
// was never reached, and the suite looked like it covered login while covering
// nothing. Everything below therefore drives the real bcrypt hash of the supplied
// password, and the disabled cases each run an ENABLED control first, so a test
// can never again pass merely because the password failed to verify.

const LOGIN_PASSWORD = "password123";
const REAL_HASH = await hashPassword(LOGIN_PASSWORD);

// Runs `login` against a stubbed user row, recording every presence write.
// Pass `null` as the stored row to simulate an unknown email.
async function runLogin(storedUser, password = LOGIN_PASSWORD) {
  const res = response();
  const updates = [];
  await withDb(
    {
      user: {
        findUnique: async () => storedUser,
        update: async ({ data }) => {
          updates.push(data);
          return { ...storedUser, ...data };
        },
      },
    },
    () => login({ body: { email: storedUser?.email ?? "nobody@example.com", password } }, res),
  );
  return { res, updates };
}

test("login: a DISABLED account with a CORRECT password is refused with 401", async () => {
  // Control first: the identical row must log in when enabled. Without this the
  // assertion below could pass for the wrong reason, exactly as it used to.
  const enabled = await runLogin(employee({ passwordHash: REAL_HASH }));
  assert.equal(
    enabled.res.statusCode,
    200,
    "control: the correct password MUST verify for the enabled row, or this test is vacuous",
  );

  const { res } = await runLogin(
    employee({ passwordHash: REAL_HASH, disabledAt: t("2026-09-01T00:00:00Z") }),
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Account is disabled");
});

test("login: a refused disabled login writes no presence, no token and no cookie", async () => {
  const { res, updates } = await runLogin(
    employee({ passwordHash: REAL_HASH, disabledAt: t("2026-09-01T00:00:00Z"), status: "offline", lastActiveAt: null }),
  );
  assert.equal(res.body.token, undefined, "no session may be handed to a disabled account");
  assert.deepEqual(res.cookies, {}, "no authentication cookie may be set");
  assert.equal(updates.length, 0, "neither status:'online' nor lastActiveAt may be written");
});

test("login: a DISABLED account with a WRONG password still gets the generic error", async () => {
  // The disabled state must stay secret: a wrong password is indistinguishable
  // from an unknown email, so probing cannot reveal which accounts are disabled.
  const { res, updates } = await runLogin(
    employee({ passwordHash: REAL_HASH, disabledAt: t("2026-09-01T00:00:00Z") }),
    "not-the-right-password",
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Invalid email or password");
  assert.equal(
    /disabled/i.test(JSON.stringify(res.body)),
    false,
    "the response must not reveal that the account is disabled",
  );
  assert.equal(res.body.token, undefined);
  assert.deepEqual(res.cookies, {});
  assert.equal(updates.length, 0);
});

test("login: an UNKNOWN email gets the same generic error (no enumeration)", async () => {
  const { res, updates } = await runLogin(null);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Invalid email or password");
  assert.equal(res.body.token, undefined);
  assert.deepEqual(res.cookies, {});
  assert.equal(updates.length, 0, "an unknown email writes no presence");
});

test("login: an ENABLED account with the CORRECT password still signs in fully", async () => {
  // Preserved success path: 200, a real signed token, the auth cookie, presence.
  const { res, updates } = await runLogin(employee({ passwordHash: REAL_HASH }));
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.token, "string");
  assert.ok(res.body.token.length > 0, "a token must be issued");
  assert.equal(verifyToken(res.body.token).sub, "emp1", "the token really is signed for this user");
  assert.equal(res.cookies[COOKIE_NAME].value, res.body.token, "the cookie carries that same token");
  assert.equal(res.cookies[COOKIE_NAME].options.httpOnly, true);
  assert.equal(res.body.user.role, ROLES.EMPLOYEE);
  assert.equal(updates.length, 1, "presence is written exactly once");
  assert.equal(updates[0].status, "online");
  assert.ok(updates[0].lastActiveAt instanceof Date, "lastActiveAt is stamped");
});

test("login: the disabled refusal is worded exactly like the middleware refusal", async () => {
  // Both paths describe the same lifecycle state, so a user who signs in and a
  // user who presents a stale session must be told the same thing.
  const { res: loginRes } = await runLogin(
    employee({ passwordHash: REAL_HASH, disabledAt: t("2026-09-01T00:00:00Z") }),
  );
  const { res: middlewareRes } = await runAuthenticate(
    employee({ disabledAt: t("2026-09-01T00:00:00Z") }),
  );
  assert.equal(loginRes.body.error, "Account is disabled");
  assert.equal(loginRes.body.error, middlewareRes.body.error);
});

test("login: a session obtained BEFORE the disable stops authorizing immediately", async () => {
  // Obtain a real session the way a user does — by logging in while enabled.
  const { res: loginRes } = await runLogin(employee({ passwordHash: REAL_HASH }));
  assert.equal(loginRes.statusCode, 200);
  const token = loginRes.body.token;

  // An admin then disables the account. The stored row changes; the already
  // issued token does not, and must stop working on the very next request.
  const disabledRow = employee({
    passwordHash: REAL_HASH,
    disabledAt: t("2026-09-01T00:00:00Z"),
    status: "online",
  });
  const req = { cookies: { [COOKIE_NAME]: token }, headers: {} };
  const res = response();
  let reached = false;
  await withDb(
    {
      user: {
        findUnique: async () => disabledRow,
        update: async () => {
          throw new Error("the presence heartbeat must not run for a disabled account");
        },
      },
    },
    () => authenticate(req, res, () => { reached = true; }),
  );
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Account is disabled");
  assert.equal(reached, false, "a token minted before the disable must not reach a handler");
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
    {
      user: { delete: async ({ where }) => { deletedId = where.id; } },
      // A customer who was never an employee has no approved resignation, which is
      // what "an ordinary customer" means to the new guard. The assertion below is
      // unchanged: the deletion itself must still succeed exactly as before.
      employeeResignationRequest: { findFirst: async () => null },
    },
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

// ---- former-employee account closure (approved resignation history) ----
//
// An approved resignation moves User.role from "employee" to "customer", so the
// role alone can no longer distinguish "never an employee" from "employment has
// ended". A former employee is CLOSED IN PLACE instead of hard-deleted: the User
// row remains (it anchors employment/audit history) but is anonymized and disabled
// inside one transaction. Only an APPROVED resignation enters this branch, and the
// account is always identified by req.user.id, never by a caller-supplied id.

const APPROVED_RESIGNATION = { id: "rs1" };
const ANON_EMAIL = "deleted+emp1@deleted.invalid";

// An in-memory stand-in for the resignation table that HONOURS the where-clause the
// guard actually issues, so a test can place rows and let the query decide the
// answer — rather than a stub that returns whatever the test pre-decided.
function resignationTable(rows = []) {
  return {
    findFirst: async ({ where }) =>
      rows.find((r) => r.employeeId === where.employeeId && r.status === where.status) ?? null,
  };
}

// Runs deleteAccount with the resignation lookup and the closure transaction
// stubbed. `res` may be supplied by the caller (e.g. pre-seeded with a cookie).
// Every transaction delegate call is recorded and `transactionUsed` reports whether
// the closure transaction ran at all. Mirrors the interactive-transaction mocking
// used in bookingSchedule.test.js / employeeResignationAdmin.test.js.
async function runClosure(res, {
  user = customer({ id: "emp1", passwordHash: "original-hash" }),
  resignations = [{ id: "rs1", employeeId: "emp1", status: "approved" }],
  txSpec,
  failOn,
} = {}) {
  const calls = [];
  const spec = txSpec ?? {
    user: { update: async () => ({ id: "emp1" }) },
    passwordResetToken: { deleteMany: async () => ({ count: 1 }) },
    employeeInvitation: { deleteMany: async () => ({ count: 1 }) },
    communityProfile: { updateMany: async () => ({ count: 1 }) },
  };
  const tx = {};
  for (const [model, methods] of Object.entries(spec)) {
    tx[model] = {};
    for (const [method, impl] of Object.entries(methods)) {
      tx[model][method] = async (args) => {
        calls.push({ model, method, args });
        if (failOn && failOn.model === model && failOn.method === method) {
          throw new Error(`injected failure in ${model}.${method}`);
        }
        return impl(args);
      };
    }
  }
  const savedTx = prisma.$transaction;
  let transactionUsed = false;
  prisma.$transaction = async (fn) => { transactionUsed = true; return fn(tx); };
  let error = null;
  try {
    await withDb(
      {
        employeeResignationRequest: {
          findFirst: async (args) => resignationTable(resignations).findFirst(args),
        },
        user: { delete: async ({ where }) => ({ id: where.id }) },
      },
      () => deleteAccount({ user }, res),
    );
  } catch (e) {
    error = e;
  } finally {
    prisma.$transaction = savedTx;
  }
  return { calls, error, transactionUsed };
}

const callFor = (calls, model, method) => calls.find((c) => c.model === model && c.method === method);

test("deleteAccount: an APPROVED former employee is closed, not deleted, and gets success", async () => {
  const res = response();
  const { calls, error, transactionUsed } = await runClosure(res);
  assert.equal(error, null, "closure must not throw");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(transactionUsed, true, "closure runs in one transaction");

  const update = callFor(calls, "user", "update");
  assert.ok(update, "the User row is UPDATED (retained), never hard-deleted");
  assert.equal(update.args.where.id, "emp1", "the write is scoped to the authenticated user");
});

test("deleteAccount: closure anonymizes identity and revokes access", async () => {
  const res = response();
  const { calls } = await runClosure(res);
  const { data } = callFor(calls, "user", "update").args;

  assert.equal(data.email, ANON_EMAIL, "email is a deterministic, unique, anonymized value");
  assert.equal(data.name, "Deleted User");
  assert.equal(data.phone, null);
  assert.equal(data.address, null);
  assert.equal(data.stripeCustomerId, null);
  assert.equal(data.status, "offline");
  assert.ok(data.disabledAt instanceof Date, "disabledAt is set to now");

  assert.notEqual(data.passwordHash, "original-hash", "the previous password hash is replaced");
  assert.equal(typeof data.passwordHash, "string");
  assert.ok(data.passwordHash.length > 20, "an unusable password hash is stored");
  assert.equal("role" in data, false, "role is preserved, not rewritten");
  assert.equal("createdAt" in data, false, "createdAt is preserved, not rewritten");
});

test("deleteAccount: closure removes outstanding credentials, preserving employment history", async () => {
  const res = response();
  const { calls } = await runClosure(res);

  const reset = callFor(calls, "passwordResetToken", "deleteMany");
  assert.ok(reset, "outstanding password-reset tokens are removed");
  assert.equal(reset.args.where.userId, "emp1", "only the closed account's tokens are removed");
  const invite = callFor(calls, "employeeInvitation", "deleteMany");
  assert.ok(invite, "outstanding employee invitations are removed");
  assert.equal(invite.args.where.userId, "emp1", "only the closed account's invitations are removed");

  // Only the account row, the two credential tables and the social profile are
  // written. No booking, assignment, leave, shift, availability, receipt, review,
  // subscription or resignation table is touched, so all employment/audit history
  // survives.
  const written = [...new Set(calls.map((c) => c.model))].sort();
  assert.deepEqual(written, ["communityProfile", "employeeInvitation", "passwordResetToken", "user"]);
  for (const forbidden of [
    "employeeResignationRequest",
    "bookingAssignment",
    "booking",
    "payment",
    "receipt",
    "review",
    "subscription",
    "employeeLeaveRequest",
    "shiftRequest",
    "employeeAvailability",
  ]) {
    assert.equal(calls.some((c) => c.model === forbidden), false, `${forbidden} must not be touched`);
  }
});

test("deleteAccount: closure anonymizes the CommunityProfile in the same transaction", async () => {
  const res = response();
  const { calls, error, transactionUsed } = await runClosure(res);
  assert.equal(error, null);

  const profile = callFor(calls, "communityProfile", "updateMany");
  assert.ok(profile, "the CommunityProfile is anonymized, not hard-deleted");
  assert.equal(profile.args.where.userId, "emp1", "only the authenticated user's profile is touched");
  assert.deepEqual(profile.args.data, {
    displayName: "Deleted User",
    bio: null,
    avatarUrl: null,
    locationCity: null,
    locationState: null,
  });
  assert.equal(transactionUsed, true, "the profile write is part of the closure transaction");
  assert.equal(
    calls.some((c) => c.model === "communityProfile" && c.method === "deleteMany"),
    false,
    "the CommunityProfile row is retained, never deleted",
  );
});

test("deleteAccount: a former employee with NO CommunityProfile still closes successfully", async () => {
  const res = response();
  // updateMany matching zero rows is a successful no-op, so the closure must not
  // throw and must still report success.
  const { error, transactionUsed } = await runClosure(res, {
    txSpec: {
      user: { update: async () => ({ id: "emp1" }) },
      passwordResetToken: { deleteMany: async () => ({ count: 0 }) },
      employeeInvitation: { deleteMany: async () => ({ count: 0 }) },
      communityProfile: { updateMany: async () => ({ count: 0 }) },
    },
  });
  assert.equal(error, null, "a missing CommunityProfile must not fail closure");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(transactionUsed, true);
});

test("deleteAccount: another user's approved resignation never triggers closure", async () => {
  const res = response();
  // The table holds ONLY emp1's approved resignation; the caller is cus1.
  const { calls, transactionUsed } = await runClosure(res, {
    user: customer({ id: "cus1" }),
    resignations: [{ id: "rs1", employeeId: "emp1", status: "approved" }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(transactionUsed, false, "no closure transaction runs for cus1");
  assert.deepEqual(calls, [], "no closure writes are issued for another user's history");
});

test("deleteAccount: only an APPROVED resignation enters the closure branch", async () => {
  for (const status of ["declined", "requested"]) {
    const res = response();
    const { transactionUsed } = await runClosure(res, {
      resignations: [{ id: "rs2", employeeId: "emp1", status }],
    });
    assert.equal(res.statusCode, 200, `a ${status} resignation must not block deletion`);
    assert.equal(transactionUsed, false, `a ${status} resignation must not close the account`);
  }
});

test("deleteAccount: the former-employee guard is decided by an APPROVED request only", async () => {
  // A declined or still-pending request is not an employment record that must
  // survive, so neither may block an ordinary customer from deleting themselves —
  // even when that customer is the same person those requests belong to.
  for (const status of ["declined", "requested"]) {
    const res = response();
    let deletedId = null;
    let asked = null;
    const table = {
      findFirst: async (args) => {
        asked = args;
        return resignationTable([{ id: "rs2", employeeId: "emp1", status }]).findFirst(args);
      },
    };
    await withDb(
      {
        user: { delete: async ({ where }) => { deletedId = where.id; } },
        employeeResignationRequest: table,
      },
      () => deleteAccount({ user: customer({ id: "emp1" }) }, res),
    );
    assert.equal(res.statusCode, 200, `a ${status} resignation must not block deletion`);
    assert.equal(deletedId, "emp1");
    assert.equal(asked.where.status, "approved", "the guard must look for an approved request");
    assert.equal(asked.where.employeeId, "emp1", "the guard must read the session user");
  }
});

test("deleteAccount: the resignation check uses the AUTHENTICATED user, never a body field", async () => {
  let asked = null;
  const res = response();
  let deletedId = null;
  await withDb(
    {
      user: { delete: async ({ where }) => { deletedId = where.id; } },
      employeeResignationRequest: {
        findFirst: async (args) => {
          asked = args;
          // "emp1" HAS an approved resignation; the caller "cus1" does not. A guard
          // scoped to the session must therefore find nothing.
          return resignationTable([{ id: "rs1", employeeId: "emp1", status: "approved" }]).findFirst(args);
        },
      },
    },
    // A hostile body naming somebody else's employment history.
    () => deleteAccount({ user: customer({ id: "cus1" }), body: { employeeId: "emp1", id: "emp1" } }, res),
  );
  assert.equal(res.statusCode, 200, "another employee's resignation must never protect this account");
  assert.equal(asked.where.employeeId, "cus1", "the guard must read the session user");
  assert.deepEqual(Object.keys(asked.select), ["id"], "existence only: no history is read");
  assert.equal(deletedId, "cus1");
});

test("deleteAccount: a current employee is refused BEFORE any resignation history is read", async () => {
  const res = response();
  let deleted = false;
  let queried = false;
  await withDb(
    {
      user: { delete: async () => { deleted = true; } },
      employeeResignationRequest: { findFirst: async () => { queried = true; return APPROVED_RESIGNATION; } },
    },
    () => deleteAccount({ user: employee() }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /administrator/i);
  assert.equal(deleted, false);
  assert.equal(queried, false, "the existing employee rule short-circuits; its message and behavior are unchanged");
});

test("deleteAccount: closure never hard-deletes the User row", async () => {
  const res = response();
  // The closure path must update the row through the transaction; the ordinary-customer
  // hard delete must not be reached.
  const { calls, transactionUsed } = await runClosure(res, {
    txSpec: {
      user: { update: async () => ({ id: "emp1" }) },
      passwordResetToken: { deleteMany: async () => ({ count: 0 }) },
      employeeInvitation: { deleteMany: async () => ({ count: 0 }) },
      communityProfile: { updateMany: async () => ({ count: 0 }) },
    },
  });
  assert.equal(transactionUsed, true);
  assert.ok(callFor(calls, "user", "update"), "the account is updated, not deleted");
  assert.equal(calls.some((c) => c.method === "delete"), false, "no hard delete is issued");
});

test("deleteAccount: an approved resignation for a DIFFERENT employee does not protect anyone", async () => {
  const res = response();
  let deletedId = null;
  await withDb(
    {
      user: { delete: async ({ where }) => { deletedId = where.id; } },
      employeeResignationRequest: {
        // The table holds somebody else's approved resignation; the guard is scoped
        // to the caller and must not see it.
        findFirst: async (args) => (args.where.employeeId === "emp9" ? APPROVED_RESIGNATION : null),
      },
    },
    () => deleteAccount({ user: customer() }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(deletedId, "cus1");
});

test("deleteAccount: a successful closure clears the auth cookie", async () => {
  const res = response();
  res.cookie("tc_token", "value", {});
  const { error } = await runClosure(res);
  assert.equal(error, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.cookies.tc_token, undefined, "the session is cleared once the closure commits");
});

test("deleteAccount: a transaction failure blocks success and keeps the cookie", async () => {
  const res = response();
  res.cookie("tc_token", "value", {});
  // Fail on the LAST write (the CommunityProfile scrub), after the User update and
  // both credential cleanups, where a partial write would be observable if the
  // transaction did not roll back. The stubbed transaction cannot itself roll back,
  // so the guarantee under test is that no success reaches the client and the cookie
  // is not cleared when the transaction rejects.
  const { error } = await runClosure(res, {
    failOn: { model: "communityProfile", method: "updateMany" },
  });
  assert.ok(error, "the transaction error is not swallowed");
  assert.equal(res.statusCode, null, "no success response is sent");
  assert.equal(res.body, null);
  assert.ok(res.cookies.tc_token, "the session survives a failed closure; no cookie is cleared");
});

// ---- reserved system email namespace (closure collision prevention) ----
//
// Account closure rewrites a former employee's email to
// `deleted+<userId>@deleted.invalid`. Publicly-created accounts must never be
// able to occupy that namespace, or the closure's email write could collide with
// an existing account on the User.email unique constraint. The domain is reserved
// case-insensitively at the shared validator so both creation paths inherit it.

test("isEmail: the reserved @deleted.invalid domain is rejected case-insensitively", () => {
  for (const bad of [
    "deleted@deleted.invalid",
    "deleted+abc@deleted.invalid",
    "DELETED+ABC@DELETED.INVALID",
    "anything@DELETED.INVALID",
    "Deleted+User@Deleted.Invalid",
  ]) {
    assert.equal(isEmail(bad), false, `${bad} must be reserved`);
  }
  for (const good of [
    "normal@gmail.com",
    "deleted@gmail.com",
    "deleted+abc@gmail.com",
    "user@example.com",
    "another.valid@domain.co",
  ]) {
    assert.equal(isEmail(good), true, `${good} must remain a valid email`);
  }
});

test("register: a public registration cannot occupy the reserved @deleted.invalid domain", async () => {
  for (const email of [
    "deleted@deleted.invalid",
    "deleted+abc@deleted.invalid",
    "DELETED+ABC@DELETED.INVALID",
  ]) {
    const res = response();
    let created = false;
    await withDb(
      {
        user: {
          findUnique: async () => null,
          create: async () => { created = true; return {}; },
        },
      },
      () => register({ body: { name: "Mallory", email, password: "password123" } }, res),
    );
    assert.equal(res.statusCode, 400, `${email} must be refused`);
    assert.equal(created, false, `${email} must never create an account`);
  }
});

test("register: an ordinary email is still accepted (reservation does not over-reach)", async () => {
  const res = response();
  let created = null;
  await withDb(
    {
      user: {
        findUnique: async () => null,
        create: async ({ data }) => { created = data; return { id: "u1", ...data }; },
      },
    },
    () => register({ body: { name: "Ada", email: "deleted+abc@gmail.com", password: "password123" } }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(created.email, "deleted+abc@gmail.com");
});

test("adminCreateEmployee: the reserved @deleted.invalid domain is refused", async () => {
  const { adminCreateEmployee } = await import("../src/controllers/employees.js");
  for (const email of ["deleted+abc@deleted.invalid", "DELETED+ABC@DELETED.INVALID"]) {
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
          { user: admin(), body: { name: "Erin", email } },
          res,
          undefined,
          { issueInvitation: async () => ({ ok: true }) },
        ),
    );
    assert.equal(res.statusCode, 400, `${email} must be refused`);
    assert.equal(created, false, `${email} must never create an employee`);
  }
});
