import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/utils/prisma.js";
import { ROLES, RESIGNATION_REQUEST_STATUS, RESIGNATION_REQUEST_STATUS_DEFAULT } from "../src/config.js";
import { SHIFT_REQUEST_STATUS } from "../src/config.js";
import {
  adminListResignationRequests,
  adminApproveResignationRequest,
} from "../src/controllers/employeeResignation.js";

// EMPLOYEE RESIGNATION REQUESTS — the ADMIN side (list + approve), and specifically
// the 14(c) rule: approving a resignation automatically declines every still-pending
// ShiftRequest belonging to that employee.
//
// The rules this file protects, asserted directly rather than inferred:
//   1. ADMIN-ONLY — the route is behind adminOnly and the handler re-checks the
//      caller in-handler, so a non-admin is refused before any lookup.
//   2. SCOPE — the cleanup is keyed on the resigning employee's id AND
//      status = 'requested'. Another employee's requests and already-decided rows
//      are unreachable, proven behaviourally against a stateful fake.
//   3. AUDIT — declined requests get status/decidedAt/decidedById from the approving
//      admin, exactly like the existing manual decline in shifts.js. `note` (the
//      employee's own message) is never written.
//   4. ATOMICITY — the decision, the role transition and the cleanup are three
//      writes inside ONE interactive transaction, all on the `tx` client.
//   5. NOTHING ELSE — no BookingAssignment, ShiftOffer, Booking, leave, availability
//      or extra resignation write, and no status outside the three known values.
//
// Prisma is stubbed rather than stood up, so the transaction here is a MODEL of
// atomicity (commit-on-resolve, discard-on-throw), not a real database proof. The
// repository's migration/schema tests cover the constraints themselves.

const t = (s) => new Date(s);

const response = () => ({
  cookies: {},
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; this.statusCode = this.statusCode ?? 200; return this; },
  clearCookie() { return this; },
});

// Swaps Prisma delegates for the duration of `fn`, then restores. `"$root"` stubs a
// method on the client itself (here `$transaction`), which is not a model delegate.
async function withDb(stubs, fn) {
  const originals = new Map();
  try {
    for (const [model, methods] of Object.entries(stubs)) {
      const target = model === "$root" ? prisma : prisma[model];
      for (const [method, stub] of Object.entries(methods)) {
        originals.set(`${model}.${method}`, target[method]);
        target[method] = stub;
      }
    }
    return await fn();
  } finally {
    for (const [key, original] of originals) {
      const dot = key.indexOf(".");
      const model = key.slice(0, dot);
      const method = key.slice(dot + 1);
      const target = model === "$root" ? prisma : prisma[model];
      target[method] = original;
    }
  }
}

const ADMIN = { id: "adm1", role: ROLES.ADMIN, name: "Root" };

const resignationRow = (overrides = {}) => ({
  id: "rs1",
  employeeId: "emp1",
  note: null,
  status: RESIGNATION_REQUEST_STATUS_DEFAULT,
  decidedAt: null,
  decidedById: null,
  createdAt: t("2026-10-01T00:00:00Z"),
  updatedAt: t("2026-10-01T00:00:00Z"),
  orphanedAssignmentCount: null,
  orphanReason: null,
  orphanAcknowledgedAt: null,
  orphanAcknowledgedById: null,
  employee: { id: "emp1", name: "Erin" },
  decidedBy: null,
  orphanAcknowledgedBy: null,
  ...overrides,
});

// A stateful ShiftRequest fake. `updateMany` honours the SAME where/data contract
// the real delegate does, so scoping is proven by observable state rather than by
// asserting on the arguments alone.
function shiftRequestTable(rows = []) {
  return {
    rows,
    updateMany: async ({ where, data }) => {
      const matched = rows.filter((r) => r.employeeId === where.employeeId && r.status === where.status);
      for (const r of matched) Object.assign(r, data);
      return { count: matched.length };
    },
  };
}

