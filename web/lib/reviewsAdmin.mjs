/**
 * Admin Reviews status tabs and client-side filters.
 *
 * Pure, browser-free module (no JSX) so the tab logic can be unit-tested with
 * plain Node. It mirrors the app's existing shared admin-UI-logic modules and
 * only decides which already-returned reviews are visible under each tab and
 * service; it never changes review statuses. Status filtering is intentionally
 * one-to-one with the backend enum (pending | approved | rejected).
 */

// Status tab identifiers and their concise display labels. "all" shows the
// complete list the API already returns, with no status filter.
export const REVIEW_TABS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

// The tab selected when the page first loads.
export const DEFAULT_TAB = "all";

// Sentinal value for the service filter meaning "no service filter applied".
// Matches the empty "<option>" value rendered by the admin page's select.
export const ALL_SERVICES = "all";

// The moderation statuses that are backed by the API enum and get mod actions.
export const MODERATION_STATUSES = ["pending", "approved", "rejected"];

export function isReviewTab(id) {
  return REVIEW_TABS.some((t) => t.id === id);
}

// Backing filter for a given tab. "all" returns the reviews untouched.
export function filterByStatus(reviews, statusId) {
  const list = Array.isArray(reviews) ? reviews : [];
  if (statusId === "pending" || statusId === "approved" || statusId === "rejected") {
    return list.filter((r) => r.status === statusId);
  }
  return list;
}

// Per-tab counts derived from the same reviews array used for the list, so
// counts and rows always agree and update together on refresh. Keys match the
// REVIEW_TABS ids; "all" is the total length.
export function countByStatus(reviews) {
  const list = Array.isArray(reviews) ? reviews : [];
  return {
    all: list.length,
    pending: list.filter((r) => r.status === "pending").length,
    approved: list.filter((r) => r.status === "approved").length,
    rejected: list.filter((r) => r.status === "rejected").length,
  };
}

// Combined status + service filter used by the admin page. A serviceId of
// ALL_SERVICES (or any non-matching value) means no service restriction.
export function filterReviews(reviews, { status = DEFAULT_TAB, serviceId = ALL_SERVICES } = {}) {
  const list = Array.isArray(reviews) ? reviews : [];
  const byStatus = filterByStatus(list, status);
  if (serviceId && serviceId !== ALL_SERVICES) {
    return byStatus.filter((r) => r.serviceId === serviceId);
  }
  return byStatus;
}

// Tab-specific empty-state copy (concise, consistent with the app's tone).
export const EMPTY_STATE_TEXT = {
  all: "No reviews yet.",
  pending: "No pending reviews.",
  approved: "No approved reviews.",
  rejected: "No rejected reviews.",
};