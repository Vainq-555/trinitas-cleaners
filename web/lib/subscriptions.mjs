/**
 * Shared monthly-subscription UI logic.
 *
 * Pure, browser-free module (no JSX) so it can be unit-tested with plain Node,
 * following the app's existing shared admin/booking-UI-logic modules.
 *
 * It never creates Stripe objects, never changes subscription state, and never
 * derives amounts. It only turns backend truth (already-returned data) into
 * display labels and safe action flags. Backend status values are used exactly
 * as stored — nothing is invented here.
 */

// Backend "Book for Month" term bounds (mirrors api/src/controllers/subscriptions.js).
export const SUBSCRIPTION_TERM_MIN_MONTHS = 1;
export const SUBSCRIPTION_TERM_MAX_MONTHS = 12;

// The Subscription.status values the Phase 2 backend actually assigns.
export const SUBSCRIPTION_STATUSES = [
  "pending",
  "accepted",
  "active",
  "past_due",
  "canceled",
  "completed",
];

// Customer-facing labels for each backend status. No confusing Stripe terminology.
const STATUS_LABELS = {
  pending: "Awaiting approval",
  accepted: "Approved",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  completed: "Completed",
};

// Tone drives the StatusBadge colors. Must be a key the badge already styles.
const STATUS_TONES = {
  pending: "pending",
  accepted: "accepted",
  active: "active",
  past_due: "past_due",
  canceled: "declined",
  completed: "completed",
};

// A row is a monthly booking when the backend attached the Subscription
// (only the monthly request booking lane carries it).
export function isMonthlyBooking(booking) {
  return Boolean(booking?.subscription);
}

// Status display info for a subscription, defaulting to safe values.
export function subscriptionStatusInfo(sub) {
  const status = SUBSCRIPTION_STATUSES.includes(sub?.status) ? sub.status : null;
  return {
    status,
    label: status ? STATUS_LABELS[status] : "Unknown",
    tone: status ? STATUS_TONES[status] : "unknown",
  };
}

// "Month 2 of 6" term copy when the subscription has a valid number of months.
export function subscriptionTerm(sub) {
  if (!sub || !Number.isInteger(sub.months) || sub.months < 1) return null;
  const completed =
    Number.isInteger(sub.monthCompleted) && sub.monthCompleted >= 0
      ? sub.monthCompleted
      : 0;
  const shown = Math.min(completed, sub.months);
  return `Month ${Math.min(shown + 1, sub.months)} of ${sub.months}`;
}

// Short progress text, e.g. "2 of 6 months completed" (0-based safe).
export function subscriptionProgress(sub) {
  if (!sub || !Number.isInteger(sub.months) || sub.months < 1) return null;
  const completed =
    Number.isInteger(sub.monthCompleted) && sub.monthCompleted >= 0
      ? sub.monthCompleted
      : 0;
  return `${Math.min(completed, sub.months)} of ${sub.months} months completed`;
}

// Immutable monthly price snapshot in USD cents (same value the backend locks
// at signup and the Stripe Price charges each month).
export function subscriptionMonthlyPriceCents(sub) {
  return sub && Number.isInteger(sub.monthlyPriceCents) && sub.monthlyPriceCents >= 0
    ? sub.monthlyPriceCents
    : null;
}

// Current billing period display ("Through Jul 31, 2026"), from backend fields.
export function subscriptionPeriodText(sub) {
  if (sub?.currentPeriodStart && sub?.currentPeriodEnd) {
    return `${new Date(sub.currentPeriodStart).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })} – ${new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  return null;
}

// Whether the customer may click "Pay Now". Mirrors the backend checkout gates:
// approved (accepted), online payment only, never started, not ended. The
// endpoint itself remains authoritative — this only decides the button's visibility.
export function canPayNow(booking) {
  const sub = booking?.subscription;
  if (!sub) return false;
  if (booking.status !== "accepted") return false;
  if (sub.status !== "accepted") return false;
  if (["completed", "canceled"].includes(sub.status)) return false;
  if (sub.stripeSubscriptionId) return false;
  if (booking?.payment?.method !== "online") return false;
  if (["paid", "refunded"].includes(booking?.payment?.status)) return false;
  return true;
}

// Customer-facing guidance for each subscription state (Requirement E language).
export function subscriptionGuidance(sub) {
  const info = subscriptionStatusInfo(sub);
  const cancelScheduled =
    sub?.cancelAtPeriodEnd && ["active", "past_due"].includes(sub.status);
  let text;
  switch (info.status) {
    case "pending":
      text = "Your monthly booking is awaiting approval.";
      break;
    case "accepted":
      text = "Approved — complete your first payment to start your monthly booking.";
      break;
    case "active":
      text = "Your monthly booking is active and is billed every month.";
      break;
    case "past_due":
      text = "Your latest monthly payment did not go through. Your current month is still active.";
      break;
    case "canceled":
      text = "This monthly booking has been canceled.";
      break;
    case "completed":
      text = "Your monthly booking term is complete.";
      break;
    default:
      text = null;
  }
  if (cancelScheduled) {
    text = `${text || "Your monthly booking"} Cancellation scheduled for the end of this billing period.`;
  }
  return text;
}

// Banner shown after returning from Stripe Checkout for a monthly booking.
// The backend webhook remains the sole authority on activation; the first month
// is only active after the hosted payment is confirmed.
export function subscriptionReturnMessage(booking) {
  if (!isMonthlyBooking(booking)) return null;
  return "Payment received. Your monthly booking will start once the first payment is confirmed — this can take a few seconds.";
}