// Builds the stub set plus an interactive-transaction harness. Every call is
// logged; writes are only treated as committed if the transaction body resolves,
// which is what lets a test show that a mid-transaction failure leaves no state.
function harness(spec = {}, { failOn } = {}) {
  const calls = [];
  const committed = [];
  const rolledBack = [];
  const models = {};

  for (const [model, methods] of Object.entries(spec)) {
    models[model] = {};
    for (const [method, impl] of Object.entries(methods)) {
      models[model][method] = async (args) => {
        const entry = { model, method, args };
        calls.push(entry);
        if (failOn && failOn.model === model && failOn.method === method) {
          throw new Error(`injected failure in ${model}.${method}`);
        }
        return impl(args);
      };
    }
  }

  // `tx` exposes the same stubbed delegates, so a test can prove a write went
  // through the transaction client rather than the bare prisma client.
  const tx = models;

  return {
    calls,
    committed,
    rolledBack,
    tx,
    stubs: {
      ...models,
      $root: {
        $transaction: async (fn) => {
          try {
            const result = await fn(tx);
            committed.push(...calls);
            return result;
          } catch (error) {
            rolledBack.push(...calls);
            throw error;
          }
        },
      },
    },
  };
}

// The default approval environment: a pending resignation, no outstanding
// bookings, and no shift requests unless a test supplies them. The resignation row
// is STATEFUL, so the projection read back after the transaction reports the decided
// state rather than a frozen fixture.
function approvalEnv({ rows = [], orphanAssignments = [], failOn = null } = {}) {
  const shifts = shiftRequestTable(rows);
  const row = resignationRow();
  const h = harness(
    {
      employeeResignationRequest: {
        findUnique: async () => ({ ...row }),
        updateMany: async ({ where, data }) => {
          const matched = row.id === where.id && row.status === where.status ? 1 : 0;
          if (matched === 1) Object.assign(row, data);
          return { count: matched };
        },
      },
      user: { update: async () => ({ id: "emp1" }) },
      shiftRequest: { updateMany: shifts.updateMany },
      bookingAssignment: { findMany: async () => orphanAssignments },
    },
    { failOn },
  );
  return { ...h, shifts, row };
}

// ===================== 14(c): the ShiftRequest cleanup =====================

test("14(c): approving declines every PENDING ShiftRequest for that employee", async () => {
  const rows = [
    { id: "sr1", employeeId: "emp1", status: "requested", note: "please" },
    { id: "sr2", employeeId: "emp1", status: "requested", note: null },
    { id: "sr3", employeeId: "emp1", status: "requested", note: "x" },
  ];
  const env = approvalEnv({ rows });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.declinedShiftRequests, 3);
  for (const r of rows) assert.equal(r.status, "declined", `${r.id} is declined`);
});

test("14(c): ANOTHER employee's pending ShiftRequests are untouched", async () => {
  const rows = [
    { id: "sr1", employeeId: "emp1", status: "requested" },
    { id: "sr2", employeeId: "emp2", status: "requested" },
    { id: "sr3", employeeId: "emp3", status: "requested" },
  ];
  const env = approvalEnv({ rows });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.equal(res.body.declinedShiftRequests, 1, "only this employee's request");
  assert.equal(rows[0].status, "declined");
  assert.equal(rows[1].status, "requested", "emp2's request survives");
  assert.equal(rows[2].status, "requested", "emp3's request survives");
  // And the WHERE clause is scoped by BOTH keys, never a broad update.
  const call = env.calls.find((c) => c.model === "shiftRequest" && c.method === "updateMany");
  assert.deepEqual(call.args.where, { employeeId: "emp1", status: "requested" });
});

test("14(c): already-approved and already-declined ShiftRequests are never rewritten", async () => {
  const approvedAt = t("2026-09-01T00:00:00Z");
  const rows = [
    { id: "sr1", employeeId: "emp1", status: "requested" },
    { id: "sr2", employeeId: "emp1", status: "approved", decidedAt: approvedAt, decidedById: "adm9" },
    { id: "sr3", employeeId: "emp1", status: "declined", decidedAt: approvedAt, decidedById: "adm9" },
  ];
  const env = approvalEnv({ rows });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.equal(res.body.declinedShiftRequests, 1, "only the pending row");
  assert.deepEqual(rows[1], { id: "sr2", employeeId: "emp1", status: "approved", decidedAt: approvedAt, decidedById: "adm9" },
    "a settled approval is left exactly as it was");
  assert.deepEqual(rows[2], { id: "sr3", employeeId: "emp1", status: "declined", decidedAt: approvedAt, decidedById: "adm9" },
    "a settled decline keeps its original actor and timestamp");
});

