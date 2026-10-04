import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { COOKIE_NAME, ROLES } from "../src/config.js";
import { RESIGNATION_REQUEST_STATUS, RESIGNATION_REQUEST_STATUS_DEFAULT } from "../src/config.js";
import { NOTE_MAX_LENGTH } from "../src/utils/validators.js";
import { signToken } from "../src/utils/jwt.js";
import { createMyResignationRequest } from "../src/controllers/employeeResignation.js";
import { authenticate, requireEmployee } from "../src/middleware/auth.js";

// EMPLOYEE RESIGNATION REQUESTS — submission.
//
// The rules this file protects, asserted directly rather than inferred from what
// happened to be created:
//   1. IDENTITY — the employee is always the session (`req.user.id`), never a body
//      field, so nobody can resign on another employee's behalf.
//   2. ONE OPEN REQUEST — enforced by the DATABASE partial unique index, surfaced
//      as a 409 by catching P2002. This file asserts the exact P2002 path because
//      the repository's tests stub Prisma rather than standing up a database; the
//      constraint itself is covered by employeeResignationSchema.test.js.
//   3. THE ONLY WAY IN IS "requested" — the handler does not write `status`, so the
//      schema default decides it and no caller can pre-decide a request.
//   4. NOTHING ELSE IS TOUCHED — no User, Booking, BookingAssignment, shift, leave
//      or availability write, and no decision fields.

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

// A create stub that records every call and returns a row shaped like the real
// one, so a test can assert WHICH data reached the write rather than only the
// response. `over` lets a test inject what the database would supply.
function recorder(rows = []) {
  const calls = [];
  return {
    calls,
    rows,
    create: async (args) => {
      calls.push(args);
      // The status is applied by the DATABASE default, which the stub emulates, so a
      // test that wrongly set `status` in the data would still see a decided row —
      // but the separate assertion on the call arguments is what actually catches it.
      const row = {
        id: "rs1",
        note: null,
        status: RESIGNATION_REQUEST_STATUS_DEFAULT,
        decidedAt: null,
        createdAt: t("2026-10-01T00:00:00Z"),
        ...args.data,
        ...(rows.shift() || {}),
      };
      return row;
    },
  };
}

const resignationRow = (over = {}) => ({
  id: "rs1",
  employeeId: "emp1",
  note: null,
  status: RESIGNATION_REQUEST_STATUS_DEFAULT,
  decidedAt: null,
  createdAt: t("2026-10-01T00:00:00Z"),
  ...over,
});

const EMPLOYEE = { id: "emp1", role: ROLES.EMPLOYEE };
const OTHER_EMPLOYEE = { id: "emp2", role: ROLES.EMPLOYEE };
const CUSTOMER = { id: "cus1", role: ROLES.CUSTOMER };
const ADMIN = { id: "adm1", role: ROLES.ADMIN };

// ---------------------------------------------------------------------------
// A / B / C / D — the happy path, identity, optional note, and status
// ---------------------------------------------------------------------------

test("resignation: an employee can submit a resignation request for themselves", async () => {
  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE, body: {} }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.resignation.employeeId, "emp1");
  assert.equal(res.body.resignation.status, RESIGNATION_REQUEST_STATUS_DEFAULT);
  assert.equal(res.body.resignation.decidedAt, null, "a new request has no decision");
  assert.equal(rec.calls.length, 1, "exactly one row is created");
  assert.equal(rec.calls[0].data.employeeId, "emp1", "the owner must come from the session");
});

