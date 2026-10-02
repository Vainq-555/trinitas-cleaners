import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEAVE_KINDS,
  LEAVE_REQUEST_DISCLAIMER,
  LEAVE_STATUS,
  canDecideLeave,
  isPendingLeave,
  isValidLeaveRangeInput,
  leaveDayLabel,
  leaveDecisionLabel,
  leaveKindLabel,
  leaveRangeLabel,
  leaveStatusClass,
  leaveStatusLabel,
  sortLeaveByCreatedDesc,
  sortLeaveForAdmin,
} from "../lib/employeeLeave.mjs";

// EMPLOYEE LEAVE REQUESTS — employee/admin UI helpers and production wiring.
//
// The pure helpers are unit-tested directly. The wiring tests read the production
// sources and fail if the UI ever starts re-deciding authorization in the browser,
// sends a client-chosen employeeId, invents a decision, or claims that approving
// leave changes anyone's schedule or account.

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// The same source with comments removed. Negative assertions ("must not send an
// employeeId", "must not claim leave changes availability") must not fire on an
// explanatory comment that names the very rule being upheld.
const code = (rel) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
    .replace(/\n{2,}/g, "\n");

const EMPLOYEE_PAGE = "../app/employee/leave/page.jsx";
const ADMIN_PAGE = "../app/admin/leave/page.jsx";
const HOOK = "../lib/useEmployeeLeave.js";

// ---- pure helpers ----

test("leave: the status set is exactly requested/approved/declined", () => {
  assert.deepEqual(LEAVE_STATUS, { REQUESTED: "requested", APPROVED: "approved", DECLINED: "declined" });
  // No extra lifecycle state an admin could ever reach.
  for (const forbidden of ["cancelled", "pending", "rejected", "terminated", "revoked"]) {
    assert.equal(Object.values(LEAVE_STATUS).includes(forbidden), false);
  }
});

test("leave: the kind buckets are a fixed, non-empty, normalized list", () => {
  assert.ok(LEAVE_KINDS.length > 0);
  assert.ok(LEAVE_KINDS.includes("vacation"), "expected the standard buckets");
  for (const kind of LEAVE_KINDS) {
    assert.equal(typeof kind, "string");
    assert.equal(kind, kind.trim().toLowerCase());
  }
  assert.equal(new Set(LEAVE_KINDS).size, LEAVE_KINDS.length, "no duplicate kind");
});

test("leave: the disclaimer says it is only a request and changes no scheduled work", () => {
  assert.match(LEAVE_REQUEST_DISCLAIMER, /request/i);
  assert.match(LEAVE_REQUEST_DISCLAIMER, /admin/i);
  assert.match(LEAVE_REQUEST_DISCLAIMER, /does not change/i);
  // It must not imply leave is auto-approved, nor that it edits availability.
  assert.equal(/auto(matically)?[- ]?approv/i.test(LEAVE_REQUEST_DISCLAIMER), false);
});

