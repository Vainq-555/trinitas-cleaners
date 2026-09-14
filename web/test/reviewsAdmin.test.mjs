import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_TABS,
  DEFAULT_TAB,
  ALL_SERVICES,
  MODERATION_STATUSES,
  isReviewTab,
  filterByStatus,
  countByStatus,
  filterReviews,
  EMPTY_STATE_TEXT,
} from "../lib/reviewsAdmin.mjs";

const review = (status, overrides = {}) => ({
  id: `rv-${status}-${Math.random()}`,
  status,
  serviceId: "svc1",
  ...overrides,
});

const PENDING_A = review("pending");
const PENDING_B = review("pending", { serviceId: "svc2" });
const APPROVED = review("approved");
const REJECTED = review("rejected");

const ALL_REVIEWS = [PENDING_A, PENDING_B, APPROVED, REJECTED];

test("tab definitions include an All tab plus pending, approved, rejected", () => {
  assert.deepEqual(
    REVIEW_TABS.map((t) => t.id),
    ["all", "pending", "approved", "rejected"]
  );
});

test("default tab is All", () => {
  assert.equal(DEFAULT_TAB, "all");
  assert.equal(isReviewTab(DEFAULT_TAB), true);
});

test("moderation statuses match the backend enum", () => {
  assert.deepEqual(MODERATION_STATUSES, ["pending", "approved", "rejected"]);
});

test("isReviewTab rejects unknown tab ids", () => {
  assert.equal(isReviewTab("pending"), true);
  assert.equal(isReviewTab("approved"), true);
  assert.equal(isReviewTab("rejected"), true);
  assert.equal(isReviewTab("all"), true);
  assert.equal(isReviewTab("bogus"), false);
});

test("All tab returns every review, unfiltered", () => {
  assert.deepEqual(filterByStatus(ALL_REVIEWS, "all"), ALL_REVIEWS);
  assert.deepEqual(filterReviews(ALL_REVIEWS), ALL_REVIEWS);
});

test("Pending shows only status === pending", () => {
  const rows = filterByStatus(ALL_REVIEWS, "pending");
  assert.equal(rows.length, 2);
});

test("Approved shows only status === approved", () => {
  const rows = filterByStatus(ALL_REVIEWS, "approved");
  assert.deepEqual(rows, [APPROVED]);
});

test("Rejected shows only status === rejected", () => {
  const rows = filterByStatus(ALL_REVIEWS, "rejected");
  assert.deepEqual(rows, [REJECTED]);
});

test("an unknown/none tab falls back to showing everything (All behavior)", () => {
  assert.deepEqual(filterByStatus(ALL_REVIEWS, "bogus"), ALL_REVIEWS);
});

test("counts are derived from the same reviews array", () => {
  const counts = countByStatus(ALL_REVIEWS);
  assert.deepEqual(counts, { all: 4, pending: 2, approved: 1, rejected: 1 });
  assert.equal(counts.all, ALL_REVIEWS.length);
  assert.equal(counts.pending, filterByStatus(ALL_REVIEWS, "pending").length);
  assert.equal(counts.approved, filterByStatus(ALL_REVIEWS, "approved").length);
  assert.equal(counts.rejected, filterByStatus(ALL_REVIEWS, "rejected").length);
});

test("counts update when the reviews array changes (auto-refresh friendly)", () => {
  const before = countByStatus([PENDING_A]);
  const after = countByStatus([PENDING_A, APPROVED]);
  assert.equal(before.all, 1);
  assert.equal(after.all, 2);
  assert.equal(after.pending, 1);
  assert.equal(after.approved, 1);
});

test("filterRewews by service narrows to that service", () => {
  const rows = filterReviews(ALL_REVIEWS, { serviceId: "svc2" });
  assert.deepEqual(rows, [PENDING_B]);
});

test("service filter combines with status filter", () => {
  const rows = filterReviews(ALL_REVIEWS, { status: "pending", serviceId: "svc1" });
  assert.deepEqual(rows, [PENDING_A]);
  const none = filterReviews(ALL_REVIEWS, { status: "approved", serviceId: "svc2" });
  assert.deepEqual(none, []);
});

test("ALL_SERVICES sentinel disables the service filter", () => {
  assert.deepEqual(filterReviews(ALL_REVIEWS, { serviceId: ALL_SERVICES }), ALL_REVIEWS);
  assert.deepEqual(filterReviews(ALL_REVIEWS, { serviceId: undefined }), ALL_REVIEWS);
});

test("filter helpers tolerate non-array/empty input", () => {
  assert.deepEqual(filterByStatus(null, "pending"), []);
  assert.deepEqual(filterReviews(undefined), []);
  assert.deepEqual(countByStatus(undefined), { all: 0, pending: 0, approved: 0, rejected: 0 });
});

test("empty-state copy exists for every tab", () => {
  for (const tab of REVIEW_TABS) {
    assert.equal(typeof EMPTY_STATE_TEXT[tab.id], "string");
    assert.ok(EMPTY_STATE_TEXT[tab.id].length > 0);
  }
});