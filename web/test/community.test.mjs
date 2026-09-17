import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNITY_LIMIT_DEFAULT,
  COMMUNITY_LIMIT_MAX,
  COMMUNITY_MESSAGE_MAX_LENGTH,
  isValidCommunityLimit,
  contentError,
  feedQuery,
  mergeNewest,
  appendOlder,
  chronological,
} from "../lib/community.mjs";

const m = (id, iso, overrides = {}) => ({
  id,
  content: `msg ${id}`,
  createdAt: iso,
  customer: { id: `cus-${id}`, name: `User ${id}` },
  ...overrides,
});

test("default limit is 50 and maximum is 100", () => {
  assert.equal(COMMUNITY_LIMIT_DEFAULT, 50);
  assert.equal(COMMUNITY_LIMIT_MAX, 100);
});

test("valid limits are 1..100", () => {
  assert.equal(isValidCommunityLimit(1), true);
  assert.equal(isValidCommunityLimit(50), true);
  assert.equal(isValidCommunityLimit(100), true);
});

test("invalid limits are rejected", () => {
  for (const n of [0, -1, 101, 1000, 1.5, "50", null, undefined, NaN]) {
    assert.equal(isValidCommunityLimit(n), false, `limit ${n} should be invalid`);
  }
});

test("feedQuery defaults to limit 50 and omits before when absent", () => {
  assert.deepEqual(feedQuery(), { limit: 50 });
  assert.deepEqual(feedQuery({}), { limit: 50 });
});

test("feedQuery includes before only when provided", () => {
  assert.deepEqual(feedQuery({ before: "abc123" }), { limit: 50, before: "abc123" });
  assert.deepEqual(feedQuery({ limit: 100, before: "z" }), { limit: 100, before: "z" });
});

test("feedQuery rejects an invalid limit", () => {
  assert.equal(feedQuery({ limit: 101 }), null);
  assert.equal(feedQuery({ limit: 0 }), null);
});

test("1000-character message is accepted", () => {
  assert.equal(contentError("x".repeat(1000)), null);
});

test("over-1000-character message is rejected", () => {
  const err = contentError("x".repeat(1001));
  assert.ok(err);
  assert.match(err, /1000/);
});

test("empty and whitespace-only content are rejected", () => {
  assert.ok(contentError(""));
  assert.ok(contentError("   \t  "));
  assert.match(contentError("  "), /empty/i);
});

test("non-string content is rejected", () => {
  assert.ok(contentError(undefined));
  assert.ok(contentError(null));
});

test("mergeNewest folds new messages in and preserves loaded ones", () => {
  const existing = [m("a", "2026-09-01T00:00:00Z"), m("b", "2026-09-02T00:00:00Z")];
  const incoming = [m("c", "2026-09-03T00:00:00Z"), m("d", "2026-09-04T00:00:00Z")];
  const merged = mergeNewest(existing, incoming);
  assert.deepEqual(merged.map((x) => x.id), ["d", "c", "b", "a"]);
});

test("mergeNewest deduplicates by id (newest-first order preserved)", () => {
  const existing = [m("b", "2026-09-02T00:00:00Z"), m("a", "2026-09-01T00:00:00Z")];
  const incoming = [m("b", "2026-09-02T00:00:00Z"), m("d", "2026-09-04T00:00:00Z")];
  const merged = mergeNewest(existing, incoming);
  assert.deepEqual(merged.map((x) => x.id), ["d", "b", "a"]);
  assert.equal(merged.filter((x) => x.id === "b").length, 1);
});

test("mergeNewest does not churn when nothing is new", () => {
  const existing = [m("a", "2026-09-01T00:00:00Z"), m("b", "2026-09-02T00:00:00Z")];
  const merged = mergeNewest(existing, existing);
  assert.deepEqual(merged.map((x) => x.id), ["b", "a"]);
  assert.equal(merged.length, 2);
});

test("appendOlder prepends the older page without touching loaded messages", () => {
  const existing = [m("d", "2026-09-04T00:00:00Z"), m("c", "2026-09-03T00:00:00Z")];
  const older = [m("b", "2026-09-02T00:00:00Z"), m("a", "2026-09-01T00:00:00Z")];
  const appended = appendOlder(existing, older);
  assert.deepEqual(appended.map((x) => x.id), ["d", "c", "b", "a"]);
});

test("appendOlder is idempotent across repeated pages (no duplicates)", () => {
  const existing = [m("d", "2026-09-04T00:00:00Z"), m("c", "2026-09-03T00:00:00Z")];
  const older = [m("b", "2026-09-02T00:00:00Z"), m("a", "2026-09-01T00:00:00Z")];
  const first = appendOlder(existing, older);
  const again = appendOlder(first, older);
  assert.deepEqual(again.map((x) => x.id), ["d", "c", "b", "a"]);
});

test("chronological returns oldest-first for display", () => {
  const list = mergeNewest(
    [m("a", "2026-09-01T00:00:00Z")],
    [m("c", "2026-09-03T00:00:00Z"), m("b", "2026-09-02T00:00:00Z")],
  );
  const display = chronological(list);
  assert.deepEqual(display.map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(display.map((x) => x.id).reverse(), list.map((x) => x.id), "display is the reverse of newest-first");
});

test("identical timestamps sort by id descending (tie-break)", () => {
  const list = mergeNewest([], [
    m("c1", "2026-09-01T00:00:00Z"),
    m("c6", "2026-09-01T00:00:00Z"),
    m("c3", "2026-09-01T00:00:00Z"),
  ]);
  assert.deepEqual(list.map((x) => x.id), ["c6", "c3", "c1"]);
  assert.deepEqual(chronological(list).map((x) => x.id), ["c1", "c3", "c6"]);
});

test("helpers tolerate empty/malformed input", () => {
  assert.deepEqual(mergeNewest([], []), []);
  assert.deepEqual(mergeNewest(undefined, [m("a", "2026-09-01T00:00:00Z")]).map((x) => x.id), ["a"]);
  assert.deepEqual(appendOlder(null, undefined), []);
  assert.deepEqual(chronological(undefined), []);
});