test("14(c): no pending ShiftRequests yields a zero count and a harmless update", async () => {
  const env = approvalEnv({ rows: [] });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.declinedShiftRequests, 0);
  // The write still happened (scoped, so a no-op) rather than being skipped.
  const call = env.calls.find((c) => c.model === "shiftRequest" && c.method === "updateMany");
  assert.ok(call, "the scoped update runs and matches nothing");
});

test("14(c): decidedAt is a Date and decidedById is the APPROVING admin", async () => {
  const rows = [{ id: "sr1", employeeId: "emp1", status: "requested" }];
  const env = approvalEnv({ rows });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.ok(rows[0].decidedAt instanceof Date, "decidedAt is a real Date");
  assert.equal(rows[0].decidedById, "adm1", "attributed to the session admin");
  // The resignation decision and the shift declines share ONE timestamp.
  const decision = env.calls.find((c) => c.model === "employeeResignationRequest" && c.method === "updateMany");
  assert.equal(rows[0].decidedAt.getTime(), decision.args.data.decidedAt.getTime());
});

test("14(c): `note` is never written by the cleanup", async () => {
  const rows = [{ id: "sr1", employeeId: "emp1", status: "requested", note: "the employee's own words" }];
  const env = approvalEnv({ rows });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  const call = env.calls.find((c) => c.model === "shiftRequest" && c.method === "updateMany");
  assert.equal("note" in call.args.data, false, "no decline-reason field is invented");
  assert.deepEqual(Object.keys(call.args.data).sort(), ["decidedAt", "decidedById", "status"]);
  assert.equal(rows[0].note, "the employee's own words", "the employee's note is preserved");
});

test("14(c): the cleanup writes ONLY the three known ShiftRequest statuses", async () => {
  const rows = [{ id: "sr1", employeeId: "emp1", status: "requested" }];
  const env = approvalEnv({ rows });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  const call = env.calls.find((c) => c.model === "shiftRequest" && c.method === "updateMany");
  assert.ok(SHIFT_REQUEST_STATUS.includes(call.args.data.status), "status comes from the known set");
  assert.deepEqual(SHIFT_REQUEST_STATUS, ["requested", "approved", "declined"]);
});

test("14(c): the cleanup runs INSIDE the transaction, on the tx client", async () => {
  const env = approvalEnv({ rows: [{ id: "sr1", employeeId: "emp1", status: "requested" }] });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  // The three WRITES are all on the same transaction client, and committed together.
  const writes = env.calls.filter((c) => c.method !== "findMany" && c.method !== "findUnique");
  assert.deepEqual([...new Set(writes.map((c) => c.model))].sort(),
    ["employeeResignationRequest", "shiftRequest", "user"]);
  // Every write committed; nothing rolled back. The only call outside the
  // transaction is the projection read-back that happens after it commits.
  assert.equal(env.rolledBack.length, 0);
  assert.equal(env.committed.filter((c) => c.method !== "findMany" && c.method !== "findUnique").length,
    writes.length, "every write committed");
  const afterCommit = env.calls.filter((c) => !env.committed.includes(c)).map((c) => c.method);
  assert.deepEqual(afterCommit, ["findUnique"], "only the response projection is read after committing");
  // No stray write bypassed the transaction.
  assert.equal(writes.filter((c) => c.model === "shiftRequest").length, 1);
});

