import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMPTY_BODY,
  EMPTY_TITLE,
  isUnread,
  typeLabel,
  unreadCount,
  unreadCountFromLabel,
  unreadPill,
} from "../lib/employeeBroadcasts.mjs";
import { announcementNavLabel } from "../lib/employeeNavLabels.mjs";

// Phase 2B-2 — employee announcements: view helpers + production wiring.
//
// The pure helpers are unit-tested. The wiring tests read the production sources
// and fail if the employee portal ever grows a client-side audience filter, reads
// another employee's announcements, or shows "no announcements" while loading.

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Comments stripped, so a negative assertion ("must not filter by audience")
// cannot be satisfied — or defeated — by prose that merely names the rule.
const code = (rel) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

const fnBody = (rel, name) => {
  const c = code(rel);
  const start = c.indexOf(`export function ${name}(`);
  assert.ok(start > -1, `${rel} must still export ${name}`);
  return c.slice(start);
};

const b = (over = {}) => ({
  id: "b1",
  type: "announcement",
  title: "Staff meeting",
  content: "Friday 9am",
  createdAt: "2026-09-20T12:00:00Z",
  read: false,
  ...over,
});

// ---- unread state is derived only from what the server sent ----

test("isUnread: a missing read flag counts as UNREAD, never as read", () => {
  // Fail-safe: the employee re-sees a message rather than silently losing track
  // of one they never acknowledged.
  assert.equal(isUnread(b({ read: false })), true);
  assert.equal(isUnread(b({ read: true })), false);
  assert.equal(isUnread(b({ read: undefined })), true);
  assert.equal(isUnread({}), true);
  assert.equal(isUnread(undefined), true);
});

test("unreadCount: counts exactly the unread rows the API returned", () => {
  assert.equal(unreadCount([]), 0);
  assert.equal(unreadCount([b({ id: "1" }), b({ id: "2", read: true }), b({ id: "3" })]), 2);
});

test("unreadCount: a malformed response counts 0 rather than throwing or inventing a number", () => {
  assert.equal(unreadCount(undefined), 0);
  assert.equal(unreadCount(null), 0);
  assert.equal(unreadCount({ broadcasts: [1, 2] }), 0, "an object is not a list");
  assert.equal(unreadCount("nope"), 0);
});

test("unreadPill: renders a badge only while unread", () => {
  assert.equal(unreadPill(b({ read: false })), "New");
  assert.equal(unreadPill(b({ read: true })), null, "a read item shows no misleading pill");
});

test("typeLabel: matches the customer feed's announcement/notification wording", () => {
  assert.equal(typeLabel(b({ type: "announcement" })), "Announcement");
  assert.equal(typeLabel(b({ type: "notification" })), "Notification");
  // Unknown/absent type falls back to the safe, non-alarming label.
  assert.equal(typeLabel(b({ type: undefined })), "Announcement");
});

test("empty-state copy is employee-specific and free of customer/payment terms", () => {
  assert.equal(EMPTY_TITLE, "No announcements right now.");
  assert.match(EMPTY_BODY, /administrator posts an announcement for employees/i);
  for (const word of ["booking", "receipt", "payment", "invoice", "order", "stripe"]) {
    assert.equal(
      `${EMPTY_TITLE} ${EMPTY_BODY}`.toLowerCase().includes(word),
      false,
      `employee announcement copy must not use ${word}`,
    );
  }
});

// ---- the nav badge must reflect a real count ----

test("announcementNavLabel: shows a real count, and omits it at zero", () => {
  assert.equal(announcementNavLabel(0), "Announcements", "no distracting (0)");
  assert.equal(announcementNavLabel(1), "Announcements (1)");
  assert.equal(announcementNavLabel(7), "Announcements (7)");
});

test("announcementNavLabel: a missing or nonsensical count shows no badge, never a fake one", () => {
  for (const bad of [undefined, null, NaN, -1, "abc", {}]) {
    assert.equal(
      announcementNavLabel(bad),
      "Announcements",
      `count=${JSON.stringify(bad)} must not produce a badge`,
    );
  }
});

