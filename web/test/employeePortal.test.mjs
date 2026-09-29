import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_EMPTY_BODY,
  DASHBOARD_EMPTY_TITLE,
  NO_LOCATION_TEXT,
  NO_START_TIME_TEXT,
  assignedServiceLabel,
  assignedStart,
  hasInstructions,
  isScheduled,
  locationLines,
  requestedDate,
  visibleAssignmentCount,
} from "../lib/employeeAssignments.mjs";

// Phase 2B-1 — employee portal: view helpers + production wiring regression.
//
// The pure helpers are unit-tested directly. The wiring tests read the
// production .jsx sources and fail if the employee portal ever reverts to
// filtering client-side, loses its authorization guard, or starts borrowing the
// customer's requested time as the employee's schedule.

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// The same source with comments removed. Negative assertions ("must not
// reference visibleToEmployee", "must not call a second endpoint") must not fire
// on an explanatory comment that names the very rule being upheld, so they run
// against code only.
const code = (rel) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

// The body of an exported function, so an assertion about one wrapper cannot be
// satisfied by a different one.
const fnBody = (rel, name) => {
  const c = code(rel);
  const start = c.indexOf(`export function ${name}(`);
  assert.ok(start > -1, `${rel} must still export ${name}`);
  return c.slice(start);
};

const t = (s) => new Date(s);

// A full assignment exactly as GET /employee/assignments returns it.
const assignment = (over = {}) => ({
  id: "as1",
  assignedAt: t("2026-09-27T00:00:00Z"),
  scheduledStartAt: t("2026-09-30T15:00:00Z"),
  booking: {
    id: "bk1",
    requestedDate: t("2026-10-05T00:00:00Z"),
    service: { id: "sv1", name: "Deep Clean", description: "Top to bottom, inside appliances." },
    location: {
      addressLine1: "123 Maple St",
      addressLine2: "Apt 4B",
      city: "St Paul",
      state: "MN",
      postalCode: "55101",
      country: "USA",
      instructions: "Gate code 1234. Park in the driveway.",
    },
    customer: { name: "Alice Nguyen", phone: "(612) 555-0142" },
  },
  ...over,
});

// ---- the assigned schedule comes from the ASSIGNMENT, never the booking ----

test("assignedStart: reads the employee's own scheduledStartAt", () => {
  const start = assignedStart(assignment());
  assert.ok(start, "a scheduled assignment yields a formatted start");
  assert.equal(start.timezone, "America/Chicago");
  assert.match(start.date, /September/);
  // 2026-09-30 15:00Z in the business timezone (CDT, UTC-5) is 10:00 local.
  // A UTC or browser-local render would show a different number, so this also
  // pins the schedule to the business timezone rather than the viewer's.
  assert.equal(start.time, "10:00 AM");
  assert.match(start.date, /Sep/);
});

test("assignedStart: an unscheduled assignment reports NO start, never a borrowed time", () => {
  const start = assignedStart(assignment({ scheduledStartAt: null }));
  assert.equal(start, null, "no admin-set start time means no assigned time");
  assert.equal(isScheduled(assignment({ scheduledStartAt: null })), false);
  assert.equal(NO_START_TIME_TEXT, "No start time set yet");
});

test("assignedStart: the customer's requested date is never used as the assigned schedule", () => {
  // The requested date is a different day entirely, so a substitution would be
  // obvious in the rendered output.
  const a = assignment();
  const start = assignedStart(a);
  assert.notEqual(start, null);
  const requested = requestedDate(a);
  assert.notEqual(requested.getTime(), new Date(a.scheduledStartAt).getTime());
  assert.equal(requested.getUTCDate(), 5, "the requested date is preserved as its own value");
});

test("assignedStart: a garbage or missing start is treated as unscheduled, never as an Invalid Date", () => {
  for (const bad of [undefined, null, "", "not-a-date", {}, 0]) {
    assert.equal(assignedStart(assignment({ scheduledStartAt: bad })), null);
  }
  assert.equal(assignedStart(undefined), null);
  assert.equal(assignedStart(null), null);
  assert.equal(assignedStart({}), null);
});

test("isScheduled: true only for a valid admin-set start", () => {
  assert.equal(isScheduled(assignment()), true);
  assert.equal(isScheduled(assignment({ scheduledStartAt: "nope" })), false);
});

// ---- the customer's requested date stays separate context ----

test("requestedDate: returns a valid date or null, never an Invalid Date", () => {
  assert.equal(requestedDate(assignment()).getUTCFullYear(), 2026);
  assert.equal(requestedDate(assignment({ booking: { requestedDate: "junk" } })), null);
  assert.equal(requestedDate(assignment({ booking: {} })), null);
  assert.equal(requestedDate({}), null);
  assert.equal(requestedDate(undefined), null);
});

// ---- location formatting ----

