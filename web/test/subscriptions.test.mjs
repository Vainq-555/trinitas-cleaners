import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBSCRIPTION_TERM_MIN_MONTHS,
  SUBSCRIPTION_TERM_MAX_MONTHS,
  SUBSCRIPTION_STATUSES,
  isMonthlyBooking,
  subscriptionStatusInfo,
  subscriptionTerm,
  subscriptionProgress,
  subscriptionMonthlyPriceCents,
  subscriptionPeriodText,
  canPayNow,
  subscriptionGuidance,
  subscriptionReturnMessage,
} from "../lib/subscriptions.mjs";

const sub = (overrides = {}) => ({
  id: "sub_1",
  customerId: "u1",
  serviceId: "s1",
  bookingId: "b1",
  months: 3,
  monthCompleted: 0,
  status: "accepted",
  monthlyPriceCents: 4000,
  stripeSubscriptionId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  ...overrides,
});

const booking = (overrides = {}) => ({
  id: "b1",
  status: "pending",
  payment: { method: "online", status: "pending" },
  subscription: sub(),
  ...overrides,
});

test("term bounds match the backend (1–12)", () => {
  assert.equal(SUBSCRIPTION_TERM_MIN_MONTHS, 1);
  assert.equal(SUBSCRIPTION_TERM_MAX_MONTHS, 12);
});

test("statuses match the backend status values", () => {
  assert.deepEqual(SUBSCRIPTION_STATUSES, [
    "pending",
    "accepted",
    "active",
    "past_due",
    "canceled",
    "completed",
  ]);
});

test("isMonthlyBooking is true only when the backend attached a subscription", () => {
  assert.equal(isMonthlyBooking(booking()), true);
  assert.equal(isMonthlyBooking({ ...booking(), subscription: null }), false);
  assert.equal(isMonthlyBooking({ id: "b1" }), false);
  assert.equal(isMonthlyBooking(null), false);
  assert.equal(isMonthlyBooking(undefined), false);
});

test("subscriptionStatusInfo maps every backend status with a safe default", () => {
  assert.deepEqual(subscriptionStatusInfo(sub({ status: "pending" })), { status: "pending", label: "Awaiting approval", tone: "pending" });
  assert.deepEqual(subscriptionStatusInfo(sub({ status: "accepted" })), { status: "accepted", label: "Approved", tone: "accepted" });
  assert.deepEqual(subscriptionStatusInfo(sub({ status: "active" })), { status: "active", label: "Active", tone: "active" });
  assert.deepEqual(subscriptionStatusInfo(sub({ status: "past_due" })), { status: "past_due", label: "Past due", tone: "past_due" });
  assert.deepEqual(subscriptionStatusInfo(sub({ status: "canceled" })), { status: "canceled", label: "Canceled", tone: "declined" });
  assert.deepEqual(subscriptionStatusInfo(sub({ status: "completed" })), { status: "completed", label: "Completed", tone: "completed" });
  assert.deepEqual(subscriptionStatusInfo(sub({ status: "made-up" })), { status: null, label: "Unknown", tone: "unknown" });
  assert.deepEqual(subscriptionStatusInfo(null), { status: null, label: "Unknown", tone: "unknown" });
});

test("subscriptionTerm shows the next month out of the term", () => {
  assert.equal(subscriptionTerm(sub({ months: 3, monthCompleted: 0 })), "Month 1 of 3");
  assert.equal(subscriptionTerm(sub({ months: 3, monthCompleted: 2 })), "Month 3 of 3");
  assert.equal(subscriptionTerm(sub({ months: 3, monthCompleted: 5 })), "Month 3 of 3");
  assert.equal(subscriptionTerm(sub({ months: 0 })), null);
  assert.equal(subscriptionTerm(null), null);
});

