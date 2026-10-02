import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  groupLeaveByWhen,
  isLeavePast,
  sortLeaveHistory,
  sortLeaveUpcoming,
  todayLeaveDay,
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

// ---------------------------------------------------------------------------
// CURRENT & UPCOMING vs LEAVE HISTORY
//
// A leave that ended last year must not sit next to one that starts next month.
// These tests pin the split, the boundary, both orderings, and — most importantly —
// that grouping is a VIEW: it never deletes a request and never changes a status.
// ---------------------------------------------------------------------------

const TODAY = "2026-10-02"; // a fixed "today", so nothing here depends on the clock

const leave = (over = {}) => ({ id: "lv", startsOn: "2026-10-02", endsOn: "2026-10-02", kind: "vacation", note: null, status: "requested", decidedAt: null, createdAt: "2026-09-01T00:00:00.000Z", ...over });

test("leave: today is read as the viewer's LOCAL calendar day", () => {
  assert.equal(todayLeaveDay(new Date(2026, 9, 2, 0, 0, 0)), "2026-10-02", "local midnight");
  assert.equal(todayLeaveDay(new Date(2026, 9, 2, 23, 59, 59)), "2026-10-02", "last minute of the local day");
  assert.equal(todayLeaveDay(new Date(2026, 11, 31, 12, 0, 0)), "2026-12-31");
  // Single-digit month and day are zero padded, so it stays comparable as a string.
  assert.match(todayLeaveDay(new Date(2026, 0, 5)), /^2026-01-05$/);
  assert.equal(todayLeaveDay(new Date("nonsense")), null);
  assert.equal(todayLeaveDay("nonsense"), null);
  assert.match(todayLeaveDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test("leave: leave ending TODAY is still current, not history", () => {
  // The boundary the employee would expect: today is not yet over.
  assert.equal(isLeavePast(leave({ endsOn: TODAY }), TODAY), false);
  const { current, history } = groupLeaveByWhen([leave({ endsOn: TODAY })], TODAY);
  assert.deepEqual(current.map((r) => r.id), ["lv"]);
  assert.equal(history.length, 0);
});

test("leave: only an end date strictly before today is history", () => {
  const spans = [
    ["yesterday", "2026-10-01", true],
    ["tomorrow", "2026-10-03", false],
    ["today", "2026-10-02", false],
    ["far past", "2020-01-01", true],
    ["far future", "2099-12-31", false],
  ];
  for (const [label, endsOn, expected] of spans) {
    assert.equal(isLeavePast(leave({ endsOn }), TODAY), expected, `${label} (${endsOn})`);
  }
  // A multi-day leave that is still running is current, and so is one that ENDS
  // today even though it started last month.
  assert.equal(isLeavePast(leave({ startsOn: "2026-09-20", endsOn: "2026-10-05" }), TODAY), false);
  assert.equal(isLeavePast(leave({ startsOn: "2026-09-20", endsOn: TODAY }), TODAY), false);
  // The year boundary is just another day boundary.
  assert.equal(isLeavePast(leave({ startsOn: "2025-12-30", endsOn: "2026-01-02" }), "2026-01-01"), false);
  assert.equal(isLeavePast(leave({ startsOn: "2025-12-30", endsOn: "2025-12-31" }), "2026-01-01"), true);
});

test("leave: a request we cannot place in time stays visible rather than disappearing", () => {
  // The safe direction: an unreadable or missing end date must NOT be filed away
  // into history, and must not be dropped either.
  for (const endsOn of [null, undefined, "", "not-a-date", "2026-02-30", "20261002", 20261002]) {
    assert.equal(isLeavePast(leave({ endsOn }), TODAY), false, `endsOn=${String(endsOn)}`);
  }
  // A missing/invalid "today" disables the split rather than marking everything past.
  assert.equal(isLeavePast(leave({ endsOn: "2020-01-01" }), null), false);
  assert.equal(isLeavePast(leave({ endsOn: "2020-01-01" }), "nonsense"), false);
  // Every such row still appears in one of the two sections.
  const { current, history } = groupLeaveByWhen([leave({ id: "a", endsOn: null }), leave({ id: "b" })], TODAY);
  assert.equal(current.length + history.length, 2);
});

test("leave: grouping splits by end date and loses nothing", () => {
  const rows = [
    leave({ id: "past-approved", startsOn: "2026-08-01", endsOn: "2026-08-05", status: "approved" }),
    leave({ id: "ends-today", startsOn: "2026-09-28", endsOn: TODAY, status: "approved" }),
    leave({ id: "future", startsOn: "2026-12-24", endsOn: "2026-12-26", status: "requested" }),
    leave({ id: "past-declined", startsOn: "2026-07-01", endsOn: "2026-07-02", status: "declined" }),
  ];
  const { current, history } = groupLeaveByWhen(rows, TODAY);

  assert.deepEqual(current.map((r) => r.id).sort(), ["ends-today", "future"]);
  assert.deepEqual(history.map((r) => r.id).sort(), ["past-approved", "past-declined"]);
  // Nothing is dropped and nothing is duplicated: the union is the input.
  assert.equal(current.length + history.length, rows.length);
  assert.deepEqual([...current, ...history].map((r) => r.id).sort(), rows.map((r) => r.id).sort());
  // The rows themselves are handed back untouched — grouping does not rewrite them.
  for (const original of rows) {
    const found = [...current, ...history].find((r) => r.id === original.id);
    assert.deepEqual(found, original);
  }
  // An empty or absent list is still safe.
  assert.deepEqual(groupLeaveByWhen([], TODAY), { current: [], history: [] });
  assert.deepEqual(groupLeaveByWhen(null, TODAY), { current: [], history: [] });
});

test("leave: current & upcoming are ordered nearest first", () => {
  const rows = [
    leave({ id: "far", startsOn: "2027-03-01", endsOn: "2027-03-05" }),
    leave({ id: "running", startsOn: "2026-09-20", endsOn: "2026-10-06" }),
    leave({ id: "soonest", startsOn: TODAY, endsOn: TODAY }),
  ];
  assert.deepEqual(sortLeaveUpcoming(rows).map((r) => r.id), ["running", "soonest", "far"]);
  // A leave already under way comes before one that has not begun — the ordering
  // that matches "what is happening next".
  const grouped = groupLeaveByWhen(rows, TODAY).current;
  assert.deepEqual(grouped.map((r) => r.id), ["running", "soonest", "far"]);
  // Sorting is pure and never drops a row.
  assert.deepEqual(rows.map((r) => r.id), ["far", "running", "soonest"]);
  // An undated row sorts last instead of jumping to the front.
  assert.equal(sortLeaveUpcoming([leave({ id: "no-start", startsOn: undefined }), leave({ id: "dated", startsOn: "2026-10-01" })])[0].id, "dated");
});

test("leave: history is ordered most recently ended first", () => {
  const rows = [
    leave({ id: "oldest", endsOn: "2025-11-30" }),
    leave({ id: "newest", endsOn: "2026-09-30" }),
    leave({ id: "middle", endsOn: "2026-06-15" }),
  ];
  assert.deepEqual(sortLeaveHistory(rows).map((r) => r.id), ["newest", "middle", "oldest"]);
  assert.deepEqual(rows.map((r) => r.id), ["oldest", "newest", "middle"]);
  assert.deepEqual(groupLeaveByWhen(rows, TODAY).history.map((r) => r.id), ["newest", "middle", "oldest"]);
});

test("leave: a past APPROVED request stays in history and stays approved", () => {
  // The two requirements that must never regress: history is a view, not a
  // lifecycle. Dates passing does not edit, decline, or hide anything.
  const decided = leave({
    id: "past-approved",
    startsOn: "2026-08-01",
    endsOn: "2026-08-05",
    status: "approved",
    decidedAt: "2026-07-20T10:00:00.000Z",
  });
  const { current, history } = groupLeaveByWhen([decided], TODAY);

  assert.equal(current.length, 0, "an ended request is not listed as current");
  assert.equal(history.length, 1, "but it is still there");
  const shown = history[0];
  assert.equal(shown.status, "approved", "status is untouched by the dates");
  assert.equal(shown.decidedAt, "2026-07-20T10:00:00.000Z", "the decision is still shown");
  assert.equal(leaveStatusLabel(shown.status), "Approved");
  assert.equal(isPendingLeave(shown), false, "it did not become pending again");
  assert.match(leaveDecisionLabel(shown), /Approv/);
  // And it is never silently removed from the list.
  assert.match(leaveRangeLabel(shown), /1 Aug 2026/);
});

test("leave: grouping never rewrites a status in either direction", () => {
  const rows = [
    leave({ id: "a", endsOn: "2020-01-01", status: "requested" }),
    leave({ id: "b", endsOn: "2020-01-01", status: "approved" }),
    leave({ id: "c", endsOn: "2020-01-01", status: "declined" }),
    leave({ id: "d", endsOn: TODAY, status: "requested" }),
    leave({ id: "e", endsOn: TODAY, status: "approved" }),
    leave({ id: "f", endsOn: TODAY, status: "declined" }),
  ];
  const before = rows.map((r) => `${r.id}:${r.status}`).sort();
  const { current, history } = groupLeaveByWhen(rows, TODAY);
  const after = [...current, ...history].map((r) => `${r.id}:${r.status}`).sort();
  assert.deepEqual(after, before, "every status survives grouping unchanged");
  // Each section keeps all three meanings available.
  assert.equal(new Set([...current, ...history].map((r) => r.status)).size, 3);
});

test("leave: the boundary holds under a far-off timezone", () => {
  // The whole off-by-one risk: a viewer whose clock is a day ahead or behind must
  // still see a leave ending "today" as current, because the stored day is a
  // wall-clock "YYYY-MM-DD" and never an instant. Run in a child process so the
  // machine timezone cannot mask it.
  const script = `
    import { groupLeaveByWhen, isLeavePast } from ${JSON.stringify(new URL("../lib/employeeLeave.mjs", import.meta.url).href)};
    const day = (d) => "2026-10-0" + d;
    const out = [];
    for (const endsOn of [day(1), day(2), day(3)]) {
      const { current, history } = groupLeaveByWhen(
        [{ id: "r", startsOn: endsOn, endsOn, status: "approved", createdAt: "2026-09-01T00:00:00.000Z" }],
        day(2),
      );
      out.push([endsOn, isLeavePast({ endsOn }, day(2)), current.length, history.length].join(":"));
    }
    console.log(JSON.stringify(out));
  `;
  const results = {};
  for (const tz of ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "America/Chicago", "Asia/Tokyo"]) {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    });
    results[tz] = JSON.parse(out.trim().split("\n").pop());
  }
  // Identical in every timezone: yesterday=history, today=current, tomorrow=current.
  const expected = ["2026-10-01:true:0:1", "2026-10-02:false:1:0", "2026-10-03:false:1:0"];
  for (const [tz, got] of Object.entries(results)) {
    assert.deepEqual(got, expected, `TZ=${tz} must classify identically`);
  }
});

