import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { COOKIE_NAME, LEAVE_KIND, LEAVE_REQUEST_STATUS_DEFAULT, ROLES } from "../src/config.js";
import { signToken } from "../src/utils/jwt.js";
import {
  adminApproveLeaveRequest,
  adminDeclineLeaveRequest,
  adminListLeaveRequests,
  createMyLeaveRequest,
  listMyLeaveRequests,
} from "../src/controllers/employeeLeave.js";
import { authenticate, requireAdmin, requireCustomer, requireEmployee } from "../src/middleware/auth.js";

// EMPLOYEE LEAVE REQUESTS.
//
// The three rules this file exists to protect, asserted directly rather than
// inferred from what happened to be created:
//   1. IDENTITY — an employee's leave is always their own. The owner is the session
//      (`req.user.id`), never a body field, and one employee can never see or file
//      against another's rows.
//   2. AUTHORIZATION — only an admin may list the queue or decide a request, the
//      decision records the AUTHENTICATED admin, and a disabled employee cannot use
//      the employee endpoints at all.
//   3. NO COMPETING SOURCE OF TRUTH — leave and availability stay separate, and
//      neither one creates or changes any work. A decision is a decision and nothing
//      else.

const t = (s) => new Date(s);

const response = () => ({
  cookies: {},
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
  clearCookie() { return this; },
});

// Swaps Prisma delegates for the duration of `fn`, then restores the originals.
// Closure-scoped storage and a `finally` restore, so a failing assertion still
// un-stubs and a stub can never leak into another test file.
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

const ADMIN = { id: "adm1", role: ROLES.ADMIN, name: "Ada Admin" };
const OTHER_ADMIN = { id: "adm2", role: ROLES.ADMIN, name: "Bo Admin" };
const EMPLOYEE = { id: "emp1", role: ROLES.EMPLOYEE };
const OTHER_EMPLOYEE = { id: "emp2", role: ROLES.EMPLOYEE };
const CUSTOMER = { id: "cus1", role: ROLES.CUSTOMER };

const leaveRow = (over = {}) => ({
  id: "lv1",
  employeeId: "emp1",
  startsOn: "2026-10-05",
  endsOn: "2026-10-07",
  kind: "vacation",
  note: "Family trip",
  status: LEAVE_REQUEST_STATUS_DEFAULT,
  decidedAt: null,
  decidedById: null,
  createdAt: t("2026-10-01T00:00:00Z"),
  updatedAt: t("2026-10-01T00:00:00Z"),
  employee: { id: "emp1", name: "Employee One" },
  decidedBy: null,
  ...over,
});

// Records every call so a test can assert WHICH rows a query touched, rather than
// only what came back.
function findManyRecorder(rows) {
  const calls = [];
  return {
    calls,
    findMany: async (args) => {
      calls.push(args);
      return rows;
    },
  };
}

// A findUnique stub that behaves like the real read-then-read-back pair a decision
// performs: the first read sees the row still pending, every read after the write
// sees the decision that was just recorded.
function statefulLeave(afterWrite) {
  let calls = 0;
  return async () => {
    calls += 1;
    return calls === 1 ? leaveRow() : leaveRow(afterWrite);
  };
}

const nextRes = () => ({ req: { params: {} }, res: response() });

// ---------------------------------------------------------------------------
// employee: create
// ---------------------------------------------------------------------------