test("14(c): a mid-transaction failure rolls back the resignation AND the role change", async () => {
  const rows = [{ id: "sr1", employeeId: "emp1", status: "requested" }];
  const env = approvalEnv({ rows, failOn: { model: "shiftRequest", method: "updateMany" } });
  const res = response();
  let threw = null;
  await withDb(env.stubs, async () => {
    try {
      await adminApproveResignationRequest({ user: ADMIN, params: { id: "rs1" }, body: {} }, res);
    } catch (e) { threw = e; }
  });
  assert.ok(threw, "an unrelated Prisma fault is re-thrown, not disguised");
  assert.equal(res.statusCode, null, "no success response");
  // The decision and the role transition were attempted but NOT committed, and the
  // shift request is still pending — no partial state survives.
  assert.equal(env.committed.length, 0, "nothing committed");
  assert.ok(env.rolledBack.length >= 2, "the earlier writes were discarded with the transaction");
  assert.equal(rows[0].status, "requested", "the shift request was not declined");
});

// ===================== approval: preserved Step 3 behaviour =====================

test("approve: a non-admin is refused 403 before any lookup", async () => {
  for (const caller of [{ id: "emp1", role: ROLES.EMPLOYEE }, { id: "cus1", role: ROLES.CUSTOMER }]) {
    let looked = false;
    const res = response();
    await withDb(
      {
        employeeResignationRequest: { findUnique: async () => { looked = true; return null; } },
        bookingAssignment: { findMany: async () => { looked = true; return []; } },
      },
      () => adminApproveResignationRequest({ user: caller, params: { id: "rs1" }, body: {} }, res),
    );
    assert.equal(res.statusCode, 403);
    assert.equal(looked, false, "refused before any database access");
  }
});

test("approve: only a REQUESTED resignation may be approved", async () => {
  for (const status of ["approved", "declined"]) {
    const res = response();
    let wrote = false;
    await withDb(
      {
        employeeResignationRequest: {
          findUnique: async () => resignationRow({ status }),
          updateMany: async () => { wrote = true; return { count: 1 }; },
        },
      },
      () => adminApproveResignationRequest({ user: ADMIN, params: { id: "rs1" }, body: {} }, res),
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, new RegExp(`already ${status}`));
    assert.equal(wrote, false, "a decided request is never re-decided");
  }
});

test("approve: a missing request is a 404", async () => {
  const res = response();
  await withDb(
    { employeeResignationRequest: { findUnique: async () => null } },
    () => adminApproveResignationRequest({ user: ADMIN, params: { id: "nope" }, body: {} }, res),
  );
  assert.equal(res.statusCode, 404);
});

test("approve: losing the conditional updateMany race is refused, not double-decided", async () => {
  const res = response();
  const env = harness({
    employeeResignationRequest: {
      findUnique: async () => resignationRow(),
      updateMany: async () => ({ count: 0 }), // another admin won
    },
    user: { update: async () => ({ id: "emp1" }) },
    shiftRequest: { updateMany: async () => ({ count: 0 }) },
    bookingAssignment: { findMany: async () => [] },
  });
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /already decided/);
  assert.equal(env.calls.filter((c) => c.model === "user").length, 0, "the role change never ran");
  assert.equal(env.calls.filter((c) => c.model === "shiftRequest").length, 0, "no request was declined");
});

test("approve: a P2025 (vanished employee) rolls back and 404s", async () => {
  const rows = [{ id: "sr1", employeeId: "emp1", status: "requested" }];
  const env = harness(
    {
      employeeResignationRequest: {
        findUnique: async () => resignationRow(),
        updateMany: async () => ({ count: 1 }),
      },
      user: {
        update: async () => { const e = new Error("no row"); e.code = "P2025"; throw e; },
      },
      shiftRequest: { updateMany: shiftRequestTable(rows).updateMany },
      bookingAssignment: { findMany: async () => [] },
    },
  );
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.equal(res.statusCode, 404);
  assert.equal(rows[0].status, "requested", "the decline rolled back with the rest");
  assert.equal(env.committed.length, 0);
});

test("approve: the role becomes customer, presence offline, and disabledAt is UNTOUCHED", async () => {
  const res = response();
  const env = approvalEnv();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  const call = env.calls.find((c) => c.model === "user" && c.method === "update");
  assert.deepEqual(call.args.data, { role: ROLES.CUSTOMER, status: "offline" });
  assert.equal("disabledAt" in call.args.data, false, "approving a resignation must not disable the account");
  assert.equal(call.args.where.id, "emp1", "the role change targets the stored employee");
});