test("resignation: a client-supplied employeeId can never impersonate another employee", async () => {
  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    // A deliberately hostile body: an id, and an id nested in another field.
    createMyResignationRequest(
      {
        user: EMPLOYEE,
        body: {
          note: "Moving on",
          employeeId: "emp2",
          userId: "emp2",
          owner: { employeeId: "emp2" },
          decidedById: "adm1",
          status: "approved",
          decidedAt: "2026-10-01T00:00:00Z",
        },
      },
      res,
    ),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(rec.calls[0].data.employeeId, "emp1", "the owner must come from the session");
  assert.equal("decidedById" in rec.calls[0].data, false, "an employee may not set a deciding admin");
  assert.equal("decidedAt" in rec.calls[0].data, false, "an employee may not set a decision time");
  // D: the client cannot pre-decide its own request, because the handler never
  // writes `status` at all — the schema default is what applies.
  assert.equal("status" in rec.calls[0].data, false, "status must come from the schema default, never the client");
  assert.equal(res.body.resignation.status, RESIGNATION_REQUEST_STATUS_DEFAULT);
});

test("resignation: the note is optional and stored as null when absent", async () => {
  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE, body: {} }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(rec.calls[0].data.note, null);
  assert.equal(res.body.resignation.note, null);
});

test("resignation: a supplied note is trimmed and persisted", async () => {
  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE, body: { note: "  Accepted another offer.  " } }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(rec.calls[0].data.note, "Accepted another offer.");
  assert.equal(res.body.resignation.note, "Accepted another offer.");
});

test("resignation: an empty or whitespace-only note is stored as null, not as blank text", async () => {
  for (const note of ["", "   "]) {
    const rec = recorder();
    const res = response();
    await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
      createMyResignationRequest({ user: EMPLOYEE, body: { note } }, res),
    );
    assert.equal(res.statusCode, 201);
    assert.equal(rec.calls[0].data.note, null);
  }
});

test("resignation: a note at the length bound is accepted and beyond it is rejected", async () => {
  const atBound = recorder();
  const ok = response();
  await withDb({ employeeResignationRequest: { create: atBound.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE, body: { note: "x".repeat(NOTE_MAX_LENGTH) } }, ok),
  );
  assert.equal(ok.statusCode, 201);

  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE, body: { note: "x".repeat(NOTE_MAX_LENGTH + 1) } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.equal(rec.calls.length, 0, "an over-long note is never written");
});

test("resignation: a non-string note is rejected rather than coerced", async () => {
  for (const note of [{ $ne: null }, ["a"], 42, true]) {
    const rec = recorder();
    const res = response();
    await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
      createMyResignationRequest({ user: EMPLOYEE, body: { note } }, res),
    );
    assert.equal(res.statusCode, 400, `note ${JSON.stringify(note)} must be refused`);
    assert.equal(rec.calls.length, 0);
  }
});

test("resignation: a request with no body at all is still a valid request", async () => {
  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE }, res),
  );
  assert.equal(res.statusCode, 201);
  assert.equal(rec.calls[0].data.note, null);
});

test("resignation: the status vocabulary stays exactly requested/approved/declined", async () => {
  assert.deepEqual(RESIGNATION_REQUEST_STATUS, ["requested", "approved", "declined"]);
  assert.equal(RESIGNATION_REQUEST_STATUS_DEFAULT, "requested");
});

// ---------------------------------------------------------------------------
// E / F — the database partial unique index, surfaced as a 409
// ---------------------------------------------------------------------------

test("resignation: a P2002 unique violation is a 409 conflict, not a success", async () => {
  const res = response();
  await withDb(
    {
      employeeResignationRequest: {
        create: async () => {
          const e = new Error("Unique constraint failed on the fields (`employeeId`)");
          e.code = "P2002";
          throw e;
        },
      },
    },
    () => createMyResignationRequest({ user: EMPLOYEE, body: { note: "second try" } }, res),
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.resignation, undefined, "a conflict must not return a created row");
  assert.match(res.body.error, /pending resignation request/i);
});

test("resignation: the duplicate response leaks no Prisma internals", async () => {
  const res = response();
  await withDb(
    {
      employeeResignationRequest: {
        create: async () => {
          const e = new Error("Unique constraint failed on the fields (`employeeId`)");
          e.code = "P2002";
          e.meta = { target: ["employeeId"], modelName: "EmployeeResignationRequest" };
          throw e;
        },
      },
    },
    () => createMyResignationRequest({ user: EMPLOYEE, body: {} }, res),
  );

  assert.equal(res.statusCode, 409);
  const serialized = JSON.stringify(res.body);
  assert.equal(/P2002|Prisma|prisma|Unique constraint|meta|modelName/.test(serialized), false, "no internals in the response");
});