test("subscriptionProgress reports paid months without exceeding the term", () => {
  assert.equal(subscriptionProgress(sub({ months: 3, monthCompleted: 0 })), "0 of 3 months completed");
  assert.equal(subscriptionProgress(sub({ months: 3, monthCompleted: 2 })), "2 of 3 months completed");
  assert.equal(subscriptionProgress(sub({ months: 3, monthCompleted: 9 })), "3 of 3 months completed");
  assert.equal(subscriptionProgress(null), null);
});

test("subscriptionMonthlyPriceCents returns the locked snapshot only when valid", () => {
  assert.equal(subscriptionMonthlyPriceCents(sub({ monthlyPriceCents: 4000 })), 4000);
  assert.equal(subscriptionMonthlyPriceCents(sub({ monthlyPriceCents: null })), null);
  assert.equal(subscriptionMonthlyPriceCents(sub({ monthlyPriceCents: -1 })), null);
  assert.equal(subscriptionMonthlyPriceCents(null), null);
});

test("subscriptionPeriodText formats backend period fields or returns null", () => {
  assert.equal(subscriptionPeriodText(sub({ currentPeriodStart: null, currentPeriodEnd: null })), null);
  assert.equal(subscriptionPeriodText(null), null);
  const text = subscriptionPeriodText(sub({ currentPeriodStart: "2026-07-01T00:00:00Z", currentPeriodEnd: "2026-07-31T23:59:59Z" }));
  assert.ok(text.includes("Jul 1"));
  assert.ok(text.includes("Jul 31, 2026"));
});

test("canPayNow follows the backend checkout gates", () => {
  const base = booking({ status: "accepted" });
  assert.equal(canPayNow(base), true);
  assert.equal(canPayNow(booking()), false); // booking still pending approval
  assert.equal(canPayNow({ ...base, subscription: sub({ status: "pending" }) }), false);
  assert.equal(canPayNow({ ...base, subscription: sub({ status: "completed" }) }), false);
  assert.equal(canPayNow({ ...base, subscription: sub({ status: "canceled" }) }), false);
  assert.equal(canPayNow({ ...base, subscription: sub({ status: "active" }) }), false);
  assert.equal(canPayNow({ ...base, subscription: sub({ stripeSubscriptionId: "sub_stripe_1" }) }), false);
  assert.equal(canPayNow({ ...base, payment: { method: "cash", status: "unpaid" } }), false);
  assert.equal(canPayNow({ ...base, payment: { method: "online", status: "paid" } }), false);
  assert.equal(canPayNow({ ...base, subscription: null }), false);
  assert.equal(canPayNow({ id: "b1" }), false);
  assert.equal(canPayNow(null), false);
});

test("subscriptionGuidance is clear, non-jargon, and reports scheduled cancellation", () => {
  assert.equal(subscriptionGuidance(sub({ status: "pending" })), "Your monthly booking is awaiting approval.");
  assert.ok(subscriptionGuidance(sub({ status: "accepted" })).includes("your first payment"));
  assert.ok(subscriptionGuidance(sub({ status: "active" })).includes("billed every month"));
  assert.ok(subscriptionGuidance(sub({ status: "past_due" })).includes("did not go through"));
  assert.equal(subscriptionGuidance(sub({ status: "canceled" })), "This monthly booking has been canceled.");
  assert.equal(subscriptionGuidance(sub({ status: "completed" })), "Your monthly booking term is complete.");
  const scheduled = subscriptionGuidance(sub({ status: "active", cancelAtPeriodEnd: true }));
  assert.ok(scheduled.includes("Cancellation scheduled for the end of this billing period."));
  const unscheduled = subscriptionGuidance(sub({ status: "active", cancelAtPeriodEnd: false }));
  assert.ok(!unscheduled.includes("Cancellation scheduled"));
  assert.equal(subscriptionGuidance(null), null);
});

test("subscriptionReturnMessage is shown only for monthly bookings", () => {
  assert.ok(subscriptionReturnMessage(booking()).includes("confirmed"));
  assert.equal(subscriptionReturnMessage({ ...booking(), subscription: null }), null);
  assert.equal(subscriptionReturnMessage(null), null);
});