test("the nav label and the unread count provably agree", () => {
  // Ties the badge string to the real data, so the number on screen can be
  // traced back to the server response.
  for (const list of [[], [b({ read: true })], [b({ id: "1" }), b({ id: "2" }), b({ id: "3", read: true })]]) {
    const label = announcementNavLabel(unreadCount(list));
    assert.equal(unreadCountFromLabel(label), unreadCount(list));
  }
});

// =================== production wiring regression ===================

const page = source("../app/employee/broadcasts/page.jsx");
const pageCode = code("../app/employee/broadcasts/page.jsx");
const hook = source("../lib/useEmployeeBroadcasts.js");
const hookCode = code("../lib/useEmployeeBroadcasts.js");
const nav = source("../lib/employeeNav.jsx");
const navCode = code("../lib/employeeNav.jsx");
const adminPage = source("../app/admin/broadcasts/page.jsx");
const adminCode = code("../app/admin/broadcasts/page.jsx");
const adminNavCode = code("../lib/adminNav.jsx");
const dashboardCode = code("../app/employee/page.jsx");
const listPageCode = code("../app/employee/assignments/page.jsx");
const layout = source("../app/employee/layout.jsx");

test("the announcements page reads only the employee announcements endpoint", () => {
  assert.match(hookCode, /api\("\/employee\/broadcasts"\)/);
  // No customer feed, no public feed, no admin endpoint reachable from the
  // employee portal.
  for (const forbidden of ['"/broadcasts/mine"', '"/broadcasts/public"', '"/admin/broadcasts"']) {
    assert.equal(hookCode.includes(forbidden), false, `the employee hook must not call ${forbidden}`);
    assert.equal(pageCode.includes(forbidden), false, `the employee page must not call ${forbidden}`);
  }
});