test("resignation: no prior SELECT is performed to detect a duplicate", async () => {
  const reads = [];
  const rec = recorder();
  const res = response();
  await withDb(
    {
      employeeResignationRequest: {
        findUnique: async (...args) => { reads.push(["findUnique", args]); return null; },
        findFirst: async (...args) => { reads.push(["findFirst", args]); return null; },
        findMany: async (...args) => { reads.push(["findMany", args]); return []; },
        count: async (...args) => { reads.push(["count", args]); return 0; },
        create: rec.create,
      },
    },
    () => createMyResignationRequest({ user: EMPLOYEE, body: {} }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.deepEqual(reads, [], "the database index is the only duplicate guard; a read-then-write check is race-prone");
});

test("resignation: an unrelated database error is re-thrown, never disguised as a duplicate", async () => {
  for (const code of ["P2003", "P2025", "P1001"]) {
    const res = response();
    let thrown;
    await withDb(
      {
        employeeResignationRequest: {
          create: async () => {
            const e = new Error("Foreign key constraint failed");
            e.code = code;
            throw e;
          },
        },
      },
      async () => {
        try {
          await createMyResignationRequest({ user: EMPLOYEE, body: {} }, res);
        } catch (error) {
          thrown = error;
        }
      },
    );

    assert.equal(thrown?.code, code, `${code} must propagate to the central error handler`);
    assert.equal(res.statusCode, null, `${code} must not produce a response here`);
    assert.equal(res.body, null);
  }
});

test("resignation: a non-Prisma error is re-thrown rather than reported as a conflict", async () => {
  let thrown;
  const res = response();
  await withDb(
    {
      employeeResignationRequest: {
        create: async () => { throw new Error("connection terminated unexpectedly"); },
      },
    },
    async () => {
      try {
        await createMyResignationRequest({ user: EMPLOYEE, body: {} }, res);
      } catch (error) {
        thrown = error;
      }
    },
  );

  assert.equal(thrown?.message, "connection terminated unexpectedly");
  assert.equal(res.statusCode, null, "a server fault must not be answered as a 409");
});

// ---------------------------------------------------------------------------
// J — only "requested" is unique; a decided history must not block a new request
// ---------------------------------------------------------------------------

test("resignation: an existing DECLINED request does not block a new one", async () => {
  // The stub emulates the partial index: it raises P2002 only when another row for
  // this employee is already 'requested'. A declined row is history and must not
  // collide, which is exactly what the partial predicate guarantees and what a
  // plain UNIQUE(employeeId, status) would have broken.
  const existing = [resignationRow({ id: "rs-old", employeeId: "emp1", status: "declined" })];
  const rec = recorder();
  const res = response();

  await withDb(
    {
      employeeResignationRequest: {
        create: async (args) => {
          const open = existing.find((r) => r.employeeId === args.data.employeeId && r.status === "requested");
          if (open) {
            const e = new Error("Unique constraint failed");
            e.code = "P2002";
            throw e;
          }
          rec.calls.push(args);
          return resignationRow(args.data);
        },
      },
    },
    () => createMyResignationRequest({ user: EMPLOYEE, body: { note: "trying again" } }, res),
  );

  assert.equal(res.statusCode, 201, "a declined request is history and must not block a fresh one");
  assert.equal(rec.calls.length, 1);
  assert.equal(res.body.resignation.status, RESIGNATION_REQUEST_STATUS_DEFAULT);
});

test("resignation: an existing APPROVED request does not block a new one", async () => {
  const existing = [resignationRow({ id: "rs-old", employeeId: "emp1", status: "approved" })];
  const rec = recorder();
  const res = response();

  await withDb(
    {
      employeeResignationRequest: {
        create: async (args) => {
          const open = existing.find((r) => r.employeeId === args.data.employeeId && r.status === "requested");
          if (open) {
            const e = new Error("Unique constraint failed");
            e.code = "P2002";
            throw e;
          }
          rec.calls.push(args);
          return resignationRow(args.data);
        },
      },
    },
    () => createMyResignationRequest({ user: EMPLOYEE, body: {} }, res),
  );

  assert.equal(res.statusCode, 201, "an approved request must not permanently bar a rehire-era resignation");
  assert.equal(rec.calls.length, 1);
});

test("resignation: only an existing REQUESTED row blocks a new one", async () => {
  const existing = [resignationRow({ id: "rs-open", employeeId: "emp1", status: "requested" })];
  const res = response();

  await withDb(
    {
      employeeResignationRequest: {
        create: async (args) => {
          const open = existing.find((r) => r.employeeId === args.data.employeeId && r.status === "requested");
          if (open) {
            const e = new Error("Unique constraint failed");
            e.code = "P2002";
            throw e;
          }
          return resignationRow(args.data);
        },
      },
    },
    () => createMyResignationRequest({ user: EMPLOYEE, body: {} }, res),
  );

  assert.equal(res.statusCode, 409);
});

test("resignation: one employee's pending request does not block another employee", async () => {
  const res = response();
  const rec = recorder();
  await withDb(
    {
      employeeResignationRequest: {
        create: async (args) => {
          // Only emp1 has an open request.
          if (args.data.employeeId === "emp1") {
            const e = new Error("Unique constraint failed");
            e.code = "P2002";
            throw e;
          }
          rec.calls.push(args);
          return resignationRow({ ...args.data, employeeId: "emp2" });
        },
      },
    },
    () => createMyResignationRequest({ user: OTHER_EMPLOYEE, body: {} }, res),
  );

  assert.equal(res.statusCode, 201, "the guard is per-employee, not global");
  assert.equal(rec.calls[0].data.employeeId, "emp2");
});

// ---------------------------------------------------------------------------
// G / H — authorization, and the existing disabled-account behavior
// ---------------------------------------------------------------------------

test("resignation: requireEmployee refuses a customer and an admin", async () => {
  for (const user of [CUSTOMER, ADMIN]) {
    const res = response();
    let reached = false;
    await requireEmployee({ user }, res, () => { reached = true; });
    assert.equal(res.statusCode, 403, `${user.role} must be refused`);
    assert.equal(res.body.error, "Forbidden: insufficient role");
    assert.equal(reached, false);
  }
});

test("resignation: an unauthenticated request is refused with 401 and writes nothing", async () => {
  const res = response();
  let reached = false;
  await requireEmployee({ user: undefined }, res, () => { reached = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Not authenticated");
  assert.equal(reached, false, "the handler is never reached without a session");
});

test("resignation: a DISABLED employee is rejected by authenticate before any role check", async () => {
  // The REAL middleware, with a genuinely signed session cookie and a disabled user
  // read straight from the database — the same path the pre-existing disable feature
  // already relies on. Step 2 must not weaken it, and adds no second status system.
  const res = response();
  let reached = false;
  let wrote = false;
  await withDb(
    {
      user: {
        findUnique: async () => ({ id: "emp1", role: ROLES.EMPLOYEE, disabledAt: t("2026-10-01T00:00:00Z") }),
        update: async () => { throw new Error("the presence heartbeat must not run for a disabled account"); },
      },
      employeeResignationRequest: {
        create: async () => { wrote = true; return resignationRow(); },
      },
    },
    () => authenticate({ cookies: { [COOKIE_NAME]: signToken({ id: "emp1" }) }, headers: {} }, res, () => { reached = true; }),
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Account is disabled");
  assert.equal(reached, false, "a disabled employee never reaches requireEmployee or a handler");
  assert.equal(wrote, false, "no resignation request is created for a disabled account");
});

test("resignation: an enabled employee passes authenticate and then requireEmployee", async () => {
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
  assert.equal(req.user.id, "emp1", "the loaded user is what the handler reads as the owner");

  const roleRes = response();
  let through = false;
  await requireEmployee(req, roleRes, () => { through = true; });
  assert.equal(through, true, "the route's guard accepts an enabled employee");
});

// ---------------------------------------------------------------------------
// I / 6 — rejected requests write nothing, and nothing else is touched
// ---------------------------------------------------------------------------

test("resignation: no row is created for any rejected request", async () => {
  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE, body: { note: "x".repeat(NOTE_MAX_LENGTH + 1) } }, res),
  );
  assert.equal(res.statusCode, 400);
  assert.equal(rec.calls.length, 0, "validation failure happens before any write");
});

test("resignation: the submission path writes nothing to User or to any work table", async () => {
  const touched = [];
  // Every delegate the handler must NOT touch is stubbed to record the call and
  // fail loudly if the handler reaches for it, so an accidental write cannot pass
  // unnoticed just because the fake returned null.
  const tripwire = (model) => new Proxy({}, {
    get: (_t, method) => async () => {
      touched.push(`${model}.${String(method)}`);
      throw new Error(`the resignation submission path must never write ${model}.${String(method)}`);
    },
  });

  const res = response();
  let created = 0;
  await withDb(
    {
      employeeResignationRequest: {
        create: async (args) => { created += 1; return resignationRow(args.data); },
      },
      user: tripwire("user"),
      booking: tripwire("booking"),
      bookingAssignment: tripwire("bookingAssignment"),
      shiftOffer: tripwire("shiftOffer"),
      shiftRequest: tripwire("shiftRequest"),
      employeeLeaveRequest: tripwire("employeeLeaveRequest"),
      employeeAvailability: tripwire("employeeAvailability"),
      employeeInvitation: tripwire("employeeInvitation"),
    },
    () => createMyResignationRequest({ user: EMPLOYEE, body: { note: "done" } }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(created, 1, "exactly one resignation row");
  assert.deepEqual(touched, [], "no User, booking, assignment, shift, leave, availability or invitation write");
});

test("resignation: the create writes only employeeId and note", async () => {
  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE, body: { note: "hi", employeeId: "emp2", status: "approved" } }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(rec.calls[0].data).sort(), ["employeeId", "note"]);
  assert.equal(rec.calls[0].data.employeeId, "emp1");
});

test("resignation: the employee response exposes only employee-safe fields", async () => {
  const res = response();
  await withDb(
    {
      employeeResignationRequest: {
        create: async () =>
          // Even if the row carried admin-side columns, the projection must not
          // forward them to the employee.
          resignationRow({
            employeeId: "emp1",
            note: "bye",
            decidedById: "adm1",
            orphanedAssignmentCount: 3,
            orphanReason: "could not reach her",
            orphanAcknowledgedById: "adm1",
            orphanAcknowledgedAt: t("2026-10-02T00:00:00Z"),
          }),
      },
    },
    () => createMyResignationRequest({ user: EMPLOYEE, body: { note: "bye" } }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.body.resignation).sort(), [
    "createdAt",
    "decidedAt",
    "employeeId",
    "id",
    "note",
    "status",
  ]);
  const serialized = JSON.stringify(res.body);
  assert.equal(/adm1|orphanedAssignmentCount|orphanReason|orphanAcknowledged/.test(serialized), false);
});

test("resignation: the create is projected, so no unlisted column can leak", async () => {
  const rec = recorder();
  const res = response();
  await withDb({ employeeResignationRequest: { create: rec.create } }, () =>
    createMyResignationRequest({ user: EMPLOYEE, body: {} }, res),
  );

  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(rec.calls[0].select).sort(), [
    "createdAt",
    "decidedAt",
    "employeeId",
    "id",
    "note",
    "status",
  ]);
});
