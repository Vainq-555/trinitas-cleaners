import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AVAILABILITY_DISCLAIMER,
  AVAILABILITY_EMPTY_BODY,
  AVAILABILITY_EMPTY_TITLE,
  availabilityDateLabel,
  availabilityKindLabel,
  availabilityWindowLabel,
  groupByDate,
  isUnavailable,
  sortAvailability,
  timeTo12Hour,
} from "../lib/employeeAvailability.mjs";
import {
  REQUEST_STATUS,
  SHIFTS_EMPTY_BODY,
  SHIFTS_EMPTY_TITLE,
  canRequestShift,
  requestStatusClass,
  requestStatusLabel,
  shiftUnavailableReason,
} from "../lib/employeeShifts.mjs";

// Phase 2B-4 — employee availability + available shifts view helpers, and
// production wiring regressions.
//
// The pure helpers are unit-tested directly. The wiring tests read the
// production .jsx sources and fail if the portal ever starts re-deciding
// authorization in the browser, stops inheriting the employee guard, or begins
// showing a request as an assignment.

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// The same source with comments removed. Negative assertions ("must not send an
// employeeId", "must not claim a request assigns work") must not fire on an
// explanatory comment that names the very rule being upheld.
const code = (rel) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

// The body of a function declared EITHER as `export function name(...)` or as a
// local `const name = (...) => {` / `const name = async (...) => {`, so an
// assertion scoped to one form cannot be satisfied by a different one.
const fnBody = (rel, name) => {
  const c = code(rel);
  const start = [
    `export function ${name}(`,
    `function ${name}(`,
    `const ${name} = (`,
    `const ${name} = async (`,
  ].reduce(
    (best, p) => {
      const at = c.indexOf(p);
      return at === -1 ? best : best === -1 ? at : Math.min(best, at);
    },
    -1,
  );
  assert.notEqual(start, -1, `${rel} must define ${name}()`);
  const open = c.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < c.length; i += 1) {
    if (c[i] === "{") depth += 1;
    if (c[i] === "}") {
      depth -= 1;
      if (depth === 0) return c.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name} in ${rel}`);
};

const row = (over = {}) => ({
  id: "a1",
  date: "2026-09-28",
  startTime: "09:00",
  endTime: "13:00",
  kind: "available",
  note: null,
  ...over,
});

// ───────────────────────────────────────────── 12-hour time rendering

test("timeTo12Hour renders wall-clock times the way a US employee reads them", () => {
  assert.equal(timeTo12Hour("09:00"), "9 AM");
  assert.equal(timeTo12Hour("13:00"), "1 PM");
  assert.equal(timeTo12Hour("00:00"), "12 AM");
  assert.equal(timeTo12Hour("12:00"), "12 PM");
  assert.equal(timeTo12Hour("09:30"), "9:30 AM");
  assert.equal(timeTo12Hour("17:45"), "5:45 PM");
});

test("timeTo12Hour rejects out-of-range and malformed times rather than guessing", () => {
  for (const bad of ["24:00", "09:60", "9:00", "09:0", "", null, undefined, 900, "0900"]) {
    assert.equal(timeTo12Hour(bad), null, `${JSON.stringify(bad)} must not render`);
  }
});

test("availabilityWindowLabel never invents a range from unparseable times", () => {
  assert.equal(availabilityWindowLabel(row()), "9 AM – 1 PM");
  assert.equal(availabilityWindowLabel(row({ endTime: "25:00" })), "Invalid time range");
  assert.equal(availabilityWindowLabel({}), "Invalid time range");
});

// ───────────────────────────────────────────── kind

test("isUnavailable only treats the server's own 'unavailable' as unavailable", () => {
  assert.equal(isUnavailable(row({ kind: "unavailable" })), true);
  assert.equal(isUnavailable(row({ kind: "available" })), false);
  assert.equal(availabilityKindLabel(row({ kind: "unavailable" })), "Unavailable");
  assert.equal(availabilityKindLabel(row({ kind: "available" })), "Available");
});

// ───────────────────────────────────────────── ordering + grouping

test("sortAvailability orders by date then start time, without mutating the input", () => {
  const input = [
    row({ id: "b", date: "2026-09-29", startTime: "08:00" }),
    row({ id: "c", date: "2026-09-28", startTime: "13:00" }),
    row({ id: "a", date: "2026-09-28", startTime: "09:00" }),
  ];
  const before = input.map((r) => r.id);
  const out = sortAvailability(input).map((r) => r.id);
  assert.deepEqual(out, ["a", "c", "b"]);
  assert.deepEqual(input.map((r) => r.id), before, "input must not be reordered in place");
});

test("groupByDate groups each day once and keeps chronological order", () => {
  const groups = groupByDate([
    row({ id: "b", date: "2026-09-29" }),
    row({ id: "a", date: "2026-09-28" }),
    row({ id: "c", date: "2026-09-28", startTime: "14:00" }),
  ]);
  assert.deepEqual(groups.map((g) => g.date), ["2026-09-28", "2026-09-29"]);
  assert.deepEqual(groups[0].items.map((r) => r.id), ["a", "c"]);
});

test("groupByDate and sortAvailability tolerate an absent list", () => {
  assert.deepEqual(sortAvailability(undefined), []);
  assert.deepEqual(sortAvailability(null), []);
  assert.deepEqual(groupByDate(undefined), []);
  assert.deepEqual(groupByDate(null), []);
});

test("availabilityDateLabel renders the stored day, independent of the viewer's clock", () => {
  assert.equal(availabilityDateLabel("2026-09-28"), "Mon, September 28, 2026");
  // A non-"YYYY-MM-DD" string is passed through rather than shown as "Invalid Date".
  assert.equal(availabilityDateLabel("nonsense"), "nonsense");
  assert.equal(availabilityDateLabel(undefined), "");
});

test("the availability disclaimer says availability does not guarantee work", () => {
  assert.match(AVAILABILITY_DISCLAIMER, /does not guarantee/i);
  assert.match(AVAILABILITY_DISCLAIMER, /assigned work/i);
  assert.ok(AVAILABILITY_EMPTY_TITLE.length > 0);
  assert.ok(AVAILABILITY_EMPTY_BODY.length > 0);
});

// ───────────────────────────────────────────── request status

test("requestStatusLabel reports each request state in the employee's words", () => {
  assert.equal(requestStatusLabel(REQUEST_STATUS.REQUESTED), "Requested");
  assert.equal(requestStatusLabel(REQUEST_STATUS.APPROVED), "Approved");
  assert.equal(requestStatusLabel(REQUEST_STATUS.DECLINED), "Declined");
});

test("an unknown request status is reported as pending, never as a decision", () => {
  // A status added by a future release must not be silently reported as an
  // approval, so the employee is never told they have work they do not have.
  assert.equal(requestStatusLabel("cancelled"), "Requested");
  assert.equal(requestStatusLabel(undefined), "Requested");
  assert.equal(requestStatusLabel("APPROVED"), "Requested");
});

test("each request status renders differently, so they are not visually ambiguous", () => {
  const classes = [REQUEST_STATUS.REQUESTED, REQUEST_STATUS.APPROVED, REQUEST_STATUS.DECLINED].map(
    requestStatusClass,
  );
  assert.equal(new Set(classes).size, 3, "statuses must be visually distinguishable");
});

test("requestStatusClass falls back to the pending style for an unknown status", () => {
  assert.equal(requestStatusClass("weird"), requestStatusClass(REQUEST_STATUS.REQUESTED));
});

// ───────────────────────────────────────────── claimability

test("canRequestShift is true only when the server says so and no request exists", () => {
  assert.equal(canRequestShift({ canRequest: true, myRequest: null }), true);
  // The server said no: the browser must not offer the button.
  assert.equal(canRequestShift({ canRequest: false, myRequest: null }), false);
  // Already asked: asking twice is a duplicate, not a second request.
  assert.equal(
    canRequestShift({ canRequest: true, myRequest: { status: REQUEST_STATUS.REQUESTED } }),
    false,
  );
  assert.equal(
    canRequestShift({ canRequest: true, myRequest: { status: REQUEST_STATUS.DECLINED } }),
    false,
  );
});

test("canRequestShift never infers permission — a missing server answer is not a yes", () => {
  // No `canRequest` field at all (e.g. an older server): default to not claimable.
  assert.equal(canRequestShift({ myRequest: null }), false);
  assert.equal(canRequestShift({ canRequest: "true", myRequest: null }), false);
  assert.equal(canRequestShift({ canRequest: 1, myRequest: null }), false);
  assert.equal(canRequestShift(null), false);
  assert.equal(canRequestShift(undefined), false);
});

test("shiftUnavailableReason explains a blocked shift from the server's own facts", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();

  assert.equal(
    shiftUnavailableReason({ myRequest: { status: REQUEST_STATUS.DECLINED } }),
    "You already requested this shift — declined.",
  );
  assert.equal(shiftUnavailableReason({ closesAt: past, canRequest: false }), "This shift is closed for requests.");
  assert.equal(
    shiftUnavailableReason({ assignedEmployeeId: "e2", canRequest: false }),
    "This shift has already been assigned.",
  );
  assert.equal(shiftUnavailableReason({ canRequest: false }), "This shift is not open for requests.");
  // A claimable shift has no reason to block it.
  assert.equal(shiftUnavailableReason({ canRequest: true, myRequest: null, closesAt: future }), null);
  assert.equal(shiftUnavailableReason(null), null);
});

test("an already-assigned shift is explained as assigned, never as claimable", () => {
  const assigned = { canRequest: false, assignedEmployeeId: "e2", myRequest: null };
  assert.equal(canRequestShift(assigned), false);
  assert.match(shiftUnavailableReason(assigned), /already been assigned/i);
  assert.ok(SHIFTS_EMPTY_TITLE.length > 0);
  assert.ok(SHIFTS_EMPTY_BODY.length > 0);
});

// ───────────────────────────────────────────── availability page wiring

test("the availability page states that availability does not reserve work", () => {
  const page = code("../app/employee/availability/page.jsx");
  assert.ok(page.includes("AVAILABILITY_DISCLAIMER"), "the disclaimer must be shown on the page");
});

test("the availability page never sends an employeeId, because the server owns the identity", () => {
  const hook = code("../lib/useEmployeeAvailability.js");
  const page = code("../app/employee/availability/page.jsx");
  for (const [name, src] of [
    ["hook", hook],
    ["page", page],
  ]) {
    assert.ok(!/employeeId/.test(src), `the availability ${name} must not reference an employeeId`);
  }
});

test("the availability hook addresses the session-scoped API only", () => {
  const hook = code("../lib/useEmployeeAvailability.js");
  assert.ok(hook.includes('"/employee/availability"'), "must read the session-scoped list");
  assert.ok(hook.includes('method: "POST"'));
  assert.ok(hook.includes('method: "PATCH"'));
  assert.ok(hook.includes('method: "DELETE"'));
});

test("the availability page rejects an end time that is not after the start", () => {
  const validate = fnBody("../app/employee/availability/page.jsx", "validate");
  assert.match(
    validate,
    /startTime\s*>=\s*(\w+\.)?endTime/,
    "the end-must-be-after-start rule must be checked before sending",
  );
  // And it must actually be called on submit, not merely defined.
  assert.ok(
    code("../app/employee/availability/page.jsx").includes("validate(form)"),
    "the rule must be enforced on submit",
  );
});

test("the availability page distinguishes a load failure from genuinely no availability", () => {
  const page = code("../app/employee/availability/page.jsx");
  assert.ok(page.includes("could not load"), "a failed load must not read as an empty schedule");
  assert.ok(page.includes("temporary problem"), "the error must say it is temporary");
  assert.ok(page.includes("Try again"), "a failed load must offer a retry");
});

test("a 401/403 on availability is shown as a sign-in prompt, not as an empty schedule", () => {
  const hook = code("../lib/useEmployeeAvailability.js");
  const page = code("../app/employee/availability/page.jsx");
  assert.match(hook, /error\?\.status === 401 \|\| error\?\.status === 403/);
  assert.ok(page.includes("unauthorized"), "the page must handle the unauthorized case");
  assert.ok(page.includes('href="/login"'), "the unauthorized case must offer a way back in");
});

// ───────────────────────────────────────────── shifts page wiring

test("the shifts hook offers no way to request on another employee's behalf", () => {
  const hook = code("../lib/useEmployeeShifts.js");
  assert.ok(!/employeeId/.test(hook), "the hook must not reference an employeeId");
  assert.ok(!/body:\s*\{[^}]*employeeId/.test(hook));
});

test("the shifts hook posts to the server-owned request route", () => {
  const hook = code("../lib/useEmployeeShifts.js");
  assert.ok(hook.includes("/request"), "must post to the request route");
  assert.ok(hook.includes('method: "POST"'));
  assert.ok(hook.includes("/employee/shifts"), "must read the session-scoped shift list");
});

test("the shifts hook re-reads the server's answer instead of trusting a local guess", () => {
  const hook = code("../lib/useEmployeeShifts.js");
  // After a request, the page reloads rather than patching state from a value
  // it computed itself, so the view can only ever show what the server returned.
  assert.ok(hook.includes("await load()"), "must reload the server's state after requesting");
  assert.ok(hook.includes("canRequestShift"), "claimability is decided by the shared server-answer rule");
});

test("the shifts page never tells an employee that a request assigns work", () => {
  const page = code("../app/employee/shifts/page.jsx");
  const hook = code("../lib/useEmployeeShifts.js");
  // The page may only say a request was sent, and must not promise work.
  assert.ok(/Request sent/.test(page), "the confirmation must be a request confirmation");
  assert.ok(
    /does not assign/i.test(page),
    "the UI must say plainly that requesting does not assign",
  );
  // A stronger false claim, in any casing, is a bug.
  assert.ok(!/you (are|have been) assigned/i.test(page), "the UI must not claim an assignment");
  assert.ok(!/you (are|have been) assigned/i.test(hook));
  assert.ok(
    !/(guaranteed|you will (get|have) this)/i.test(page),
    "the UI must not promise the shift",
  );
});

test("the shifts page renders the start time in the business timezone", () => {
  const page = code("../app/employee/shifts/page.jsx");
  assert.ok(page.includes("formatChicagoSchedule"), "must render via the shared timezone helper");
  assert.ok(
    !/toLocaleTimeString\(\)/.test(page),
    "must not render a bare browser-local time string",
  );
});

test("the shifts page renders stacked cards so a shift is usable on a phone", () => {
  const page = source("../app/employee/shifts/page.jsx");
  assert.ok(!/<table/.test(page), "shifts must not require horizontal scrolling on a phone");
  assert.match(page, /space-y-4/);
});

test("a failed shift load is not presented as an empty list", () => {
  const page = code("../app/employee/shifts/page.jsx");
  assert.ok(page.includes("could not load"), "a failed load must not read as no shifts");
  assert.ok(page.includes("temporary problem, not an empty list"));
  assert.ok(page.includes("Try again"));
});

test("the shifts page falls back to the empty state only when the server returned none", () => {
  const page = code("../app/employee/shifts/page.jsx");
  // Every failure state is checked BEFORE the empty state, so the empty state
  // can only be reached on a successful load that genuinely returned no rows.
  // `lastIndexOf` is used throughout because some of these expressions also
  // appear in the summary sentence above the render chain, and it is the RENDER
  // CHAIN whose ordering is what matters.
  const order = ["loading ?", "unauthorized ?", "error ?", "shifts.length === 0"].map((needle) => ({
    needle,
    pos: page.lastIndexOf(needle),
  }));
  for (const { needle, pos } of order) {
    assert.notEqual(pos, -1, `expected the render chain to include ${needle}`);
  }
  const positions = order.map((o) => o.pos);
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    `the empty state must come last, after every failure state: ${order.map((o) => o.needle).join(" -> ")}`,
  );
});

test("both employee pages inherit the employee layout guard", () => {
  const layout = code("../app/employee/layout.jsx");
  assert.match(layout, /RequireEmployee|requireEmployee/, "the layout must guard employee routes");
  // And the pages themselves do not re-implement a weaker guard.
  for (const page of [
    "../app/employee/availability/page.jsx",
    "../app/employee/shifts/page.jsx",
  ]) {
    const src = code(page);
    assert.ok(
      !src.includes("role === \"ADMIN\"") && !src.includes("role === \"CUSTOMER\""),
      `${page} must not hand-roll a role check`,
    );
  }
});

// ───────────────────────────────────────────── nav

test("the employee nav offers exactly the seven destinations that exist, in order", () => {
  const nav = source("../lib/employeeNav.jsx");
  const hrefs = [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [
    "/employee",
    "/employee/assignments",
    "/employee/availability",
    "/employee/shifts",
    "/employee/community",
    "/employee/broadcasts",
    "/employee/messages",
  ]);
});

test("the employee nav exposes no customer or admin destination", () => {
  const nav = source("../lib/employeeNav.jsx");
  for (const href of [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(!href.startsWith("/admin"), "the employee nav must not link to the admin portal");
    assert.ok(!href.startsWith("/booking"), "the employee nav must not link to customer booking");
  }
});

test("the employee nav offers no link to a page that does not exist", () => {
  const nav = source("../lib/employeeNav.jsx");
  const hrefs = [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    const file = href === "/employee" ? "../app/employee/page.jsx" : `../app${href}/page.jsx`;
    assert.doesNotThrow(
      () => readFileSync(new URL(file, import.meta.url), "utf8"),
      `${href} has no page`,
    );
  }
});

test("the new employee pages appear in the nav, so they are reachable", () => {
  const nav = source("../lib/employeeNav.jsx");
  assert.match(nav, /href: "\/employee\/availability"/);
  assert.match(nav, /href: "\/employee\/shifts"/);
});

// ───────────────────────────────────────────── admin page wiring

test("the admin shifts page exists and reaches the admin-only endpoints", () => {
  const page = code("../app/admin/shifts/page.jsx");
  for (const path of [
    '"/admin/shifts"',
    '"/admin/shifts/candidates"',
    '"/admin/availability"',
  ]) {
    assert.ok(page.includes(path), `the admin page must call ${path}`);
  }
  // The decide call must be built from the shift id AND the request id, and
  // must choose approve/decline from the same `approve` argument it branches on.
  const decide = fnBody("../app/admin/shifts/page.jsx", "decide");
  assert.match(decide, /\/admin\/shifts\/\$\{encodeURIComponent\(shift\.id\)\}/);
  assert.match(decide, /\/request\/\$\{encodeURIComponent\(request\.id\)\}/);
  assert.match(decide, /\$\{approve \? "approve" : "decline"\}/);
});

test("approving from the admin page sends explicit reassignment confirmation", () => {
  const page = code("../app/admin/shifts/page.jsx");
  assert.ok(
    page.includes("confirmReassignment: true"),
    "approval must confirm a possible reassignment rather than silently take work",
  );
});

test("the admin shifts page requires an explicit booking choice, defaulting to none", () => {
  const page = code("../app/admin/shifts/page.jsx");
  assert.ok(page.includes('bookingId: ""'), "the form must not pre-select a booking");
  assert.ok(page.includes("Choose a booking to offer"), "an empty choice must be reported");
});

test("the admin page never presents availability as a booking constraint", () => {
  const page = code("../app/admin/shifts/page.jsx");
  assert.ok(page.includes("AVAILABILITY_DISCLAIMER"), "availability stays informational for the admin too");
});