test("leave: every status has a label and a distinct-enough class", () => {
  for (const status of Object.values(LEAVE_STATUS)) {
    const label = leaveStatusLabel(status);
    const cls = leaveStatusClass(status);
    assert.ok(label && label.length > 0, `missing label for ${status}`);
    assert.ok(cls && cls.length > 0, `missing class for ${status}`);
    assert.equal(/undefined|\[object/.test(label + cls), false);
  }
  assert.equal(leaveStatusLabel(LEAVE_STATUS.APPROVED), "Approved");
  assert.equal(leaveStatusLabel(LEAVE_STATUS.DECLINED), "Declined");
  assert.match(leaveStatusLabel(LEAVE_STATUS.REQUESTED), /awaiting|pending/i);
  // An undecided request must look different from both decisions.
  assert.notEqual(leaveStatusClass(LEAVE_STATUS.REQUESTED), leaveStatusClass(LEAVE_STATUS.DECLINED));
  assert.notEqual(leaveStatusClass(LEAVE_STATUS.APPROVED), leaveStatusClass(LEAVE_STATUS.DECLINED));
  // A status from a future release defaults to undecided, never to "Approved".
  assert.equal(leaveStatusLabel("something-new"), leaveStatusLabel(LEAVE_STATUS.REQUESTED));
});

test("leave: only a requested request is pending, and only it can be decided", () => {
  assert.equal(isPendingLeave({ status: "requested" }), true);
  assert.equal(isPendingLeave({ status: "approved" }), false);
  assert.equal(isPendingLeave({ status: "declined" }), false);
  assert.equal(canDecideLeave({ status: "requested" }), true);
  assert.equal(canDecideLeave({ status: "approved" }), false);
  assert.equal(canDecideLeave({ status: "declined" }), false);
  // An unknown status is treated as undecided, so it is never shown as approved.
  assert.equal(leaveStatusLabel("something-new") === "Approved", false);
  for (const empty of [null, undefined, {}]) assert.equal(isPendingLeave(empty), false);
});

test("leave: the outcome line names the deciding admin and the decision date", () => {
  const approved = leaveDecisionLabel({
    status: "approved",
    decidedByName: "Ada Admin",
    decidedAt: "2026-10-02T15:04:00.000Z",
  });
  assert.match(approved, /Ada Admin/);
  assert.match(approved, /2 Oct 2026/);
  assert.match(approved, /approv/i);

  const declined = leaveDecisionLabel({ status: "declined", decidedByName: "Ada Admin" });
  assert.match(declined, /declin/i);

  // A pending request has no decision to report.
  assert.equal(isPendingLeave({ status: "requested" }), true);
  assert.match(leaveDecisionLabel({ status: "requested" }), /awaiting/i);

  // A decided request missing its admin or date must not render "undefined".
  for (const partial of [
    { status: "approved" },
    { status: "approved", decidedAt: "2026-10-02T15:04:00.000Z" },
    { status: "declined", decidedByName: "Ada Admin" },
  ]) {
    assert.equal(/undefined|null|\[object|NaN/.test(leaveDecisionLabel(partial)), false, JSON.stringify(partial));
  }
});

test("leave: a wall-clock day renders without shifting across the date boundary", () => {
  // "YYYY-MM-DD" is a wall clock. Parsed naively as UTC midnight and formatted
  // locally, 2026-01-01 would display as 12/31/2025 west of Greenwich. These
  // assertions run under whatever TZ the machine has, so they must be exact.
  assert.equal(leaveDayLabel("2026-01-01"), "Thu 1 Jan 2026");
  assert.equal(leaveDayLabel("2026-12-31"), "Thu 31 Dec 2026");
  assert.equal(leaveDayLabel("2026-10-02"), "Fri 2 Oct 2026");
  // A leap day is a real day.
  assert.equal(leaveDayLabel("2028-02-29"), "Tue 29 Feb 2028");
});

test("leave: an impossible or malformed day never fabricates a date", () => {
  // 2026-02-30 passes the YYYY-MM-DD shape but is not a calendar day.
  assert.equal(leaveDayLabel("2026-02-30"), "2026-02-30");
  assert.equal(leaveDayLabel("2026-13-01"), "2026-13-01");
  assert.equal(leaveDayLabel("2026-00-10"), "2026-00-10");
  // A missing value is empty, not "Invalid Date" or "undefined".
  assert.equal(leaveDayLabel(""), "");
  assert.equal(leaveDayLabel(null), "");
  assert.equal(leaveDayLabel(undefined), "");
});

test("leave: a one-day request reads as a single date, a span as a range", () => {
  assert.equal(leaveRangeLabel({ startsOn: "2026-10-02", endsOn: "2026-10-02" }), "Fri 2 Oct 2026");
  assert.equal(
    leaveRangeLabel({ startsOn: "2026-10-02", endsOn: "2026-10-05" }),
    "Fri 2 Oct 2026 – Mon 5 Oct 2026",
  );
  // A request with no end yet still shows its start.
  assert.equal(leaveRangeLabel({ startsOn: "2026-10-02" }), "Fri 2 Oct 2026");
  assert.equal(leaveRangeLabel({}), "");
  assert.equal(leaveRangeLabel(null), "");
});

test("leave: an absent kind still reads as a complete request", () => {
  assert.equal(leaveKindLabel({ kind: "vacation" }), "Vacation");
  assert.equal(leaveKindLabel({ kind: "sick" }), "Sick");
  assert.equal(leaveKindLabel({}), "Time off");
  assert.equal(leaveKindLabel(null), "Time off");
  assert.equal(/undefined|null/.test(leaveKindLabel({ kind: "uninvented-bucket" })), false);
});

test("leave: the range check mirrors the server: ordered, real days, one day allowed", () => {
  assert.equal(isValidLeaveRangeInput("2026-10-02", "2026-10-05"), true);
  // A single day is a genuine one-day leave, not an empty range.
  assert.equal(isValidLeaveRangeInput("2026-10-02", "2026-10-02"), true);
  // Inverted span.
  assert.equal(isValidLeaveRangeInput("2026-10-05", "2026-10-02"), false);
  // Missing or malformed ends.
  assert.equal(isValidLeaveRangeInput("", ""), false);
  assert.equal(isValidLeaveRangeInput("2026-10-02", ""), false);
  assert.equal(isValidLeaveRangeInput("2026-10-02", undefined), false);
  assert.equal(isValidLeaveRangeInput("10/02/2026", "2026-10-05"), false);
  // Impossible calendar days are rejected on both sides.
  assert.equal(isValidLeaveRangeInput("2026-02-30", "2026-03-02"), false);
  assert.equal(isValidLeaveRangeInput("2026-10-02", "2026-13-01"), false);
  // Non-strings cannot be a leave span.
  assert.equal(isValidLeaveRangeInput(new Date(), "2026-10-05"), false);
});

test("leave: the employee's own list is newest first", () => {
  const rows = [
    { id: "1", status: "requested", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "2", status: "approved", createdAt: "2026-10-05T00:00:00.000Z" },
    { id: "3", status: "requested", createdAt: "2026-10-04T00:00:00.000Z" },
  ];
  assert.deepEqual(sortLeaveByCreatedDesc(rows).map((r) => r.id), ["2", "3", "1"]);
  // Sorting is pure: the caller's array is untouched, and nothing is dropped.
  const original = [...rows];
  const sorted = sortLeaveByCreatedDesc(rows);
  assert.deepEqual(rows, original);
  assert.equal(sorted.length, rows.length);
  // A missing/unparseable timestamp must not throw or drop a row.
  assert.equal(sortLeaveByCreatedDesc([{ id: "a" }, { id: "b", createdAt: "nope" }]).length, 2);
  assert.deepEqual(sortLeaveByCreatedDesc([]), []);
  assert.deepEqual(sortLeaveByCreatedDesc(null), []);
});

test("leave: the admin queue is pending first, then newest first", () => {
  const rows = [
    { id: "1", status: "approved", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "2", status: "requested", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "3", status: "declined", createdAt: "2026-10-05T00:00:00.000Z" },
    { id: "4", status: "requested", createdAt: "2026-10-04T00:00:00.000Z" },
  ];
  const sorted = sortLeaveForAdmin(rows).map((r) => r.id);
  assert.equal(sorted[0], "4", "the newest pending request leads the queue");
  assert.equal(sorted[1], "2", "the older pending request follows it");
  assert.equal(sorted.length, rows.length, "sorting never drops a request");
  assert.equal(sorted.indexOf("3") < sorted.indexOf("1"), true, "decided rows keep newest-first order");
  assert.equal(sortLeaveForAdmin([{ id: "a" }, { id: "b", status: "declined" }]).length, 2);
  assert.deepEqual(sortLeaveForAdmin(null), []);
});

// ---- employee portal wiring ----

test("leave: the employee flow never chooses who it is for or what the outcome is", () => {
  for (const [name, rel] of [
    ["employee page", EMPLOYEE_PAGE],
    ["employee hook", HOOK],
  ]) {
    const src = code(rel);
    // The server derives the employee from the session. A client-chosen
    // employeeId would let one employee file leave on another's behalf.
    assert.equal(/\bemployeeId\b/.test(src), false, `${name} must not send employeeId`);
    assert.equal(/\buserId\b/.test(src), false, `${name} must not send userId`);
    // Nor may the client pre-fill a decision.
    assert.equal(/\bdecidedById\b/.test(src), false, `${name} must not send decidedById`);
    assert.equal(/\bdecidedAt\b/.test(src), false, `${name} must not send decidedAt`);
  }
  // Only the server sets the status, and never to a decision at creation.
  const page = code(EMPLOYEE_PAGE);
  assert.equal(/status\s*:\s*["']approved["']|status\s*:\s*["']declined["']/.test(page), false);
});

test("leave: the employee flow posts to /employee/leave and only reads it back", () => {
  const hook = code(HOOK);
  assert.match(hook, /["'`]\/employee\/leave["'`]/);
  assert.match(hook, /method:\s*["']POST["']/);
  // Creating a request is not an edit or a delete of anything.
  assert.equal(/method:\s*["'](PUT|PATCH|DELETE)["']/.test(hook), false);
  // The employee portal cannot see or reach the admin queue.
  const page = code(EMPLOYEE_PAGE);
  assert.equal(/admin\/leave/.test(page), false);
});

test("leave: the admin queue is reachable from the existing admin navigation", () => {
  // The leave page carries its own nav, and the employees hub (where an admin
  // already goes to manage employees) links to it, so the queue is discoverable
  // without knowing the URL.
  for (const rel of ["../app/admin/leave/page.jsx", "../app/admin/employees/page.jsx"]) {
    const src = code(rel);
    assert.match(src, /href:\s*["']\/admin\/leave["']/, `${rel} must link the admin queue`);
    assert.match(src, /CalendarOff/, `${rel} must import the icon it uses`);
  }
});

test("leave: the employee portal links the new page from its own navigation", () => {
  const nav = code("../lib/employeeNav.jsx");
  assert.match(nav, /href:\s*["']\/employee\/leave["']/);
  assert.match(nav, /CalendarOff/);
});

// ---- admin queue wiring ----

test("leave: the admin decisions go to the dedicated endpoints and name nobody", () => {
  const page = code(ADMIN_PAGE);
  // The queue is read from GET /admin/leave and each decision is its own POST.
  assert.match(page, /\/admin\/leave/);
  assert.match(page, /approve/);
  assert.match(page, /decline/);
  assert.match(page, /method:\s*["']POST["']/);
  // A decision never carries a client-chosen decider or timestamp: both come from
  // the admin session, server-side.
  assert.equal(/\bdecidedById\b/.test(page), false);
  assert.equal(/decidedAt\s*[:,]/.test(page), false);
  // The employee hook stays employee-only: it must not reach the admin queue.
  assert.equal(/admin\/leave/.test(code(HOOK)), false, "the employee hook must not call the admin routes");
});

test("leave: the admin page shows the server's counts and offers decisions only when pending", () => {
  const page = code(ADMIN_PAGE);
  // Counts come from the response, not from a client-side recount.
  assert.match(page, /counts/);
  // The approve/decline controls are gated on the request still being undecided.
  assert.match(page, /isPendingLeave/);
  // A decided row is shown as decided, via the helper that renders the decider the
  // SERVER recorded. The page must never build a decider of its own.
  assert.match(page, /leaveDecisionLabel\(\s*request\s*\)/);
  assert.equal(/decidedByName\s*[:=]/.test(page), false, "the page must not name a decider itself");
  // The employee name comes from the server response, never from a client lookup.
  assert.match(page, /employeeName/);
});

test("leave: no leave screen writes availability, the account lifecycle, or work", () => {
  for (const [name, rel] of [
    ["employee page", EMPLOYEE_PAGE],
    ["admin page", ADMIN_PAGE],
    ["helpers", "../lib/employeeLeave.mjs"],
    ["hook", HOOK],
  ]) {
    const src = code(rel);
    // Nothing is ever updated or deleted: leave is create + read + one decision.
    assert.equal(/method:\s*["'](PUT|PATCH|DELETE)["']/.test(src), false, `${name} must not mutate anything`);
    // Leave and availability are separate systems, so the screens must not call the
    // availability endpoints (the word "availability" may appear in the copy that
    // explains they are separate).
    assert.equal(/\/availability|employeeAvailability/i.test(src), false, `${name} must not write availability`);
    // Nor may any screen reach the account lifecycle, where disable lives. (The
    // JSX `disabled={...}` button attribute is unrelated and stays allowed.)
    assert.equal(
      /\/disable|disabledAt|terminatedAt|terminationReason|\/reactivate/i.test(src),
      false,
      `${name} must not touch the account lifecycle`,
    );
    // And nothing may imply a decision is automatic.
    assert.equal(/auto(matically)?[- ]?approv/i.test(src), false, `${name} must not auto-approve`);
  }
});

test("leave: neither screen re-derives authorization in the browser", () => {
  const both = code(EMPLOYEE_PAGE) + code(ADMIN_PAGE) + code(HOOK);
  // No client-side session reading, and no role branching to gate a decision.
  assert.equal(/localStorage|sessionStorage|getItem\(["']tc_/.test(both), false);
  assert.equal(/isAdmin\s*[?&|]/.test(both), false);
  // The employee page uses the shared hook, and the admin page the shared portal
  // client, so cookies and error handling behave as everywhere else.
  assert.match(code(EMPLOYEE_PAGE), /from "@\/lib\/useEmployeeLeave"/);
  assert.match(code(ADMIN_PAGE), /import \{ api \} from "@\/lib\/api"/);
  // A 401/403 from either flow is reported, never worked around in the browser.
  assert.match(code(EMPLOYEE_PAGE) + code(ADMIN_PAGE), /401|403/);
});
