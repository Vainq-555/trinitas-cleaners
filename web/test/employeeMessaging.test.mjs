import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COUNTERPART_TYPES,
  counterpartBadge,
  counterpartSubtitle,
  isEmployeeThread,
} from "../lib/threadCounterpart.mjs";

// PHASE 2B-3 — employee <-> admin messaging (web layer).
//
// The security-critical rules live in the API (see api/test/employeeMessaging.test.js
// and the pre-existing api/test/messages.test.js). This file covers the frontend
// contract: the employee page must REUSE the existing endpoints, must not offer a
// recipient choice, must not filter or widen the thread client-side, and must show
// honest loading/empty/error/unauthorized states. It also covers the admin-side
// employee labeling added by this phase.
//
// Wiring tests read the production sources with comments stripped, so a negative
// assertion ("must not have a recipient picker") cannot be satisfied by prose.

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const code = (rel) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

const page = code("../app/employee/messages/page.jsx");
const adminPage = code("../app/admin/messages/page.jsx");
const nav = code("../lib/employeeNav.jsx");

const m = (over = {}) => ({
  id: "m1",
  senderId: "emp1",
  receiverId: "adm1",
  content: "hello",
  readAt: null,
  createdAt: "2026-09-26T10:00:00Z",
  sender: { id: "emp1", name: "Erin", role: "employee" },
  ...over,
});

// =================== counterpart labeling helpers ===================

test("isEmployeeThread: only the server's employee role is an employee thread", () => {
  assert.equal(isEmployeeThread({ counterpartType: COUNTERPART_TYPES.EMPLOYEE }), true);
  assert.equal(isEmployeeThread({ counterpartType: "employee" }), true);
  assert.equal(isEmployeeThread({ counterpartType: COUNTERPART_TYPES.CUSTOMER }), false);
});

test("isEmployeeThread: a missing counterpartType is NOT treated as an employee", () => {
  // Fail-safe toward the pre-Phase-2B-3 behavior: absent metadata must not
  // invent an employee conversation.
  assert.equal(isEmployeeThread({}), false);
  assert.equal(isEmployeeThread(undefined), false);
  assert.equal(isEmployeeThread(null), false);
  assert.equal(isEmployeeThread({ counterpartType: "Employee" }), false, "labeling is exact, not case-guessed");
  assert.equal(isEmployeeThread({ counterpartType: "admin" }), false);
  assert.equal(isEmployeeThread({ counterpartType: "supervisor" }), false);
});

test("counterpartBadge: employee vs customer wording", () => {
  assert.equal(counterpartBadge({ counterpartType: "employee" }), "Employee");
  assert.equal(counterpartBadge({ counterpartType: "customer" }), "Customer");
  assert.equal(counterpartBadge(undefined), "Customer");
});

test("counterpartSubtitle: employee vs customer wording", () => {
  assert.equal(counterpartSubtitle({ counterpartType: "employee" }), "Employee conversation");
  assert.equal(counterpartSubtitle({ counterpartType: "customer" }), "Customer conversation");
  assert.equal(counterpartSubtitle(undefined), "Customer conversation");
});

test("the label is never derived from a name, email or display string", () => {
  // An employee called "Customer Support" stays an employee; the helper reads
  // only counterpartType and never looks at these fields.
  const helper = source("../lib/threadCounterpart.mjs");
  const fn = helper.slice(helper.indexOf("export function isEmployeeThread"));
  assert.equal(fn.includes(".name"), false, "labeling must not read a display name");
  assert.equal(fn.includes(".email"), false, "labeling must not read an email");
});

// =================== employee Contact Admin page ===================

test("the Contact Admin page exists at the employee route", () => {
  assert.match(page, /title="Contact Admin"/);
  assert.match(page, /sections=\{\["Employee Portal"\]\}/);
  assert.match(page, /<Shell/);
});