test("locationLines: formats a full address and drops blank optional lines", () => {
  assert.deepEqual(locationLines(assignment().booking.location), [
    "123 Maple St",
    "Apt 4B",
    "St Paul, MN 55101",
    "USA",
  ]);
});

test("locationLines: an absent address line 2 and country do not render empty lines", () => {
  const lines = locationLines({
    addressLine1: "9 Elm St",
    addressLine2: null,
    city: "Anoka",
    state: "MN",
    postalCode: "55303",
    country: null,
  });
  assert.deepEqual(lines, ["9 Elm St", "Anoka, MN 55303"]);
});

test("locationLines: a fully empty location yields no lines (never a blank line)", () => {
  assert.deepEqual(locationLines({}), []);
  assert.deepEqual(locationLines(null), []);
  assert.deepEqual(locationLines(undefined), []);
  assert.deepEqual(locationLines({ addressLine1: "  ", city: "" }), []);
});

test("locationLines: a missing state or postal code degrades gracefully", () => {
  assert.deepEqual(locationLines({ addressLine1: "1 Oak St", city: "Duluth" }), ["1 Oak St", "Duluth"]);
  assert.deepEqual(locationLines({ addressLine1: "1 Oak St", state: "WI", postalCode: "54701" }), [
    "1 Oak St",
    "WI 54701",
  ]);
});

// ---- instructions ----

test("hasInstructions: only a real, non-blank instruction counts", () => {
  assert.equal(hasInstructions(assignment()), true);
  assert.equal(hasInstructions(assignment({ booking: { location: { instructions: "   " } } })), false);
  assert.equal(hasInstructions(assignment({ booking: { location: {} } })), false);
  assert.equal(hasInstructions(assignment({ booking: {} })), false);
  assert.equal(hasInstructions(undefined), false);
});

// ---- counts come only from what the server returned ----

test("visibleAssignmentCount: counts exactly the rows the API sent", () => {
  assert.equal(visibleAssignmentCount([]), 0);
  assert.equal(visibleAssignmentCount([assignment()]), 1);
  assert.equal(visibleAssignmentCount([assignment(), assignment({ id: "as2" })]), 2);
});

test("visibleAssignmentCount: a malformed response counts 0 rather than throwing", () => {
  assert.equal(visibleAssignmentCount(undefined), 0);
  assert.equal(visibleAssignmentCount(null), 0);
  assert.equal(visibleAssignmentCount({ assignments: [1, 2] }), 0, "an object is not a list of assignments");
});

test("assignedServiceLabel: correct singular/plural copy", () => {
  assert.equal(assignedServiceLabel(0), "0 assigned services");
  assert.equal(assignedServiceLabel(1), "1 assigned service");
  assert.equal(assignedServiceLabel(2), "2 assigned services");
});

test("empty-state copy stays employee-specific and contains no customer/payment terms", () => {
  assert.equal(DASHBOARD_EMPTY_TITLE, "No services assigned yet");
  assert.match(DASHBOARD_EMPTY_BODY, /administrator assigns/i);
  for (const word of ["booking", "receipt", "payment", "invoice", "order"]) {
    assert.equal(
      `${DASHBOARD_EMPTY_TITLE} ${DASHBOARD_EMPTY_BODY}`.toLowerCase().includes(word),
      false,
      `employee copy must not use customer terminology: ${word}`,
    );
  }
  assert.equal(NO_LOCATION_TEXT, "No service location on file");
});

// =================== production wiring regression ===================

const dashboard = source("../app/employee/page.jsx");
const listPage = source("../app/employee/assignments/page.jsx");
const card = source("../components/EmployeeAssignmentCard.jsx");
const layout = source("../app/employee/layout.jsx");
const hook = source("../lib/useEmployeeAssignments.js");
const dashboardCode = code("../app/employee/page.jsx");
const listPageCode = code("../app/employee/assignments/page.jsx");
const cardCode = code("../components/EmployeeAssignmentCard.jsx");

// ---- the /employee access matrix (Phase 2B-1 requirement) ----
//
// `lib/auth.jsx` is JSX, so it cannot be imported by `node --test`. These
// assertions pin the redirect matrix against the real source instead, so a
// regression in who may reach /employee is caught rather than assumed. The
// server remains the actual authority (see api/src/middleware/auth.js); this
// only verifies the client-side gate.

test("RequireEmployee sends an unauthenticated visitor to /login", () => {
  const body = fnBody("../lib/auth.jsx", "RequireEmployee");
  assert.match(body, /if \(!user\) window\.location\.href = "\/login"/);
});