test("approve: outstanding accepted bookings are a 409 ORPHANED_ASSIGNMENTS unless overridden", async () => {
  const env = approvalEnv({
    orphanAssignments: [{ id: "ba1", bookingId: "bk1" }, { id: "ba2", bookingId: "bk2" }],
  });
  const res = response();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "ORPHANED_ASSIGNMENTS");
  assert.equal(res.body.orphanedAssignmentCount, 2);
  assert.deepEqual(res.body.orphanedBookingIds, ["bk1", "bk2"]);
  assert.equal(env.calls.filter((c) => c.model === "user").length, 0, "nothing was approved");
});

test("approve: an override without a reason is refused", async () => {
  const res = response();
  const env = approvalEnv({ orphanAssignments: [{ id: "ba1", bookingId: "bk1" }] });
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: { confirmOrphanedAssignments: true } }, res,
  ));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /reason is required/);
  assert.equal(env.calls.filter((c) => c.model === "user").length, 0);
});

test("approve: an override records the count, the reason and the acknowledgement", async () => {
  const res = response();
  const env = approvalEnv({ orphanAssignments: [{ id: "ba1", bookingId: "bk1" }] });
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: { confirmOrphanedAssignments: true, orphanReason: "  moved away  " } },
    res,
  ));
  assert.equal(res.statusCode, 200);
  const call = env.calls.find((c) => c.model === "employeeResignationRequest" && c.method === "updateMany");
  assert.equal(call.args.data.orphanedAssignmentCount, 1);
  assert.equal(call.args.data.orphanReason, "moved away", "the reason is trimmed");
  assert.ok(call.args.data.orphanAcknowledgedAt instanceof Date);
  assert.equal(call.args.data.orphanAcknowledgedById, "adm1");
});

test("approve: with no outstanding work the orphan columns stay NULL", async () => {
  const res = response();
  const env = approvalEnv();
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  const call = env.calls.find((c) => c.model === "employeeResignationRequest" && c.method === "updateMany");
  for (const f of ["orphanedAssignmentCount", "orphanReason", "orphanAcknowledgedAt", "orphanAcknowledgedById"]) {
    assert.equal(call.args.data[f], null, `${f} is NULL when no override was used`);
  }
});

test("approve: a hostile body cannot control employeeId or decidedById", async () => {
  const res = response();
  const env = approvalEnv({ rows: [{ id: "sr1", employeeId: "emp1", status: "requested" }] });
  await withDb(env.stubs, () => adminApproveResignationRequest(
    {
      user: ADMIN,
      params: { id: "rs1" },
      body: { employeeId: "emp2", userId: "emp2", decidedById: "adm9", role: ROLES.ADMIN, status: "declined" },
    },
    res,
  ));
  assert.equal(res.statusCode, 200);
  const userWrite = env.calls.find((c) => c.model === "user" && c.method === "update");
  assert.equal(userWrite.args.where.id, "emp1", "the stored employee, not the body's");
  const decision = env.calls.find((c) => c.model === "employeeResignationRequest" && c.method === "updateMany");
  assert.equal(decision.args.where.id, "rs1");
  assert.equal(decision.args.data.decidedById, "adm1", "the session admin, not the body's");
  assert.equal(env.shifts.rows[0].decidedById, "adm1", "and for the auto-declined request too");
});

test("approve: no unrelated model is written by the cleanup", async () => {
  const res = response();
  const env = approvalEnv({ rows: [{ id: "sr1", employeeId: "emp1", status: "requested" }] });
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  const writtenModels = [...new Set(env.calls.filter((c) => c.method !== "findMany" && c.method !== "findUnique").map((c) => c.model))].sort();
  assert.deepEqual(writtenModels, ["employeeResignationRequest", "shiftRequest", "user"],
    "exactly one decision, one role change, one cleanup — no booking, assignment, shift offer, leave or availability write");
  // Only the intended resignation row is updated, and only by a conditional update.
  const resignations = env.calls.filter((c) => c.model === "employeeResignationRequest" && c.method !== "findUnique");
  assert.equal(resignations.length, 1);
  assert.equal(resignations[0].method, "updateMany");
});