test("the Contact Admin page reuses the EXISTING message endpoints", () => {
  // No new backend surface for this phase: the same three endpoints the
  // customer portal already uses.
  assert.match(page, /api\("\/messages\/with\/admin"\)/);
  assert.match(page, /api\(`\/messages\/read\/\$\{[a-zA-Z.]+\}`, \{ method: "POST" \}\)/);
  assert.match(page, /api\("\/messages", \{/);
  assert.equal(/api\("\/employee\//.test(page), false, "no employee-specific messaging endpoint should exist");
});

test("the Contact Admin page offers NO recipient choice", () => {
  // The employee has exactly one destination (ADMIN), designated by the server.
  // Any of these affordances would let the CLIENT pick a recipient. (The
  // `receiverId: admin.id` payload itself is required to send, and is asserted
  // separately to come from the server's own admin row.)
  for (const forbidden of [
    "<select",
    "<option",
    'type="number"',
    "recipientId",
    "setReceiver",
    "setRecipient",
    "userId",
    "employeeId",
    "Search",
    "search",
  ]) {
    assert.equal(page.includes(forbidden), false, `Contact Admin must not contain ${forbidden}`);
  }
  // Exactly one receiverId usage exists, and it is the admin row.
  const receivers = page.match(/receiverId/g) ?? [];
  assert.equal(receivers.length, 1, "the page must reference receiverId exactly once");
});

test("the recipient is the server-returned admin, never a hardcoded id", () => {
  // receiverId may only come from the `admin` row the server sent. A literal
  // id in the request would pin the page to one specific admin account.
  assert.match(page, /setAdmin\(a\)/);
  assert.match(page, /receiverId: admin\.id/);
  const literalIds = page.match(/receiverId:\s*"[^"]+"/);
  assert.equal(literalIds, null, "receiverId must never be a literal id");
});

test("the Contact Admin page shows an empty state and a way to send the first message", () => {
  assert.match(page, /No messages with the admin yet\./);
  // The composer is rendered outside the message list, so it is available on
  // the empty state — that IS the way to send the first message.
  assert.match(page, /messages\.length === 0/);
  assert.match(page, /<form/);
  assert.match(page, /placeholder=/);
});

test("the Contact Admin page has honest loading, error and unauthorized states", () => {
  assert.match(page, /Loading messages/);
  assert.match(page, /loadError/);
  assert.match(page, /role="alert"/);
  // 401/403 must be a sign-in prompt, never an empty thread.
  assert.match(page, /loadError\?\.status === 401 \|\| loadError\?\.status === 403/);
  assert.match(page, /no longer active/);
  assert.match(page, /href="\/login"/);
});

test("the Contact Admin page has sending and send-error states", () => {
  assert.match(page, /setSending\(true\)/);
  assert.match(page, /setSending\(false\)/);
  assert.match(page, /setSendError\(err\)/);
  assert.match(page, /not sent/);
});

test("the composer blocks empty and whitespace-only messages", () => {
  // Guarded in the handler and reflected in the disabled state of the button.
  assert.match(page, /if \(!draft\.trim\(\)/);
  assert.match(page, /disabled=\{sending \|\| !draft\.trim\(\)/);
});

test("sent vs received alignment comes from the server-returned sender id", () => {
  assert.match(page, /m\.sender\.id === myId/);
  assert.match(page, /const mine = /);
});

test("the Contact Admin page marks the admin's messages read after load", () => {
  assert.match(page, /messages\/read\//);
  // Best-effort: a read-state failure must not replace a readable thread.
  assert.match(page, /catch\(\(\) => \{\}\)/);
});

test("the Contact Admin page filters or paginates nothing client-side", () => {
  // A frontend filter is not authorization, and truncating the thread would
  // hide real messages from the employee.
  assert.equal(/\.filter\(/.test(page), false, "the page must not filter the returned messages");
  assert.equal(/take:|\.slice\(/.test(page), false, "the page must not truncate the thread");
  assert.match(page, /Array\.isArray\(d\?\.messages\)/);
});

test("the Contact Admin page builds no attachments, realtime or typing indicators", () => {
  for (const forbidden of [
    "FormData",
    "multipart",
    "WebSocket",
    "EventSource",
    "socket",
    "typing",
    "reaction",
    "<img",
    "attachment",
  ]) {
    assert.equal(page.includes(forbidden), false, `Contact Admin must not add ${forbidden}`);
  }
  // Polling-free: it loads on mount, not on an interval.
  assert.equal(page.includes("setInterval"), false, "no polling for this phase");
});

test("the Contact Admin page is mobile-first and avoids horizontal overflow", () => {
  assert.equal(page.includes("<table"), false, "a message thread must not use a table");
  assert.equal(/overflow-x-auto/.test(page), false, "no sideways scrolling on a phone");
  assert.match(page, /max-w-\[75%\]/);
});

test("the Contact Admin page uses the shared employee nav", () => {
  assert.match(page, /employeeNavLinks\(/);
  // Not a private nav list.
  assert.equal(/const links = \[/.test(page), false, "the page must not redefine its own nav");
});

// =================== employee navigation ===================

test("the shared employee nav exposes Contact Admin", () => {
  assert.match(nav, /href: "\/employee\/messages"/);
  assert.match(nav, /label: "Contact Admin"/);
  assert.match(nav, /MessageSquare/);
});

test("the employee nav offers exactly the built employee destinations", () => {
  const hrefs = [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  // Phase 2B-4 added My Availability and Available Shifts; Phase 2B-5 added the
  // employee Community; employee leave added My Leave; employee resignation added
  // Resignation. The list is exact so a new destination cannot be added without
  // this test being updated too.
  assert.deepEqual(hrefs, [
    "/employee",
    "/employee/assignments",
    "/employee/availability",
    "/employee/shifts",
    "/employee/leave",
    "/employee/resignation",
    "/employee/community",
    "/employee/broadcasts",
    "/employee/messages",
  ]);
  for (const href of hrefs) {
    assert.match(href, /^\/employee(\/|$)/, `employee nav must not link outside /employee: ${href}`);
  }
  // STRUCTURAL guard, stronger than any list of forbidden words: every nav
  // destination must resolve to a page that actually exists. A forbidden-word
  // list can only catch the names someone thought of in advance, so a link to a
  // renamed or newly-hypothesised page would slip through it; this cannot.
  // This is what now enforces "no unbuilt feature" in place of the old
  // "shifts"/"availability" string checks, which Phase 2B-4 made obsolete.
  for (const href of hrefs) {
    const page = href === "/employee" ? "app/employee/page.jsx" : `app${href}/page.jsx`;
    assert.ok(
      readFileSync(new URL(`../${page}`, import.meta.url), "utf8"),
      `nav destination ${href} has no page — every nav entry must be a real route`,
    );
  }
});

test("the employee nav exposes no customer, admin or still-unbuilt employee destination", () => {
  // Phase 2B-4 BUILT availability and shifts, and Phase 2B-5 BUILT the employee
  // community, so none of them is forbidden any more. profile, payroll and time
  // tracking are still unbuilt and must stay out of the nav: a link to a page
  // that does not exist is a 404.
  for (const forbidden of [
    "/dashboard",
    "/admin",
    "profile",
    "payroll",
    "time",
  ]) {
    assert.equal(nav.includes(forbidden), false, `employee nav must not link to ${forbidden}`);
  }
});

// =================== admin-side employee labeling ===================

test("the admin page labels an employee conversation as an employee", () => {
  assert.match(adminPage, /isEmployeeThread\(t\)/);
  assert.match(adminPage, /counterpartBadge\(t\)/);
  assert.match(adminPage, /counterpartSubtitle\(/);
  assert.match(
    source("../app/admin/messages/page.jsx"),
    /from "@\/lib\/threadCounterpart\.mjs"/,
    "the admin page must use the shared labeling helper",
  );
});

test("the admin page still reads the pre-existing `customer` field", () => {
  // Backward compatibility: existing consumers keep working, nothing renamed.
  assert.match(adminPage, /t\.customer\.id/);
  assert.match(adminPage, /t\.customer\.name/);
});

test("the admin page no longer asserts the thread is a customer", () => {
  // The pre-Phase-2B-3 customer-only wording is gone from the messaging view.
  for (const stale of [
    "No customer conversations yet.",
    "Reply to this customer",
    "Reply directly to customers about",
  ]) {
    assert.equal(adminPage.includes(stale), false, `the admin messaging view must not still say: ${stale}`);
  }
  assert.match(adminPage, /No conversations yet\./);
});

test("the admin reply path is unchanged and role-agnostic", () => {
  // An admin replies with receiverId = the open counterpart, which may now be an
  // employee. The server allows it; the client must not restrict it to customers.
  assert.match(adminPage, /receiverId: active/);
  assert.match(adminPage, /api\("\/messages", \{/);
  const noRoleFilter = !/role === "customer"|counterpartType === "customer"/.test(adminPage);
  assert.equal(noRoleFilter, true, "the admin must not be restricted to customer threads");
});

test("the admin page reads the thread counterpart the server returned, with no client inference", () => {
  // No user lookup/search to guess a role in the browser.
  for (const forbidden of ["/admin/employees", "search", "Search"]) {
    assert.equal(adminPage.includes(forbidden), false, `the admin page must not contain ${forbidden}`);
  }
});
