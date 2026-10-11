import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMUNITY_LIMIT_DEFAULT,
  COMMUNITY_LIMIT_MAX,
  COMMUNITY_MESSAGE_MAX_LENGTH,
  EMPTY_BODY,
  EMPTY_TITLE,
  ERROR_TITLE,
  authorLabel,
  contentError,
  draftDisabledReason,
  isOwnPost,
  isRemoved,
  removedCount,
} from "../lib/employeeCommunity.mjs";
import * as community from "../lib/community.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const post = (overrides = {}) => ({
  id: "p1",
  content: "hello team",
  createdAt: "2026-09-01T12:00:00Z",
  author: { id: "emp1", name: "Erin Employee" },
  ...overrides,
});

// =================== the feed contract is shared, not copied ===================

test("REUSE: the employee surface re-exports the customer feed limits rather than defining its own", () => {
  assert.equal(COMMUNITY_LIMIT_DEFAULT, 50);
  assert.equal(COMMUNITY_LIMIT_MAX, 100);
  assert.equal(COMMUNITY_MESSAGE_MAX_LENGTH, 1000);
  // Byte-identical values are the point: two definitions would be free to drift.
  assert.equal(COMMUNITY_LIMIT_DEFAULT, community.COMMUNITY_LIMIT_DEFAULT);
  assert.equal(COMMUNITY_LIMIT_MAX, community.COMMUNITY_LIMIT_MAX);
  assert.equal(COMMUNITY_MESSAGE_MAX_LENGTH, community.COMMUNITY_MESSAGE_MAX_LENGTH);
});

test("REUSE: contentError is the customer composer validator, so the rules cannot diverge", () => {
  assert.equal(contentError, community.contentError);
  assert.equal(contentError("x".repeat(1000)), null);
  assert.ok(contentError("x".repeat(1001)));
  assert.ok(contentError("   "));
});