// ---- the page uses the split, and only the split ----

test("leave: the employee page renders both sections from the same grouping", () => {
  const page = code(EMPLOYEE_PAGE);
  assert.match(page, /groupLeaveByWhen/, "the page must split on the end date");
  assert.match(page, /Current & Upcoming Leave/);
  assert.match(page, /Leave History/);
  // A single shared card component renders both sections, so a history row carries
  // exactly the same information as a current one.
  assert.match(page, /function LeaveCard/);
  assert.match(page, /function LeaveSection/);
  // Still every piece of information requirement asks for, in the card.
  assert.match(page, /leaveStatusLabel\(request\.status\)/, "status stays visible");
  assert.match(page, /leaveRangeLabel\(request\)/, "date range stays visible");
  assert.match(page, /leaveKindLabel\(request\)/, "leave type stays visible");
  assert.match(page, /request\.note/, "note stays visible");
  assert.match(page, /leaveDecisionLabel\(request\)/, "decision info stays visible");
  // And the empty state is preserved for a genuinely empty list.
  assert.match(page, /LEAVE_EMPTY_TITLE/);
  assert.match(page, /LEAVE_EMPTY_BODY/);
  assert.match(page, /current\.length === 0 && history\.length === 0/);
});

test("leave: the grouping is display-only — no status is derived from a date", () => {
  const page = code(EMPLOYEE_PAGE);
  const helper = code("../lib/employeeLeave.mjs");
  for (const [name, src] of [["page", page], ["helpers", helper]]) {
    // No date may rewrite a status, and nothing may be sent or deleted.
    assert.equal(/status\s*[:=]\s*[^,}]*isLeavePast/.test(src), false, `${name} must not set status from a date`);
    assert.equal(/status\s*=\s*["'](approved|declined|requested)["']/.test(src), false, `${name} must not assign a status`);
    assert.equal(/method:\s*["'](PUT|PATCH|DELETE)["']/.test(src), false, `${name} must not mutate anything`);
    assert.equal(/\bdecidedById\b/.test(src), false, `${name} must not touch the decision fields`);
  }
  // isLeavePast returns a boolean and only reads endsOn/today: it is a predicate,
  // never a mutation.
  assert.match(helper, /export function isLeavePast\(request, today\)/);
});

test("leave: no new field or endpoint was introduced for the split", () => {
  const page = code(EMPLOYEE_PAGE);
  const hook = code(HOOK);
  // The split reads `endsOn`, which the existing GET already returns. No new query,
  // no new param, no client-side "isPast" the server would have to agree with.
  assert.match(page, /endsOn/);
  assert.equal(/isPast|archived|hideOld|showHistory\s*=/.test(page + hook), false);
  assert.match(hook, /["'`]\/employee\/leave["'`]/, "the same single endpoint as before");
  assert.equal(/admin\/leave/.test(page + hook), false, "the admin workflow is untouched");
});