test("the employee portal never filters announcements by audience client-side", () => {
  // Audience separation is the server's job. A client-side filter would be
  // theatre: the rows were already scoped by audience on the way out.
  for (const [name, src] of [
    ["announcements page", pageCode],
    ["hook", hookCode],
  ]) {
    assert.equal(/\.filter\(/.test(src), false, `${name} must not filter the announcement list`);
    assert.equal(/audience/.test(src), false, `${name} must not re-implement the audience rule`);
  }
});

test("the employee portal can never ask for another employee's announcements", () => {
  for (const [name, src] of [
    ["announcements page", pageCode],
    ["hook", hookCode],
  ]) {
    assert.equal(/userId/.test(src), false, `${name} must not send a user id`);
    assert.equal(/employeeId/.test(src), false, `${name} must not send an employee id`);
  }
  // The mark-read call is by broadcast id only.
  assert.match(hookCode, /api\(`\/employee\/broadcasts\/\$\{id\}\/read`, \{ method: "POST" \}\)/);
});

test("mark-as-read only ever marks the session employee's own announcement", () => {
  // The optimistic local update is scoped to the clicked id, and the request
  // carries no identity of its own.
  assert.match(hookCode, /setBroadcasts\(\(prev\) => prev\.map\(\(b\) => \(b\.id === id/);
  // A failed mark must not be faked as successful: the item stays unread.
  assert.match(hookCode, /catch \(err\) \{/);
});

test("loading, error, unauthorized and empty are distinct states", () => {
  for (const fragment of ["loading", "error", "unauthorized", "EMPTY_TITLE"]) {
    assert.match(pageCode, new RegExp(fragment), `announcements page must handle ${fragment}`);
  }
  // The main render chain must be ordered so the empty case is reached only after
  // a completed, successful load. Otherwise a slow or failed request would be
  // shown to the employee as an empty inbox, which is a false statement about
  // their account rather than a cosmetic issue.
  // lastIndexOf is used because the unread banner is a separate, earlier guard on
  // the same three flags.
  const at = (needle, fromEnd = true) => {
    const i = fromEnd ? pageCode.lastIndexOf(needle) : pageCode.indexOf(needle);
    assert.ok(i > -1, `announcements page must branch on ${needle}`);
    return i;
  };
  const order = [
    at("loading ?"),
    at("unauthorized ?"),
    at("error ?"),
    at("broadcasts.length === 0 ?", false),
  ];
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `branch "${i}" must come after the one before it`);
  }
  // The unread-count banner is gated the same way, so no count is ever shown for a
  // request that has not succeeded.
  assert.match(
    page,
    /\{!loading && !error && !unauthorized \? \(/,
    "the unread banner must not render before a successful load",
  );
  // And the empty state really renders the copy (a use, not just an import).
  assert.match(page, /\{EMPTY_TITLE\}/);
  assert.match(page, /\{EMPTY_BODY\}/);
  assert.match(hookCode, /status === 401 \|\| error\?\.status === 403/);
});

test("the employee nav is defined once and lists exactly the three built destinations", () => {
  // One definition, used by all three pages — so the nav cannot drift.
  assert.match(navCode, /export function employeeNavLinks/);
  for (const href of ['"/employee"', '"/employee/assignments"', '"/employee/broadcasts"']) {
    assert.ok(navCode.includes(href), `nav must include ${href}`);
  }
  for (const [name, src] of [
    ["nav", navCode],
    ["announcements page", pageCode],
    ["dashboard", dashboardCode],
    ["assignments page", listPageCode],
  ]) {
    assert.equal(
      /const links = \[/.test(src),
      false,
      `${name} must not redefine the nav inline; it must import employeeNavLinks`,
    );
  }
  for (const [name, src] of [
    ["announcements page", pageCode],
    ["dashboard", dashboardCode],
    ["assignments page", listPageCode],
  ]) {
    assert.match(src, /employeeNavLinks\(/, `${name} must use the shared nav`);
  }
});

test("the employee nav exposes no unbuilt feature and no customer/admin destination", () => {
  // Phase 2B-4 built availability and shifts, and Phase 2B-5 built the employee
  // community, so none of them is forbidden any more. Everything here is still
  // UNBUILT and must stay out of the nav.
  for (const forbidden of [
    "/dashboard",
    "/admin",
    "announcements/settings",
    "profile",
  ]) {
    assert.equal(navCode.includes(forbidden), false, `employee nav must not link to ${forbidden}`);
  }
  // STRUCTURAL replacement for the "no unbuilt feature" string checks that
  // Phase 2B-4 made obsolete: every destination must resolve to a page that
  // exists. This catches an unbuilt or misnamed page that no forbidden list
  // would have anticipated.
  const hrefs = [...navCode.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    const page = href === "/employee" ? "app/employee/page.jsx" : `app${href}/page.jsx`;
    assert.ok(
      readFileSync(new URL(`../${page}`, import.meta.url), "utf8"),
      `nav destination ${href} has no page — every nav entry must be a real route`,
    );
  }
});

test("the employee announcements page stays inside the existing shell and design system", () => {
  assert.match(page, /<Shell/);
  assert.match(page, /sections=\{\["Employee Portal"\]\}/);
  // Reuses the existing card/badge classes rather than introducing new styling.
  for (const cls of ["announcement-card", "brand-light", "warnbg", "empty-state"]) {
    assert.ok(page.includes(cls), `should reuse the existing ${cls} styling`);
  }
  // Mobile-first: stacked, wrapping, no table.
  assert.equal(/<table/.test(page), false);
  assert.match(page, /break-words/);
});

test("the announcements page renders title, message, date and unread state", () => {
  for (const fragment of ["b.title", "b.content", "b.createdAt", "unreadPill", "typeLabel"]) {
    assert.ok(page.includes(fragment), `should render ${fragment}`);
  }
});

test("the employee announcements route inherits the RequireEmployee guard", () => {
  // Nested under app/employee/layout.jsx, so no second guard is duplicated here.
  assert.match(layout, /RequireEmployee/);
  assert.equal(/requireEmployee|authenticate|useAuth\(/.test(pageCode), false,
    "the page must not re-implement its own auth check");
});

test("the admin UI states the audience explicitly and never offers a bare 'All'", () => {
  // Audience is chosen and stored explicitly on the form.
  assert.match(adminCode, /audience: "customer"/);
  assert.match(adminCode, /setAudience/);
  assert.match(adminCode, /<option value="customer">Customers<\/option>/);
  assert.match(adminCode, /<option value="employee">Employees<\/option>/);
  // The four required, unambiguous labels.
  for (const label of ["All customers", "All employees", "A specific customer", "A specific employee"]) {
    assert.ok(adminCode.includes(label), `admin target options must offer "${label}"`);
  }
  // A bare "All" is exactly the ambiguous wording this phase forbids. Checked
  // against the actual option label strings inside TARGET_OPTIONS, not a guessed
  // markup shape and not the unrelated admin nav labels.
  const optionsStart = adminCode.indexOf("const TARGET_OPTIONS");
  const optionsEnd = adminCode.indexOf("};", optionsStart);
  assert.ok(optionsStart > -1 && optionsEnd > optionsStart, "the admin page must define TARGET_OPTIONS");
  const targetOptions = adminCode.slice(optionsStart, optionsEnd);
  const optionLabels = [...targetOptions.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(optionLabels.length >= 5, `expected the target option labels, got ${JSON.stringify(optionLabels)}`);
  for (const label of optionLabels) {
    assert.notEqual(label.trim().toLowerCase(), "all", 'a bare "All" option is not acceptable');
    // Every option must make its audience clear: the public site, or an explicit
    // mention of customers or employees.
    assert.match(
      label,
      /public|customers?|employees?/i,
      `option "${label}" does not state an audience`,
    );
  }
  // Switching audience resets target and clears the recipient, so a customer id
  // can never be submitted while the audience says employee.
  assert.match(adminCode, /setForm\(\{ \.\.\.form, audience, target: TARGET_OPTIONS\[audience\]\[0\]\.value, userId: "" \}\)/);
});

test("the admin UI never offers an employee announcement to the public site", () => {
  // The employee target list has no `public` option at all.
  const employeeOptions = adminCode.slice(
    adminCode.indexOf("employee: ["),
    adminCode.indexOf("],", adminCode.indexOf("employee: [")),
  );
  assert.ok(employeeOptions.length > 0, "the employee target list must exist");
  assert.equal(employeeOptions.includes("public"), false,
    "an employee announcement must not be publishable to the public site");
  // The customer list still offers it, so existing behavior is preserved.
  assert.match(adminCode, /customer: \[[\s\S]*?\{ value: "public", label: "Public main site" \}/);
});

test("the admin recipient picker is audience-correct and lists disabled employees honestly", () => {
  // The employee branch reads /admin/employees; the customer branch unchanged.
  assert.match(adminCode, /api\("\/admin\/employees"\)/);
  assert.match(adminCode, /isEmployee\s*\?\s*employees\.map/);
  // A disabled employee is labelled, because they genuinely will not receive it
  // (they cannot sign in) — the UI must not imply otherwise.
  assert.match(adminCode, /emp\.disabledAt \? " — disabled" : ""/);
  assert.match(adminCode, /cannot sign in/);
});

test("the admin history labels each row's audience, so nothing reads as a bare 'All'", () => {
  assert.match(adminCode, /"All employees"/);
  assert.match(adminCode, /"All customers"/);
  assert.match(adminCode, /Specific employee/);
  assert.match(adminCode, /Specific customer/);
  // Still one shared Shell, and the nav now comes from the shared admin helper
  // rather than an inline copy on this page.
  assert.match(adminCode, /sections=\{\["Admin Portal"\]\}/);
  assert.match(adminCode, /adminNavLinks\(\)/);
  assert.match(
    adminNavCode,
    /\{ href: "\/admin\/broadcasts", label: "Broadcasts", icon: Megaphone \}/,
  );
});

test("the admin page still sends every field the create endpoint requires", () => {
  // The form object must carry audience alongside the pre-existing fields.
  assert.match(adminCode, /EMPTY_FORM = \{ type: "announcement", audience: "customer", target: "all", title: "", content: "", userId: "" \}/);
  assert.match(adminCode, /api\("\/admin\/broadcasts", \{ method: "POST", body: form \}\)/);
});

test("the existing customer announcement UI is untouched by this phase", () => {
  const customerPage = source("../app/announcements/page.jsx");
  const customerDash = source("../app/dashboard/page.jsx");
  // Both still call the pre-existing customer endpoints.
  assert.match(customerPage, /api\("\/broadcasts\/public"\)/);
  assert.match(customerDash, /api\("\/broadcasts\/mine"\)/);
  // The customer dashboard's type badge (which depends on b.type surviving the
  // narrowed employee projection not touching the customer one) is intact.
  assert.match(customerDash, /b\.type === "announcement"/);
});