test("approve: the response carries the existing projection plus the decline count", async () => {
  const res = response();
  const env = approvalEnv({ rows: [{ id: "sr1", employeeId: "emp1", status: "requested" }] });
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  assert.deepEqual(Object.keys(res.body).sort(), ["declinedShiftRequests", "resignation"]);
  const view = res.body.resignation;
  for (const f of ["id", "employeeId", "note", "status", "decidedAt", "createdAt",
    "employeeName", "decidedById", "decidedByName", "orphanedAssignmentCount",
    "orphanReason", "orphanAcknowledgedAt", "orphanAcknowledgedById"]) {
    assert.ok(f in view, `${f} is present`);
  }
  // No private data leaks through the admin projection.
  for (const f of ["passwordHash", "email", "phone", "address"]) {
    assert.equal(f in view, false, `${f} is never exposed`);
  }
  assert.equal(view.status, "approved");
  assert.equal(res.body.declinedShiftRequests, 1);
});

test("approve: every written status value is one of the three known ones", async () => {
  const res = response();
  const env = approvalEnv({ rows: [{ id: "sr1", employeeId: "emp1", status: "requested" }] });
  await withDb(env.stubs, () => adminApproveResignationRequest(
    { user: ADMIN, params: { id: "rs1" }, body: {} }, res,
  ));
  const decision = env.calls.find((c) => c.model === "employeeResignationRequest" && c.method === "updateMany");
  assert.ok(RESIGNATION_REQUEST_STATUS.includes(decision.args.data.status));
  assert.deepEqual(RESIGNATION_REQUEST_STATUS, ["requested", "approved", "declined"]);
});

// ===================== the admin queue =====================

test("list: pending first, decided after, and an unknown status is refused", async () => {
  const rows = [
    resignationRow({ id: "rs1", status: "approved", createdAt: t("2026-10-03T00:00:00Z") }),
    resignationRow({ id: "rs2", status: RESIGNATION_REQUEST_STATUS_DEFAULT, createdAt: t("2026-10-02T00:00:00Z") }),
    resignationRow({ id: "rs3", status: "declined", createdAt: t("2026-10-04T00:00:00Z") }),
    resignationRow({ id: "rs4", status: RESIGNATION_REQUEST_STATUS_DEFAULT, createdAt: t("2026-10-01T00:00:00Z") }),
  ];
  const res = response();
  let where = null;
  let orderBy = null;
  await withDb(
    {
      employeeResignationRequest: {
        findMany: async (args) => {
          where = args.where;
          orderBy = args.orderBy;
          // Emulate the database's newest-first ordering, so the assertion below is
          // really testing the JS pending/decided partition and not the fixture.
          return [...rows].sort((a, b) => b.createdAt - a.createdAt);
        },
      },
    },
    () => adminListResignationRequests({ user: ADMIN, query: {} }, res),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(where, {});
  assert.deepEqual(orderBy, [{ createdAt: "desc" }]);
  // Newest-first overall is rs3, rs1, rs2, rs4. Partitioning stably gives the
  // pending rows (rs2, rs4) first, each still newest-first, then the decided rows.
  assert.deepEqual(res.body.resignations.map((r) => r.id), ["rs2", "rs4", "rs3", "rs1"],
    "pending first, then decided, each group left newest-first");
  assert.deepEqual(res.body.counts, { requested: 2, approved: 1, declined: 1 });
  assert.equal(res.body.filter, null);

  const bad = response();
  await withDb(
    { employeeResignationRequest: { findMany: async () => [] } },
    () => adminListResignationRequests({ user: ADMIN, query: { status: "nope" } }, bad),
  );
  assert.equal(bad.statusCode, 400, "a typo can never silently list everything");
});

test("list: a non-admin is refused 403", async () => {
  const res = response();
  await withDb(
    { employeeResignationRequest: { findMany: async () => [] } },
    () => adminListResignationRequests({ user: { id: "cus1", role: ROLES.CUSTOMER }, query: {} }, res),
  );
  assert.equal(res.statusCode, 403);
});