test("RequireEmployee denies a customer and an admin, sending each to their own home", () => {
  const body = fnBody("../lib/auth.jsx", "RequireEmployee");
  // A wrong role is never allowed through, and is routed by role rather than
  // dumped on /employee.
  assert.match(body, /else if \(user\.role !== "employee"\)/);
  assert.match(body, /window\.location\.href = homeForRole\(user\.role\)/);
  // Only an employee is allowed to render the children.
  assert.match(body, /else setChecked\(true\)/);
  const guard = body.indexOf('user.role !== "employee"');
  const allow = body.indexOf("else setChecked(true)");
  assert.ok(guard < allow, "the role check must precede the allow branch");
});

test("RequireEmployee renders a loader instead of the page until the check completes", () => {
  const body = fnBody("../lib/auth.jsx", "RequireEmployee");
  // Guards against a flash of the employee page before the role is known.
  assert.match(body, /if \(loading \|\| !checked\) return <PageLoader \/>/);
});

test("an employee's own home is /employee, so the guard cannot redirect-loop", () => {
  const auth = code("../lib/auth.jsx");
  // The three roles keep distinct destinations; customer and admin are unchanged.
  assert.match(auth, /customer:\s*"\/dashboard"/);
  assert.match(auth, /admin:\s*"\/admin"/);
  assert.match(auth, /employee:\s*"\/employee"/);
  // An employee allowed into /employee is therefore never bounced away from it.
  assert.match(auth, /ROLE_HOME\[role\] \|\| "\/dashboard"/);
});