test("REUSE: the ordering/pagination helpers are the customer's, not copies", () => {
  assert.equal(community.newestFirst.name, "newestFirst");
  const src = read("../lib/employeeCommunity.mjs");
  // A hand-rolled comparator or sort inside the employee helper would be a copy.
  assert.equal(/\.sort\(/.test(src), false, "the employee helper must not re-implement ordering");
  assert.equal(/function\s+(newestFirst|mergeNewest|appendOlder|chronological)\b/.test(src), false);
});

// =================== author labeling ===================

test("authorLabel uses the server-provided name", () => {
  assert.equal(authorLabel(post()), "Erin Employee");
  assert.equal(authorLabel(post({ author: { id: "e", name: "  Sam  " } })), "Sam");
});

test("authorLabel falls back to a neutral label rather than showing undefined", () => {
  for (const p of [
    post({ author: null }),
    post({ author: {} }),
    post({ author: { name: "" } }),
    post({ author: { name: "   " } }),
    post({ author: { name: 42 } }),
    undefined,
  ]) {
    assert.equal(authorLabel(p), "Employee");
  }
  // A well-formed post is NOT a fallback case.
  assert.equal(authorLabel(post()), "Erin Employee");
});

test("authorLabel never renders an id, email or role as a name", () => {
  const label = authorLabel(post({ author: { id: "emp1", name: "Erin", email: "erin@secret.test", role: "employee" } }));
  assert.equal(label, "Erin");
  assert.equal(label.includes("@"), false);
  assert.equal(label.includes("secret"), false);
});

// =================== "You" labeling is session-scoped ===================

test("isOwnPost marks only the session user's own post", () => {
  assert.equal(isOwnPost(post(), "emp1"), true);
  assert.equal(isOwnPost(post(), "emp2"), false);
});

test("isOwnPost returns false when either side is missing — never a crash or a false match", () => {
  assert.equal(isOwnPost(post(), undefined), false);
  assert.equal(isOwnPost(post(), null), false);
  assert.equal(isOwnPost(post(), ""), false);
  assert.equal(isOwnPost(post({ author: null }), "emp1"), false);
  assert.equal(isOwnPost(post({ author: {} }), "emp1"), false);
  assert.equal(isOwnPost(undefined, "emp1"), false);
});

test("MUTATION: a post cannot claim authorship by carrying its own user id field", () => {
  // The comparison is against the id the PAGE passes in (the session), so a
  // server row claiming `userId: "emp1"` cannot make itself someone else's "You".
  const spoof = post({ userId: "emp1", authorId: "emp1", isMine: true });
  assert.equal(isOwnPost(spoof, "emp2"), false);
  assert.equal(isOwnPost(spoof, "emp1"), true);
});

// =================== removed state ===================

test("isRemoved is true only when the server stamped deletedAt", () => {
  assert.equal(isRemoved(post({ deletedAt: "2026-09-05T00:00:00Z" })), true);
  assert.equal(isRemoved(post({ deletedAt: null })), false);
  assert.equal(isRemoved(post()), false);
  assert.equal(isRemoved(post({ deletedAt: undefined })), false);
  assert.equal(isRemoved(undefined), false);
});

test("MUTATION: isRemoved cannot be flipped by client-side state — it reads only the server field", () => {
  // Nothing in the helper consults anything but deletedAt, so a post hidden by
  // the server stays hidden and a live post cannot be hidden by a crafted row.
  assert.equal(isRemoved({ deletedAt: null, hidden: true }), false);
  assert.equal(isRemoved({ deletedAt: "2026-09-05T00:00:00Z", deleted: false }), true);
});

test("removedCount counts only server-stamped removals and tolerates junk", () => {
  assert.equal(removedCount([post(), post({ id: "p2", deletedAt: "2026-09-05T00:00:00Z" })]), 1);
  assert.equal(removedCount([]), 0);
  assert.equal(removedCount(undefined), 0);
  assert.equal(removedCount(null), 0);
  assert.equal(removedCount("nope"), 0);
  assert.equal(removedCount([null, undefined, {}]), 0);
});

// =================== composer gating ===================

test("draftDisabledReason is null for a sendable draft", () => {
  assert.equal(draftDisabledReason("hello team", { sending: false, blocked: false }), null);
});

test("draftDisabledReason blocks on a posting block before anything else", () => {
  const reason = draftDisabledReason("", { sending: false, blocked: true });
  assert.match(reason, /blocked from posting/i);
});

test("draftDisabledReason reports sending and content problems distinctly", () => {
  assert.match(draftDisabledReason("hi", { sending: true, blocked: false }), /Sending/i);
  assert.match(draftDisabledReason("", { sending: false, blocked: false }), /empty/i);
  assert.match(draftDisabledReason("x".repeat(1001), { sending: false, blocked: false }), /1000/);
});

test("MUTATION: a blocked employee cannot be re-enabled by editing the draft", () => {
  // The block is checked before the content, so no draft — not even a valid one —
  // can turn the button back on.
  for (const draft of ["", "   ", "valid message", "x".repeat(2000)]) {
    assert.ok(draftDisabledReason(draft, { sending: false, blocked: true }));
  }
});

// =================== copy ===================

test("copy never implies customers, bookings, payments or discounts", () => {
  const copy = [EMPTY_TITLE, EMPTY_BODY, ERROR_TITLE, ...Object.values({ EMPTY_TITLE, EMPTY_BODY, ERROR_TITLE })]
    .join(" ")
    .toLowerCase();
  for (const forbidden of ["customer", "booking", "payment", "receipt", "discount", "stripe", "refund"]) {
    assert.equal(copy.includes(forbidden), false, `employee community copy must not mention ${forbidden}`);
  }
  assert.match(EMPTY_TITLE, /No posts yet/i);
  assert.match(ERROR_TITLE, /could not load/i);
});

test("a load failure is not presented as an empty community", () => {
  // The whole point of ERROR_TITLE is that these are different states.
  assert.notEqual(ERROR_TITLE.toLowerCase(), EMPTY_TITLE.toLowerCase());
});

// =================== the hook and pages: endpoint discipline ===================

const hookSrc = read("../lib/useEmployeeCommunity.js");
const employeePage = read("../app/employee/community/page.jsx");
const adminPage = read("../app/admin/community/employee/page.jsx");

test("HOOK: it only ever calls the employee-scoped endpoints", () => {
  const calls = [...hookSrc.matchAll(/api\(`?"([^`"$]*)/g)].map((m) => m[1]);
  assert.ok(calls.length > 0);
  for (const url of calls) {
    assert.match(url, /^\/employee\/community\/messages/, `unexpected endpoint: ${url}`);
  }
});

test("MUTATION: the hook sends no audience, author or recipient parameter at all", () => {
  for (const forbidden of ["audience", "authorId", "customerId", "userId", "employeeId", "receiverId"]) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`).test(hookSrc.replace(/\/\/[^\n]*/g, "")),
      false,
      `the hook must never send ${forbidden}`,
    );
  }
  // The POST body is content and nothing else.
  const body = hookSrc.match(/method: "POST",\s*body: (\{[^}]*\})/);
  assert.ok(body, "the employee post must send a body");
  assert.equal(body[1].replace(/\s/g, ""), "{content:draft.trim()}");
});

test("MUTATION: the employee page never calls a customer or admin endpoint", () => {
  const code = employeePage.replace(/\/\/[^\n]*/g, "");
  // No direct fetch at all: the page goes through the hook, so the only possible
  // endpoint is the one the hook owns.
  assert.equal(/\bapi\s*\(/.test(code), false, "the employee page must not call the API directly");
  assert.equal(/\bfetch\s*\(/.test(code), false);
  assert.match(code, /useEmployeeCommunity\(/, "the page must read through the hook");
});

test("MUTATION: the admin page calls only admin employee-community endpoints", () => {
  const code = adminPage.replace(/\/\/[^\n]*/g, "");
  for (const m of code.matchAll(/api\(\s*`?"([^`"$]*)/g)) {
    assert.match(m[1], /^\/admin\/community\/employee\//, `unexpected admin endpoint: ${m[1]}`);
  }
  // Specifically: the admin page must not touch the customer community feed.
  assert.equal(/api\(\s*`?"\/admin\/community\/messages/.test(code), false, "must not read the customer community");
});

test("MUTATION: the admin page has no composer — an admin can never author here", () => {
  assert.equal(/<textarea/.test(adminPage), false, "no composer on the moderation surface");
  assert.equal(/method: "POST", body: \{ content/.test(adminPage), false, "an admin must never post content");
  assert.equal(/community\/messages`,\s*\{\s*method: "POST"/.test(adminPage), false);
});

test("MUTATION: the admin page never offers an employee-to-customer message action", () => {
  for (const forbidden of ["/admin/messages/new", "receiverId", "customerId", "Send message to customer"]) {
    assert.equal(adminPage.includes(forbidden), false, `moderation page must not offer ${forbidden}`);
  }
});

test("MUTATION: no employee community page links to a customer profile route", () => {
  // /dashboard/profile/[userId] is requireCustomer: linking there 403s every
  // employee, and it would also be an audience-crossing link.
  for (const src of [employeePage, adminPage, hookSrc]) {
    assert.equal(/dashboard\/profile/.test(src), false);
    assert.equal(/href=.*profile/i.test(src), false, "an employee community author must not link anywhere");
  }
});

test("MUTATION: no employee surface renders private User fields", () => {
  for (const src of [employeePage, adminPage, hookSrc, read("../lib/employeeCommunity.mjs")]) {
    // Comments and identifiers like `Megaphone` are stripped/word-bounded, so
    // only a real property ACCESS can fail this.
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, "");
    for (const field of ["email", "phone", "address", "passwordHash", "stripeCustomerId", "disabledAt", "lastActiveAt"]) {
      const accessed = new RegExp(`\\.${field}\\b`);
      assert.equal(accessed.test(code), false, `must not read ${field} from a user`);
    }
  }
});

test("MUTATION: the employee page renders only id/content/createdAt/author from a post", () => {
  const code = employeePage.replace(/\/\/[^\n]*/g, "");
  for (const used of ["m.id", "m.content", "m.createdAt", "authorLabel(m)", "isOwnPost(m,"]) {
    assert.ok(code.includes(used), `expected the page to render ${used}`);
  }
  // The author is reached through the two helpers, never by rendering a raw
  // user object or an author id/email directly.
  assert.equal(/\{m\.author\}/.test(code), false);
});

// =================== blocked-employee experience ===================

test("BLOCKED: the composer is disabled but the feed is not, and the copy says so", () => {
  assert.match(employeePage, /disabled=\{sending \|\| blocked\}/, "the composer must be disabled while blocked");
  // The reader container is never conditioned on `blocked`.
  const reader = employeePage.slice(employeePage.indexOf("ref={scrollRef}"), employeePage.indexOf("ref={scrollRef}") + 400);
  assert.equal(reader.includes("blocked"), false, "a blocked employee must still be able to read");
  assert.match(employeePage, /can still\s+read/i, "the page must tell a blocked employee they can still read");
});

test("BLOCKED: the blocked notice is a status region, not an error", () => {
  assert.match(employeePage, /role="status"/);
});

test("a 401/403 renders a sign-in prompt, never an empty community", () => {
  assert.match(employeePage, /unauthorized/);
  assert.match(employeePage, /session is no longer active/i);
  assert.match(employeePage, /href="\/login"/);
  // The unauthorized branch must come before the error branch and the empty
  // branch, or a revoked session would look like a failed or empty feed.
  const iUnauthorized = employeePage.indexOf("unauthorized ?");
  const iError = employeePage.indexOf("error ?");
  const iEmpty = employeePage.indexOf("shown.length === 0");
  assert.ok(iUnauthorized < iError && iError < iEmpty);
});

test("RATE LIMIT: the draft is kept after a 429 so the message is not lost", () => {
  assert.match(hookSrc, /setRateLimited\(true\)/);
  // The clear-draft line must only run on success, so a 429 leaves the text.
  const submit = hookSrc.slice(hookSrc.indexOf("const submit"), hookSrc.indexOf("// A 401/403"));
  const clearIndex = submit.indexOf('setDraft("")');
  const catchIndex = submit.indexOf("} catch (err) {");
  assert.ok(clearIndex > -1 && catchIndex > clearIndex, "the draft clears on success, before the catch");
  assert.equal(submit.indexOf("setRateLimited(true)") > catchIndex, true);
  assert.match(employeePage, /message is saved/i);
});

test("PAGINATION: older pages are requested with a before cursor and merged, never replacing the feed", () => {
  assert.match(hookSrc, /before: page\.nextBefore/);
  assert.match(hookSrc, /appendOlder\(prev, data\.messages\)/);
  assert.equal(/setMessages\(data\.messages\)/.test(hookSrc), false, "a poll must never replace the loaded feed");
});

test("PAGINATION: polling merges in place and cannot duplicate a message", () => {
  assert.match(hookSrc, /mergeNewest\(prev, data\.messages\)/);
  const existing = [post({ id: "b" }), post({ id: "a" })];
  const merged = community.mergeNewest(existing, [post({ id: "b" })]);
  assert.equal(merged.length, 2, "a re-delivered post must not appear twice");
});

test("PAGINATION: a poll failure is silent and does not blank the feed", () => {
  const refresh = hookSrc.slice(hookSrc.indexOf("const refreshNewest"), hookSrc.indexOf("const loadOlder"));
  assert.match(refresh, /catch \{[\s\S]*?silent poll failure/);
  assert.equal(/setMessages\(\[\]\)/.test(refresh), false, "a failed poll must not empty the reader");
});

test("PAGINATION: overlapping polls are suppressed", () => {
  assert.match(hookSrc, /if \(pollingRef\.current\) return/);
});

test("a load error empties the list so stale posts are never shown as current", () => {
  assert.match(hookSrc, /setError\(err\);\s*setMessages\(\[\]\)/);
});

// =================== the employee nav entry ===================

// lib/employeeNav.jsx is JSX and cannot be imported by `node --test`, so the nav
// is asserted from source — the same convention employeePortal.test.mjs uses.
// Strip line comments first so a commented-out destination cannot satisfy or
// fail an assertion.
const navCode = read("../lib/employeeNav.jsx").replace(/\/\/[^\n]*/g, "");
const navHrefs = [...navCode.matchAll(/href:\s*"(\/employee[^"]*)"/g)].map((m) => m[1]);

test("NAV: the employee nav links to the community it actually has", () => {
  assert.ok(navHrefs.includes("/employee/community"), "the community must be reachable from the employee nav");
  assert.equal(navHrefs.length, 9, "exactly the nine destinations that exist");
  assert.equal(
    navHrefs.indexOf("/employee/resignation"),
    navHrefs.indexOf("/employee/leave") + 1,
    "resignation must sit directly after leave",
  );
  assert.equal(new Set(navHrefs).size, navHrefs.length, "no duplicate destinations");
  for (const href of navHrefs) {
    assert.equal(/\/employee\/profile|\/employee\/time|\/employee\/payments/.test(href), false);
  }
});

test("NAV: the community sits between the work links and announcements", () => {
  const iShifts = navHrefs.indexOf("/employee/shifts");
  const iCommunity = navHrefs.indexOf("/employee/community");
  const iBroadcasts = navHrefs.indexOf("/employee/broadcasts");
  assert.ok(iShifts > -1 && iBroadcasts > -1);
  assert.ok(iShifts < iCommunity && iCommunity < iBroadcasts);
});

test("NAV: the community entry is labelled plainly, with no unread-count suffix", () => {
  assert.match(navCode, /href: "\/employee\/community", label: "Community"/);
  // Unlike announcements, the community has no read receipts in this phase, so
  // a count would be a number the server never sent.
  const entry = navCode.split("{ href: \"/employee/community\"")[1].split("}")[0];
  assert.equal(/announcementNavLabel|unreadCount/.test(entry), false);
});

test("NAV: no customer or admin destination leaked into the employee nav", () => {
  for (const href of navHrefs) {
    assert.equal(/^\/employee(\/|$)/.test(href), true, `non-employee destination in the employee nav: ${href}`);
  }
});