test("leave: an employee can create a leave request for themselves", async () => {
  const created = [];
  const res = response();
  await withDb(
    {
      employeeLeaveRequest: {
        create: async (args) => {
          created.push(args);
          return leaveRow(args.data);
        },
      },
    },
    () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-05", endsOn: "2026-10-07", kind: "vacation", note: "Family trip" } }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.leave.startsOn, "2026-10-05");
  assert.equal(res.body.leave.endsOn, "2026-10-07");
  assert.equal(res.body.leave.status, LEAVE_REQUEST_STATUS_DEFAULT);
  assert.equal(res.body.leave.decidedAt, null, "a new request has no decision");
  // The employee's own view does not expose a deciding admin at all.
  assert.equal("decidedById" in res.body.leave, false);
  // The persisted owner is the session, never anything the client sent.
  assert.equal(created[0].data.employeeId, "emp1");
});

test("leave: an employeeId in the body cannot impersonate another employee", async () => {
  const created = [];
  const res = response();
  await withDb(
    {
      employeeLeaveRequest: {
        create: async (args) => {
          created.push(args);
          return leaveRow(args.data);
        },
      },
    },
    () =>
      // A deliberately hostile body: an id, and an id nested in another field.
      createMyLeaveRequest(
        {
          user: EMPLOYEE,
          body: {
            startsOn: "2026-10-05",
            endsOn: "2026-10-05",
            employeeId: "emp2",
            userId: "emp2",
            owner: { employeeId: "emp2" },
            decidedById: "emp2",
            status: "approved",
          },
        },
        res,
      ),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(created[0].data.employeeId, "emp1", "the owner must come from the session");
  assert.equal("decidedById" in created[0].data, false, "an employee may not set a deciding admin");
  // A client cannot pre-decide its own request into "approved" either.
  assert.equal(created[0].data.status, LEAVE_REQUEST_STATUS_DEFAULT);
  assert.equal("decidedAt" in created[0].data, false, "an employee may not set a decision time");
});

test("leave: kind is optional and stored as null when absent", async () => {
  const created = [];
  const res = response();
  await withDb(
    {
      employeeLeaveRequest: {
        create: async (args) => {
          created.push(args);
          return leaveRow({ ...args.data, kind: null, note: null });
        },
      },
    },
    () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-05", endsOn: "2026-10-05" } }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(created[0].data.kind, null);
  assert.equal(created[0].data.note, null);
  assert.equal(res.body.leave.kind, null);
});

test("leave: a one-day request (same start and end) is valid", async () => {
  const res = response();
  await withDb(
    { employeeLeaveRequest: { create: async (args) => leaveRow(args.data) } },
    () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-05", endsOn: "2026-10-05" } }, res),
  );
  assert.equal(res.statusCode, 201);
});

test("leave: an end date before the start date is rejected", async () => {
  const res = response();
  let created = false;
  await withDb(
    { employeeLeaveRequest: { create: async () => { created = true; } } },
    () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-07", endsOn: "2026-10-05" } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /end date cannot be before/i);
  assert.equal(created, false, "nothing may be written for an invalid range");
});

test("leave: malformed and impossible dates are rejected with a useful message", async () => {
  const cases = [
    [{ startsOn: "10/05/2026", endsOn: "2026-10-05" }, /start date/i],
    [{ startsOn: "2026-10-05", endsOn: "soon" }, /end date/i],
    [{ startsOn: "2026-02-30", endsOn: "2026-02-30" }, /start date/i],
    [{ startsOn: "2026-10-05" }, /end date is required/i],
    [{ endsOn: "2026-10-05" }, /start date is required/i],
    [{}, /start date is required/i],
  ];
  for (const [body, expected] of cases) {
    const res = response();
    await withDb(
      { employeeLeaveRequest: { create: async () => { throw new Error("must not be called"); } } },
      () => createMyLeaveRequest({ user: EMPLOYEE, body }, res),
    );
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.match(res.body.error, expected, `unexpected message for ${JSON.stringify(body)}`);
  }
});

test("leave: an unknown kind is rejected rather than stored", async () => {
  const res = response();
  let created = false;
  await withDb(
    { employeeLeaveRequest: { create: async () => { created = true; } } },
    () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-05", endsOn: "2026-10-05", kind: "because" } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /kind must be one of/i);
  assert.equal(created, false);
});

test("leave: a non-string kind is rejected, not coerced", async () => {
  const res = response();
  await withDb(
    { employeeLeaveRequest: { create: async () => { throw new Error("must not be called"); } } },
    () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-05", endsOn: "2026-10-05", kind: { $ne: null } } }, res),
  );
  assert.equal(res.statusCode, 400);
});

test("leave: an over-long note is rejected", async () => {
  const res = response();
  await withDb(
    { employeeLeaveRequest: { create: async () => { throw new Error("must not be called"); } } },
    () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-05", endsOn: "2026-10-05", note: "x".repeat(501) } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /note is too long/i);
});

test("leave: every documented kind is accepted", async () => {
  for (const kind of LEAVE_KIND) {
    const res = response();
    await withDb(
      { employeeLeaveRequest: { create: async (args) => leaveRow(args.data) } },
      () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-05", endsOn: "2026-10-05", kind } }, res),
    );
    assert.equal(res.statusCode, 201, `expected ${kind} to be accepted`);
  }
});

// ---------------------------------------------------------------------------
// employee: list
// ---------------------------------------------------------------------------

test("leave: an employee sees only their own requests, scoped in the query", async () => {
  const recorder = findManyRecorder([
    leaveRow(),
    leaveRow({ id: "lv2", employeeId: "emp1", status: "approved", startsOn: "2026-11-02", endsOn: "2026-11-02" }),
  ]);
  const res = response();
  await withDb({ employeeLeaveRequest: { findMany: recorder.findMany } }, () =>
    listMyLeaveRequests({ user: EMPLOYEE }, res),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.leave.length, 2);
  assert.equal(recorder.calls[0].where.employeeId, "emp1", "the scope must be the session employee");
  // The employee's own view carries no other employee's name and no admin identity.
  assert.equal(res.body.leave[0].employeeName, undefined);
  assert.equal(res.body.leave[0].decidedByName, undefined);
});

test("leave: one employee's request is never returned to another", async () => {
  // The stub returns ONLY emp2's row, standing in for a database that would never
  // return it. The assertion is that the response is empty and that the query was
  // scoped — i.e. the controller cannot emit another employee's row.
  const recorder = findManyRecorder([]);
  const res = response();
  await withDb({ employeeLeaveRequest: { findMany: recorder.findMany } }, () =>
    listMyLeaveRequests({ user: OTHER_EMPLOYEE }, res),
  );
  assert.deepEqual(res.body.leave, []);
  assert.equal(recorder.calls[0].where.employeeId, "emp2");
  assert.notEqual(recorder.calls[0].where.employeeId, "emp1");
});

test("leave: the employee's own view never leaks a decidedBy identity", async () => {
  const recorder = findManyRecorder([
    leaveRow({ status: "approved", decidedAt: t("2026-10-02T00:00:00Z"), decidedById: "adm1" }),
  ]);
  const res = response();
  await withDb({ employeeLeaveRequest: { findMany: recorder.findMany } }, () =>
    listMyLeaveRequests({ user: EMPLOYEE }, res),
  );
  const [row] = res.body.leave;
  assert.equal(row.decidedAt.toISOString(), "2026-10-02T00:00:00.000Z");
  assert.equal("decidedByName" in row, false, "the deciding admin's name is an admin-only field");
});

// ---------------------------------------------------------------------------
// admin: list
// ---------------------------------------------------------------------------

test("leave: an admin can list leave requests with employee and decision context", async () => {
  const recorder = findManyRecorder([
    leaveRow(),
    leaveRow({
      id: "lv2",
      status: "approved",
      decidedAt: t("2026-10-02T09:00:00Z"),
      decidedById: "adm1",
      decidedBy: { id: "adm1", name: "Ada Admin" },
    }),
  ]);
  const res = response();
  await withDb(
    {
      employeeLeaveRequest: {
        findMany: recorder.findMany,
        groupBy: async () => { throw new Error("an unfiltered list needs no second read"); },
      },
    },
    () => adminListLeaveRequests({ user: ADMIN, query: {} }, res),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.leave[0].employeeName, "Employee One");
  assert.equal(res.body.leave[1].decidedByName, "Ada Admin");
  assert.deepEqual(res.body.counts, { requested: 1, approved: 1, declined: 0 });
});

test("leave: the admin queue can be narrowed to one status", async () => {
  const recorder = findManyRecorder([leaveRow()]);
  let grouped = null;
  const res = response();
  await withDb(
    {
      employeeLeaveRequest: {
        findMany: recorder.findMany,
        groupBy: async (args) => {
          grouped = args;
          return [
            { status: "requested", _count: { _all: 2 } },
            { status: "approved", _count: { _all: 1 } },
            { status: "declined", _count: { _all: 0 } },
          ];
        },
      },
    },
    () => adminListLeaveRequests({ user: ADMIN, query: { status: "requested" } }, res),
  );
  assert.equal(recorder.calls[0].where.status, "requested");
  assert.equal(res.body.filter, "requested");
  // The counts describe the WHOLE queue, not the one status on screen: an admin who
  // filters to "requested" must still see how many are already decided.
  assert.deepEqual(res.body.counts, { requested: 2, approved: 1, declined: 0 });
  assert.deepEqual(grouped.by, ["status"]);
  assert.equal(grouped.where, undefined, "the aggregate must not repeat the filter");
  // The aggregate is also never scoped to one employee.
  assert.equal(/employeeId/.test(JSON.stringify(grouped)), false);
});

test("leave: the admin queue puts PENDING first, even when the database returns them last", async () => {
  // `status` is a plain string, so ordering by it sorts ALPHABETICALLY and would put
  // "requested" LAST — burying the queue the admin most needs to see. The rows here
  // come back in that adversarial order on purpose.
  const recorder = findManyRecorder([
    leaveRow({ id: "old", status: "approved", decidedAt: t("2026-09-01T00:00:00Z"), decidedById: "adm1" }),
    leaveRow({ id: "also-old", status: "declined", decidedAt: t("2026-08-01T00:00:00Z"), decidedById: "adm1" }),
    leaveRow({ id: "newest-pending" }),
    leaveRow({ id: "older-pending" }),
  ]);
  const res = response();
  await withDb({ employeeLeaveRequest: { findMany: recorder.findMany } }, () =>
    adminListLeaveRequests({ user: ADMIN, query: {} }, res),
  );

  const ids = res.body.leave.map((r) => r.id);
  assert.deepEqual(ids, ["newest-pending", "older-pending", "old", "also-old"], "pending first, then the database order");
  // Pending is never ordered by the status alphabet.
  assert.equal(ids.indexOf("newest-pending") < ids.indexOf("old"), true);
  // The query itself must not sort by status, which cannot express "pending first".
  const order = recorder.calls[0].orderBy ?? [];
  assert.equal(order.some((o) => "status" in o), false, "ordering by the status string is what caused the bug");
});

test("leave: an unknown status filter is refused rather than ignored", async () => {
  const res = response();
  let queried = false;
  await withDb(
    { employeeLeaveRequest: { findMany: async () => { queried = true; return []; } } },
    () => adminListLeaveRequests({ user: ADMIN, query: { status: "approvedd" } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /status must be one of/i);
  assert.equal(queried, false, "a typo must not silently widen the queue");
});

// ---------------------------------------------------------------------------
// admin: decide
// ---------------------------------------------------------------------------

test("leave: an admin can approve a requested leave, recording who and when", async () => {
  const updates = [];
  const res = response();
  const { req, res: r } = nextRes();
  req.user = ADMIN;
  req.params = { id: "lv1" };

  await withDb(
    {
      employeeLeaveRequest: {
        // The FIRST read sees it still pending; the read-back after the write sees
        // the decision, exactly as the database would.
        findUnique: statefulLeave({
          status: "approved",
          decidedAt: t("2026-10-02T00:00:00Z"),
          decidedById: "adm1",
          decidedBy: { id: "adm1", name: "Ada Admin" },
        }),
        updateMany: async (args) => {
          updates.push(args);
          return { count: 1 };
        },
      },
    },
    () => adminApproveLeaveRequest(req, r),
  );

  assert.equal(r.statusCode, 200);
  assert.equal(r.body.leave.status, "approved");
  assert.equal(r.body.leave.decidedById, "adm1", "the decision records the AUTHENTICATED admin");
  assert.ok(r.body.leave.decidedAt, "a decision records a time");

  // The write is conditional on the request still being undecided, so a second
  // decision cannot overwrite the first.
  assert.equal(updates[0].where.id, "lv1");
  assert.equal(updates[0].where.status, LEAVE_REQUEST_STATUS_DEFAULT);
  assert.equal(updates[0].data.status, "approved");
  assert.equal(updates[0].data.decidedById, "adm1");
  assert.equal(updates[0].data.decidedAt instanceof Date, true);
});

test("leave: an admin can decline a requested leave", async () => {
  const { req, res } = nextRes();
  req.user = ADMIN;
  req.params = { id: "lv1" };
  const updates = [];

  await withDb(
    {
      employeeLeaveRequest: {
        findUnique: statefulLeave({ status: "declined", decidedById: "adm1", decidedBy: { id: "adm1", name: "Ada Admin" } }),
        updateMany: async (args) => {
          updates.push(args);
          return { count: 1 };
        },
      },
    },
    () => adminDeclineLeaveRequest(req, res),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.leave.status, "declined");
  assert.equal(updates[0].data.status, "declined");
  assert.equal(updates[0].data.decidedById, "adm1");
});

test("leave: the deciding admin is the session, never a body field", async () => {
  const updates = [];
  const { req, res } = nextRes();
  req.user = OTHER_ADMIN;
  req.params = { id: "lv1" };
  // A body claiming a different admin, exactly as a hostile client might send.
  req.body = { decidedById: "adm1", status: "approved" };

  await withDb(
    {
      employeeLeaveRequest: {
        findUnique: statefulLeave({ decidedById: "adm2" }),
        updateMany: async (args) => {
          updates.push(args);
          return { count: 1 };
        },
      },
    },
    () => adminApproveLeaveRequest(req, res),
  );

  assert.equal(updates[0].data.decidedById, "adm2", "the decision must record the signed-in admin");
  assert.notEqual(updates[0].data.decidedById, "adm1");
});

test("leave: an already-decided request cannot be decided again", async () => {
  for (const settled of ["approved", "declined"]) {
    const { req, res } = nextRes();
    req.user = ADMIN;
    req.params = { id: "lv1" };
    let wrote = false;

    await withDb(
      {
        employeeLeaveRequest: {
          findUnique: async () => leaveRow({ status: settled, decidedAt: t("2026-10-02T00:00:00Z"), decidedById: "adm1" }),
          updateMany: async () => {
            wrote = true;
            return { count: 1 };
          },
        },
      },
      () => adminApproveLeaveRequest(req, res),
    );

    assert.equal(res.statusCode, 400, `a ${settled} request must not be re-decided`);
    assert.match(res.body.error, new RegExp(`already ${settled}`, "i"));
    assert.equal(wrote, false, "no write may touch a settled request");
  }
});

test("leave: losing a concurrent decision race is reported, not silently won", async () => {
  const { req, res } = nextRes();
  req.user = ADMIN;
  req.params = { id: "lv1" };

  await withDb(
    {
      employeeLeaveRequest: {
        // Still pending on read, but another admin wins before our write lands.
        findUnique: async () => leaveRow(),
        updateMany: async () => ({ count: 0 }),
      },
    },
    () => adminApproveLeaveRequest(req, res),
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /already decided/i);
});

test("leave: deciding an unknown request is a 404", async () => {
  for (const handler of [adminApproveLeaveRequest, adminDeclineLeaveRequest]) {
    const { req, res } = nextRes();
    req.user = ADMIN;
    req.params = { id: "nope" };
    let wrote = false;

    await withDb(
      {
        employeeLeaveRequest: {
          findUnique: async () => null,
          updateMany: async () => {
            wrote = true;
            return { count: 1 };
          },
        },
      },
      () => handler(req, res),
    );

    assert.equal(res.statusCode, 404);
    assert.equal(wrote, false);
  }
});

// ---------------------------------------------------------------------------
// authorization
// ---------------------------------------------------------------------------

test("leave: an employee can neither list nor decide the admin queue", async () => {
  for (const actor of [EMPLOYEE, OTHER_EMPLOYEE, CUSTOMER, { id: "x", role: "manager" }]) {
    for (const handler of [adminListLeaveRequests, adminApproveLeaveRequest, adminDeclineLeaveRequest]) {
      const { req, res } = nextRes();
      req.user = actor;
      req.params = { id: "lv1" };
      let touched = false;

      await withDb(
        {
          employeeLeaveRequest: {
            findMany: async () => { touched = true; return []; },
            findUnique: async () => { touched = true; return leaveRow(); },
            updateMany: async () => { touched = true; return { count: 1 }; },
          },
        },
        () => handler(req, res),
      );

      assert.equal(res.statusCode, 403, `${actor.role} must be refused by ${handler.name}`);
      assert.equal(touched, false, `${handler.name} must not query or write for ${actor.role}`);
    }
  }
});

test("leave: a request with no authenticated user is refused", async () => {
  const { req, res } = nextRes();
  req.user = undefined;
  req.params = { id: "lv1" };
  await withDb({ employeeLeaveRequest: { updateMany: async () => ({ count: 1 }) } }, () =>
    adminApproveLeaveRequest(req, res),
  );
  assert.equal(res.statusCode, 403);
});

test("leave: requireEmployee refuses a customer and an unauthenticated request", async () => {
  const customer = response();
  await requireEmployee({ user: CUSTOMER }, customer, () => {});
  assert.equal(customer.statusCode, 403);

  const anonymous = response();
  await requireEmployee({ user: undefined }, anonymous, () => {});
  assert.equal(anonymous.statusCode, 401);
});

test("leave: requireAdmin refuses an employee", async () => {
  const res = response();
  await requireAdmin({ user: EMPLOYEE }, res, () => {});
  assert.equal(res.statusCode, 403);
});

test("leave: a DISABLED employee is rejected by authenticate before any role check", async () => {
  // The REAL middleware, with a genuinely signed session cookie and a disabled user
  // read straight from the database — the same path the pre-existing disable feature
  // already relies on. Nothing about the leave feature may weaken it.
  const res = response();
  let reached = false;
  await withDb(
    {
      user: {
        findUnique: async () => ({ id: "emp1", role: ROLES.EMPLOYEE, disabledAt: t("2026-10-01T00:00:00Z") }),
        update: async () => { throw new Error("the presence heartbeat must not run for a disabled account"); },
      },
    },
    () => authenticate({ cookies: { [COOKIE_NAME]: signToken({ id: "emp1" }) }, headers: {} }, res, () => { reached = true; }),
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Account is disabled");
  assert.equal(reached, false, "a disabled employee never reaches requireEmployee or a handler");
});

test("leave: an enabled employee passes authenticate and then requireEmployee", async () => {
  const res = response();
  let reached = false;
  const req = { cookies: { [COOKIE_NAME]: signToken({ id: "emp1" }) }, headers: {} };
  await withDb(
    {
      user: {
        findUnique: async () => ({ id: "emp1", role: ROLES.EMPLOYEE, disabledAt: null, lastActiveAt: new Date() }),
        // The presence heartbeat fires in the background; stubbed so the test never
        // touches a database.
        update: async () => ({}),
      },
    },
    () => authenticate(req, res, () => { reached = true; }),
  );

  assert.equal(res.statusCode, null, "authenticate hands off to the next middleware");
  assert.equal(reached, true);
  assert.equal(req.user.role, ROLES.EMPLOYEE, "the loaded user is what the role check reads");

  // And the role gate that /employee/leave is mounted behind accepts that user.
  const roleRes = response();
  let through = false;
  await requireEmployee(req, roleRes, () => { through = true; });
  assert.equal(through, true);
});

// ---------------------------------------------------------------------------
// leave vs availability, and leave vs work
// ---------------------------------------------------------------------------

test("leave: neither the employee nor the admin path writes availability or work", async () => {
  const calls = [];
  const record = (name) => async (args) => {
    calls.push(`${name}:${JSON.stringify(args?.data ?? {})}`);
    return leaveRow(args?.data);
  };

  const employeeRes = response();
  await withDb(
    {
      employeeLeaveRequest: { create: record("leave.create") },
      employeeAvailability: { create: record("availability.create") },
      bookingAssignment: { create: record("assignment.create"), upsert: record("assignment.upsert"), update: record("assignment.update"), delete: record("assignment.delete") },
      shiftOffer: { updateMany: record("shift.updateMany"), update: record("shift.update") },
    },
    () => createMyLeaveRequest({ user: EMPLOYEE, body: { startsOn: "2026-10-05", endsOn: "2026-10-05" } }, employeeRes),
  );
  assert.equal(employeeRes.statusCode, 201);

  const adminRes = response();
  const { req, res } = nextRes();
  req.user = ADMIN;
  req.params = { id: "lv1" };
  await withDb(
    {
      employeeLeaveRequest: {
        findUnique: statefulLeave({ status: "approved", decidedById: "adm1" }),
        // updateMany reports a COUNT, which is what the race guard checks.
        updateMany: async (args) => {
          calls.push(`leave.updateMany:${JSON.stringify(args?.data ?? {})}`);
          return { count: 1 };
        },
      },
      employeeAvailability: { create: record("availability.create"), updateMany: record("availability.updateMany") },
      bookingAssignment: { create: record("assignment.create"), upsert: record("assignment.upsert"), update: record("assignment.update"), delete: record("assignment.delete") },
      shiftOffer: { updateMany: record("shift.updateMany"), update: record("shift.update") },
    },
    () => adminApproveLeaveRequest(req, res),
  );
  assert.equal(adminRes.statusCode, null);
  assert.equal(res.statusCode, 200);

  const availabilityCalls = calls.filter((c) => c.startsWith("availability."));
  const assignmentCalls = calls.filter((c) => c.startsWith("assignment."));
  const shiftCalls = calls.filter((c) => c.startsWith("shift."));
  assert.deepEqual(availabilityCalls, [], "leave must never write an availability preference");
  assert.deepEqual(assignmentCalls, [], "leave must never create, change or remove work");
  assert.deepEqual(shiftCalls, [], "leave must never touch a shift offer");
});

test("leave: a decision never returns a raw token, hash, or another employee's private data", async () => {
  const { req, res } = nextRes();
  req.user = ADMIN;
  req.params = { id: "lv1" };

  await withDb(
    {
      employeeLeaveRequest: {
        findUnique: async () => leaveRow(),
        updateMany: async () => ({ count: 1 }),
      },
    },
    () => adminApproveLeaveRequest(req, res),
  );

  const body = JSON.stringify(res.body);
  assert.equal(/passwordHash|tokenHash|invitation/i.test(body), false);
  // The admin queue carries the employee's NAME only — never contact details.
  const recorder = findManyRecorder([leaveRow()]);
  const listRes = response();
  await withDb({ employeeLeaveRequest: { findMany: recorder.findMany } }, () =>
    adminListLeaveRequests({ user: ADMIN, query: {} }, listRes),
  );
  const listBody = JSON.stringify(listRes.body);
  assert.equal(/"email"|"phone"|"address"/.test(listBody), false, "no customer/employee contact data in the queue");
});