test("the employee layout keeps guarding every /employee route with RequireEmployee", () => {
  assert.match(layout, /RequireEmployee/);
  // The new /employee/assignments route is nested under the same layout, so it
  // inherits the guard and needs no second, duplicated one.
  assert.equal(/authenticate|useAuth\(/.test(layout), false, "the layout must not re-implement its own auth check");
});

test("both employee pages read the assignments from the existing employee endpoint", () => {
  assert.match(hook, /api\("\/employee\/assignments"\)/);
  // No second, competing assignment source may appear.
  for (const [name, page] of [["dashboard", dashboard], ["list page", listPage]]) {
    assert.equal(
      /api\("\/(?!employee\/assignments)/.test(page),
      false,
      `${name} must only call the employee assignments endpoint`,
    );
  }
});

test("the employee portal never filters assignments client-side", () => {
  // Authorization and visibility are the server's job. A client-side filter is
  // explicitly not a substitute, so neither page may branch on an assignment
  // field to decide what is visible.
  for (const [name, page] of [["dashboard", dashboardCode], ["list page", listPageCode]]) {
    assert.equal(
      /\.filter\(/.test(page),
      false,
      `${name} must not filter assignments; the server already scoped the list`,
    );
    assert.equal(
      /visibleToEmployee/.test(page),
      false,
      `${name} must not re-implement the visibleToEmployee rule`,
    );
  }
});

test("the employee pages never filter by another employee's id", () => {
  for (const [name, page] of [["dashboard", dashboardCode], ["list page", listPageCode]]) {
    assert.equal(/employeeId/.test(page), false, `${name} must not send or read an employee id`);
  }
});

test("the assigned schedule is rendered from the assignment, not the booking", () => {
  // The card must read assignment.scheduledStartAt via the helper, and must not
  // reach into a customer-requested time.
  assert.match(card, /assignedStart\(assignment\)/);
  assert.equal(
    /booking\.scheduledStartAt/.test(cardCode),
    false,
    "the card must never read Booking.scheduledStartAt (the customer's requested time)",
  );
  // The customer's requested date may appear, but only clearly labelled as their
  // request — never as the employee's schedule.
  assert.match(card, /Customer requested/);
});

test("the card renders every field an employee needs, and nothing extra", () => {
  for (const fragment of [
    "Your assigned start",
    "Customer requested",
    "Service location",
    "Location instructions",
    "Customer phone",
    "Service details",
    "NO_START_TIME_TEXT",
    "NO_LOCATION_TEXT",
    "locationLines",
    "hasInstructions",
  ]) {
    assert.ok(card.includes(fragment), `card should render/use ${fragment}`);
  }
  // The narrow customer projection the API returns: name + phone only.
  assert.match(card, /customer\.name/);
  assert.match(card, /customer\.phone/);
  // Nothing the employee must never see.
  for (const forbidden of [
    "customer.email",
    "passwordHash",
    "email",
    "stripe",
    "Stripe",
    "receipt",
    "Receipt",
    "payment",
    "total",
    "price",
    "tax",
    "assignedById",
    "booking.customerId",
  ]) {
    assert.equal(
      cardCode.includes(forbidden),
      false,
      `the employee card must not reference ${forbidden}`,
    );
  }
});

test("loading, error, unauthorized and empty are distinct states on both pages", () => {
  // Each page must render a loading, a failure, an unauthorized and an empty
  // state — the four outcomes of one request, which must never be conflated.
  for (const [name, page] of [["dashboard", dashboard], ["list page", listPage]]) {
    for (const fragment of ["loading", "error", "unauthorized", "DASHBOARD_EMPTY_TITLE"]) {
      assert.match(page, new RegExp(fragment), `${name} must handle ${fragment}`);
    }
    // The hook derives `unauthorized` from the HTTP status, not by guessing.
    assert.match(hook, /status === 401 \|\| error\?\.status === 403/);
  }

  // The empty state is gated, so it is unreachable while a request is in flight
  // or after one failed. Otherwise a slow or broken request would be shown to the
  // employee as "no work assigned", which reads as a false statement about their
  // schedule.
  assert.match(
    dashboard,
    /empty=\{!loading && !error && !unauthorized && count === 0\}/,
    "the dashboard empty state must be gated on a completed, successful load",
  );
  // The list page checks the states in order and only reaches `count === 0` last.
  const chain = listPageCode.slice(listPageCode.indexOf("loading ?"));
  assert.ok(chain.length > 0, "list page must branch on loading first");
  const order = ["unauthorized", "error", "count === 0"].map((needle) => chain.indexOf(needle));
  assert.ok(
    order[0] > -1 && order[1] > order[0] && order[2] > order[1],
    "list page must check unauthorized, then error, and only then the empty case",
  );
});

test("employee navigation exposes only built employee destinations", () => {
  // The nav is defined ONCE in lib/employeeNav.jsx (Phase 2B-2) and consumed by
  // every employee page, so it is asserted there rather than duplicated per page.
  // Each page must still *use* the shared definition.
  const nav = code("../lib/employeeNav.jsx");
  for (const [name, page] of [["dashboard", dashboardCode], ["list page", listPageCode]]) {
    assert.match(page, /employeeNavLinks\(/, `${name} must use the shared employee nav`);
  }
  // Every destination the nav offers must be a real employee route.
  const hrefs = [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    assert.match(href, /^\/employee(\/|$)/, `employee nav must not link outside /employee: ${href}`);
  }
  // STRUCTURAL "no unbuilt feature" guard, stronger than a forbidden-word list:
  // every destination must resolve to a page that actually exists. Phase 2B-4
  // built availability and shifts, so the old string checks naming them became
  // obsolete; this replaces them without losing the protection, because a
  // forbidden list can only ever catch the names someone anticipated.
  for (const href of hrefs) {
    const page = href === "/employee" ? "app/employee/page.jsx" : `app${href}/page.jsx`;
    assert.ok(
      readFileSync(new URL(`../${page}`, import.meta.url), "utf8"),
      `nav destination ${href} has no page — every nav entry must be a real route`,
    );
  }
  assert.ok(hrefs.includes("/employee"), "the Dashboard entry must exist");
  assert.ok(hrefs.includes("/employee/assignments"), "My Assigned Services must exist");
  // Phase 2B-4 also built My Availability and Available Shifts, so both must
  // now be present and reachable from the shared nav.
  assert.ok(hrefs.includes("/employee/availability"), "My Availability must exist");
  assert.ok(hrefs.includes("/employee/shifts"), "Available Shifts must exist");
  // No customer-only or admin-only destination, and no link to an unbuilt
  // employee feature (profile, time...). Phase 2B-4 BUILT availability and
  // shifts, and Phase 2B-5 BUILT the employee community, so none of them is
  // forbidden any more.
  // NOTE: /login is deliberately NOT forbidden — the pages link there when the
  // employee session is unauthorized, which is correct behavior.
  for (const forbidden of [
    "/dashboard",
    "/admin",
    "profile",
    "time",
  ]) {
    assert.equal(nav.includes(forbidden), false, `employee nav must not link to ${forbidden}`);
    for (const [name, page] of [["dashboard", dashboardCode], ["list page", listPageCode]]) {
      assert.equal(page.includes(forbidden), false, `${name} must not link to ${forbidden}`);
    }
  }
});

test("the employee pages use the shared Shell (existing portal chrome + logout)", () => {
  for (const [name, page] of [["dashboard", dashboard], ["list page", listPage]]) {
    assert.match(page, /<Shell/);
    assert.match(page, /sections=\{\["Employee Portal"\]\}/);
  }
});

test("the employee pages are mobile-first and avoid horizontal overflow", () => {
  for (const [name, page] of [["dashboard", dashboardCode], ["list page", listPageCode], ["card", cardCode]]) {
    // Stacked cards, not a wide table; responsive columns only from md/sm up.
    assert.equal(/<table/.test(page), false, `${name} must not use a table`);
  }
  // Long values (addresses, names, phone numbers) wrap rather than forcing the
  // page to scroll sideways on a phone.
  assert.match(card, /break-words/);
  // The list uses a responsive grid, not a fixed multi-column layout.
  assert.match(listPage, /grid gap-4 md:grid-cols-2/);
});
