/**
 * Admin Bookings tab definitions and status filters.
 *
 * Pure, browser-free module (no JSX) so the tab logic can be unit-tested with
 * plain Node. It mirrors the app's existing shared admin-UI-logic modules.
 * It never computes totals, never derives amounts, and never changes booking
 * statuses — it only decides which already-returned bookings are visible under
 * each tab. Status filtering is intentionally one-to-one with the backend enum
 * (pending | accepted | worked | declined).
 */

// Session/tab identifiers and their concise, operational display labels.
// "all" shows the complete list the API already returns, with no status filter.
// A newly paid online booking is status "accepted" (set by the webhook on
// payment success), so it belongs to the "accepted"/"worked" view — this is
// the discoverability improvement, not a new status.
export const BOOKING_TABS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending Requests" },
  { id: "worked", label: "Accepted & Worked" },
  { id: "declined", label: "Declined" },
];

// The tab selected when the page first loads.
export const DEFAULT_TAB = "all";

export function isBookingTab(id) {
  return BOOKING_TABS.some((t) => t.id === id);
}

// Backing filter for a given tab. "all" returns the bookings untouched.
export function filterBySession(bookings, sessionId) {
  const list = Array.isArray(bookings) ? bookings : [];
  if (sessionId === "pending") return list.filter((b) => b.status === "pending");
  if (sessionId === "worked") return list.filter((b) => b.status === "accepted" || b.status === "worked");
  if (sessionId === "declined") return list.filter((b) => b.status === "declined");
  return list;
}

// Per-tab counts derived from the same bookings array used for the list, so
// counts and rows always agree and update together on refresh. Keys match the
// BOOKING_TABS ids; "all" is the total length.
export function countBySession(bookings) {
  const list = Array.isArray(bookings) ? bookings : [];
  return {
    all: list.length,
    pending: list.filter((b) => b.status === "pending").length,
    worked: list.filter((b) => b.status === "accepted" || b.status === "worked").length,
    declined: list.filter((b) => b.status === "declined").length,
  };
}

// Tab-specific empty-state copy (concise, consistent with the app's tone).
export const EMPTY_STATE_TEXT = {
  all: "No bookings yet.",
  pending: "No pending requests.",
  worked: "No accepted or worked bookings.",
  declined: "No declined bookings.",
};