import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import prisma from "../utils/prisma.js";
import { badRequest, isDate } from "../utils/validators.js";
import { STRIPE_SECRET_KEY, PUBLIC_WEB_URL, stripeSecretKeyMode } from "../config.js";
import { centsToLegacyDollars } from "../utils/money.js";
import { normalizeServiceAddress } from "../utils/serviceAddress.js";
import { parseScheduledStart } from "../utils/schedule.js";
import { effectiveMonthlyPriceCents } from "./services.js";

// Monthly subscriptions are a TRUE Stripe recurring subscription: the Stripe
// Price always represents exactly ONE month and Stripe quantity ALWAYS stays 1.
// The customer-chosen term length lives in Subscription.months and is enforced
// in the application layer only — it is NEVER passed to Stripe as a quantity.
export const SUBSCRIPTION_TERM_MIN_MONTHS = 1;
export const SUBSCRIPTION_TERM_MAX_MONTHS = 12;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const subscriptionInclude = {
  service: true,
  payment: true,
  subscription: true,
  customer: { select: { id: true, name: true, email: true, phone: true, address: true, stripeCustomerId: true } },
};

function isInvalidTerms(months) {
  return !Number.isInteger(months) || months < SUBSCRIPTION_TERM_MIN_MONTHS || months > SUBSCRIPTION_TERM_MAX_MONTHS;
}

// =============================================================================
// PART A — Monthly booking creation
// =============================================================================

// Creates the parent request Booking and its Subscription in one transaction.
// No Stripe objects are created here: no Stripe Customer, no Stripe Price, no
// Stripe Subscription, no Checkout. Monthly is ONLINE PAYMENT ONLY.
export async function createSubscriptionBooking(req, res) {
  const {
    serviceId,
    date,
    note,
    months,
    serviceAddress,
    serviceLocation,
    serviceLocationInstructions,
    scheduledStartDate,
    scheduledStartTime,
  } = req.body || {};
  if (isInvalidTerms(months)) {
    return badRequest(res, "months must be an integer from 1 through 12");
  }
  if (!serviceId || !isDate(date)) {
    return badRequest(res, "serviceId and a valid date are required");
  }
  if (new Date(date).getTime() < Date.now() - 86400000) {
    return badRequest(res, "Booking date cannot be in the past");
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.isActive) return badRequest(res, "Service not found");

  const monthlyPriceCents = await effectiveMonthlyPriceCents(service, req.user.id);
  if (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0) {
    return badRequest(res, "This service is not available for monthly booking");
  }

  // Structural service-address validation before persist (same convention as the
  // existing one-time booking flow). A missing address is still allowed.
  const normalizedAddress = serviceAddress ? normalizeServiceAddress(serviceAddress) : null;
  if (normalizedAddress && !normalizedAddress.ok) {
    return badRequest(res, normalizedAddress.error);
  }
  const address = normalizedAddress ? normalizedAddress.address : {};

  // Service location (WHERE) and schedule (WHEN): same additive, optional
  // validation conventions as the one-time booking lane. Missing values stay
  // valid; malformed values are rejected, not silently dropped.
  const normalizedLocation = serviceLocation
    ? normalizeServiceAddress(serviceLocation)
    : null;
  if (normalizedLocation && !normalizedLocation.ok) {
    return badRequest(res, normalizedLocation.error);
  }
  const location = normalizedLocation ? normalizedLocation.address : null;
  if (serviceLocationInstructions != null && typeof serviceLocationInstructions !== "string") {
    return badRequest(res, "serviceLocationInstructions must be text");
  }
  if (typeof serviceLocationInstructions === "string" && serviceLocationInstructions.trim().length > 500) {
    return badRequest(res, "serviceLocationInstructions must be 500 characters or fewer");
  }
  const schedule = parseScheduledStart({ scheduledStartDate, scheduledStartTime });
  if (!schedule.ok) return badRequest(res, schedule.error);
  const instructions = typeof serviceLocationInstructions === "string" ? serviceLocationInstructions.trim() || null : null;

  const booking = await prisma.$transaction(async (tx) => {
    return tx.booking.create({
      data: {
        customerId: req.user.id,
        serviceId: service.id,
        date: new Date(date),
        note: note || null,
        status: "pending",
        price: centsToLegacyDollars(monthlyPriceCents),
        basePriceCents: monthlyPriceCents,
        taxAddressLine1: typeof address.line1 === "string" ? address.line1.trim() : null,
        taxAddressLine2: typeof address.line2 === "string" ? address.line2.trim() || null : null,
        taxAddressCity: typeof address.city === "string" ? address.city.trim() : null,
        taxAddressState: typeof address.state === "string" ? address.state.trim() : null,
        taxAddressPostalCode: typeof address.postalCode === "string" ? address.postalCode.trim() : null,
        taxAddressCountry: typeof address.country === "string" ? address.country.trim() : null,
        serviceLocationAddressLine1: location ? location.line1 : null,
        serviceLocationAddressLine2: location && location.line2 ? location.line2 : null,
        serviceLocationCity: location ? location.city : null,
        serviceLocationState: location ? location.state : null,
        serviceLocationPostalCode: location ? location.postalCode : null,
        serviceLocationCountry: location ? location.country : null,
        serviceLocationInstructions: instructions,
        ...(schedule.scheduledStart ? { scheduledStartAt: schedule.scheduledStart } : {}),
        payment: {
          create: { method: "online", status: "pending", amount: centsToLegacyDollars(monthlyPriceCents) },
        },
        subscription: {
          create: {
            customerId: req.user.id,
            serviceId: service.id,
            months,
            monthCompleted: 0,
            status: "pending",
            // Immutable monthly price snapshot resolved at signup (never
            // recomputed later).
            monthlyPriceCents,
            idempotencyKey: randomUUID(),
          },
        },
      },
      include: subscriptionInclude,
    });
  });

  // Notify the admin of the new monthly subscription request (same convention
  // as the existing new-booking notification).
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  if (admin) {
    await prisma.broadcast.create({
      data: {
        type: "notification",
        target: "specific_user",
        userId: admin.id,
        title: "New monthly subscription request",
        content: `${req.user.name} requested a ${months}-month subscription for "${service.name}".`,
      },
    });
  }

  res.status(201).json({ booking, requiresCheckout: false });
}

// =============================================================================
// PART C — Monthly "Pay Now" / Checkout
// =============================================================================

// Creates the Stripe Customer (lazily), the immutable one-month recurring
// Stripe Price, and a subscription-mode Checkout session. quantity ALWAYS 1.
// Repeated identical requests are de-duplicated through the persisted
// Subscription.idempotencyKey (Stripe Idempotency-Key) and the stored open
// session, so retries never create duplicate Stripe subscriptions.
export async function subscriptionCheckout(req, res) {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: subscriptionInclude,
  });
  if (!booking || booking.customerId !== req.user.id) return res.status(404).json({ error: "Booking not found" });
  const sub = booking.subscription;
  if (!sub) return badRequest(res, "This booking is not a monthly subscription");
  if (sub.customerId !== req.user.id) return res.status(404).json({ error: "Subscription not found" });
  if (!booking.payment || booking.payment.method !== "online") return badRequest(res, "Monthly subscriptions require online payment");
  if (["completed", "canceled"].includes(sub.status)) {
    return res.status(409).json({ error: "This subscription has already ended", code: "SUBSCRIPTION_ENDED" });
  }
  if (sub.status !== "accepted") {
    return res.status(409).json({ error: "Subscription must be approved before payment", code: "SUBSCRIPTION_NOT_APPROVED" });
  }
  if (sub.stripeSubscriptionId) {
    return res.status(409).json({ error: "This subscription has already been started", code: "SUBSCRIPTION_ALREADY_STARTED" });
  }
  if (!Number.isInteger(sub.monthlyPriceCents) || sub.monthlyPriceCents < 0) {
    return res.status(500).json({ error: "This subscription has no valid monthly price snapshot" });
  }
  if (isInvalidTerms(sub.months)) return badRequest(res, "This subscription has an invalid term");

  if (!stripe || !stripeSecretKeyMode()) {
    return res.status(503).json({ error: "Stripe is not configured for this environment", retryable: true });
  }

  // 1. Get or create the Stripe Customer (persisted on User.stripeCustomerId).
  let stripeCustomerId = booking.customer.stripeCustomerId;
  if (!stripeCustomerId) {
    try {
      const customer = await stripe.customers.create(
        {
          email: booking.customer.email,
          name: booking.customer.name,
          metadata: { userId: booking.customer.id },
        },
        { idempotencyKey: `${sub.idempotencyKey}:customer` },
      );
      await prisma.user.update({ where: { id: booking.customer.id }, data: { stripeCustomerId: customer.id } });
      stripeCustomerId = customer.id;
    } catch (error) {
      console.error("Stripe Customer creation failed", { bookingId: booking.id, subscriptionId: sub.id, code: error.code });
      return res.status(503).json({ error: "Secure checkout is temporarily unavailable. Please try again.", retryable: true });
    }
  }

  // 2. Create the immutable recurring Price (ONE month) from the snapshot.
  let stripePriceId = sub.stripePriceId;
  if (!stripePriceId) {
    try {
      const price = await stripe.prices.create(
        {
          currency: "usd",
          unit_amount: sub.monthlyPriceCents,
          recurring: { interval: "month", interval_count: 1 },
          product_data: { name: `${booking.service.name} — Monthly` },
          metadata: { bookingId: booking.id, subscriptionId: sub.id },
        },
        { idempotencyKey: `${sub.idempotencyKey}:price` },
      );
      await prisma.subscription.update({ where: { id: sub.id }, data: { stripePriceId: price.id } });
      stripePriceId = price.id;
    } catch (error) {
      console.error("Stripe Price creation failed", { bookingId: booking.id, subscriptionId: sub.id, code: error.code });
      return res.status(503).json({ error: "Secure checkout is temporarily unavailable. Please try again.", retryable: true });
    }
  }

  // Reuse an open session if one was already created (retry/idempotency).
  if (booking.payment?.stripeCheckoutSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(booking.payment.stripeCheckoutSessionId);
      if (existing.status === "open") return res.json({ url: existing.url });
    } catch {
      // A stale session is replaced below.
    }
  }

  // 3. Create the Checkout session. The persisted idempotencyKey is the
  // idempotency anchor, so identical retried requests never create a second
  // session (and thus never a second Stripe subscription).
  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [{ price: stripePriceId, quantity: 1 }],
        metadata: { bookingId: booking.id, subscriptionId: sub.id },
        subscription_data: { metadata: { bookingId: booking.id, subscriptionId: sub.id } },
        success_url: `${PUBLIC_WEB_URL}/dashboard/bookings?payment=success&booking_id=${booking.id}`,
        cancel_url: `${PUBLIC_WEB_URL}/dashboard/bookings?payment=cancelled&booking_id=${booking.id}`,
      },
      // A renewal after an abandoned/expired session is a genuinely new attempt,
      // so it gets a fresh key; a plain retry reuses the stored anchor.
      { idempotencyKey: booking.payment?.stripeCheckoutSessionId ? `${sub.idempotencyKey}:${Date.now()}` : sub.idempotencyKey },
    );
  } catch (error) {
    console.error("Stripe Checkout creation failed", { bookingId: booking.id, subscriptionId: sub.id, code: error.code });
    return res.status(503).json({ error: "Secure checkout is temporarily unavailable. Please try again.", retryable: true });
  }

  await prisma.payment.update({ where: { bookingId: booking.id }, data: { stripeCheckoutSessionId: session.id } });
  res.json({ url: session.url });
}

// =============================================================================
// PART C2 — Customer cancellation (period-end, no refund)
// =============================================================================

// A customer cancels their OWN monthly subscription. Semantics:
//   - Active Stripe billing  -> Stripe cancel_at_period_end=true (NEVER an
//     immediate cancel, NEVER a refund) with a stable idempotency key, then the
//     local cancelAtPeriodEnd=true. Stripe's own customer.subscription.deleted
//     webhook later flips status to completed/canceled + canceledAt, so the
//     current paid period stays fully active and untouched.
//   - Already scheduled -> idempotent return of the existing state, no second
//     Stripe operation.
//   - Already canceled/completed -> existing-state 409, no Stripe operation.
//   - Pending/accepted (no Stripe billing started yet) -> pure local status
//     transition to canceled + canceledAt (nothing paid, no Stripe object), the
//     same terminal outcome the webhook already produces, which also disables
//     "Pay Now"/checkout (they reject canceled subscriptions).
// The final-month admin gate (finalCancelPending/finalizeStripeCancelAtPeriodEnd)
// is a separate mechanism and is never bypassed.
export async function cancelSubscription(req, res, deps = {}) {
  const db = deps.db || prisma;
  const client = deps.stripeClient ?? (stripeSecretKeyMode() ? stripe : null);

  const booking = await db.booking.findUnique({
    where: { id: req.params.id },
    include: subscriptionInclude,
  });
  if (!booking || booking.customerId !== req.user.id) return res.status(404).json({ error: "Booking not found" });
  const sub = booking.subscription;
  if (!sub) return badRequest(res, "This booking is not a monthly subscription");
  if (sub.customerId !== req.user.id) return res.status(404).json({ error: "Subscription not found" });

  if (["canceled", "completed"].includes(sub.status)) {
    return res.status(409).json({ error: "This subscription has already ended", code: "SUBSCRIPTION_ENDED", subscription: sub });
  }
  if (sub.cancelAtPeriodEnd) {
    return res.json({ ok: true, alreadyScheduled: true, cancelAtPeriodEnd: true, subscription: sub });
  }

  // No Stripe billing has started yet (pending/accepted pre-payment): a pure
  // status transition. No Stripe call, no refund semantics.
  if (!sub.stripeSubscriptionId) {
    const updated = await db.subscription.update({
      where: { id: sub.id },
      data: { status: "canceled", canceledAt: new Date() },
    });
    return res.json({ ok: true, cancelAtPeriodEnd: false, subscription: updated });
  }

  if (!client) {
    return res.status(503).json({ error: "Stripe test mode is not configured", retryable: true });
  }
  try {
    await client.subscriptions.update(
      sub.stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: `${sub.idempotencyKey}:customer-cancel` },
    );
  } catch (error) {
    console.error("Stripe subscription cancel-at-period-end failed", { subscriptionId: sub.id, code: error.code });
    return res.status(503).json({ error: "Unable to schedule cancellation right now. Please try again.", retryable: true });
  }
  // Stripe confirmed the schedule; the local row is updated only now, so a
  // Stripe failure leaves a retryable state (cancelAtPeriodEnd still false).
  const updated = await db.subscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: true },
  });
  res.json({ ok: true, cancelAtPeriodEnd: true, subscription: updated });
}

// =============================================================================
// PART D/E/F/H — Stripe webhook handling for monthly subscriptions
// =============================================================================

// These run inside the existing Stripe webhook transaction (see
// payments.processEvent). They are fully idempotent: the per-event
// stripeWebhookEvent row dedups exact deliveries and every DB write here is
// backed by a unique constraint in the approved schema.

export function isSubscriptionEvent(event) {
  const data = event.data?.object || {};
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    return data.mode === "subscription" || Boolean(data.subscription);
  }
  return ["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "customer.subscription.deleted"].includes(event.type);
}

export async function processSubscriptionWebhook(tx, event) {
  const data = event.data?.object || {};
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    return processSubscriptionSessionCompleted(tx, data);
  }
  if (event.type === "invoice.paid") return processSubscriptionInvoicePaid(tx, data);
  if (event.type === "invoice.payment_failed") return processSubscriptionInvoicePaymentFailed(tx, data);
  if (event.type === "invoice.payment_action_required") {
    console.warn("Stripe subscription invoice requires customer action — no month activated", { invoiceId: data.id });
    return { ignored: "payment-action-required" };
  }
  if (event.type === "customer.subscription.deleted") return processSubscriptionDeleted(tx, data);
  return { ignored: "unknown-subscription-event" };
}

// PART D — checkout.session.completed: associate the Stripe subscription/session
// information. It DOES NOT activate month 1 — invoice.paid is authoritative for
// that.
async function processSubscriptionSessionCompleted(tx, data) {
  const subscriptionId = data.metadata?.subscriptionId;
  const bookingId = data.metadata?.bookingId;
  let sub = null;
  if (subscriptionId) sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub && bookingId) sub = await tx.subscription.findUnique({ where: { bookingId } });
  if (!sub) {
    console.warn("Stripe webhook: subscription checkout session, subscription not found", { bookingId, subscriptionId, sessionId: data.id });
    return { ignored: "subscription-not-found" };
  }

  const update = {};
  if (typeof data.subscription === "string" && data.subscription) update.stripeSubscriptionId = data.subscription;
  if (Object.keys(update).length > 0) {
    await tx.subscription.update({ where: { id: sub.id }, data: update });
  }
  if (typeof data.id === "string") {
    await tx.payment.update({ where: { bookingId: sub.bookingId }, data: { stripeCheckoutSessionId: data.id } }).catch((error) => {
      if (error.code !== "P2025") throw error;
    });
  }
  return { subscriptionId: sub.id };
}

// PART E — invoice.paid: activates exactly the next paid month. Idempotent
// through the unique stripeInvoiceId and (subscriptionId, periodIndex) lanes.
// Never activates more than Subscription.months.
async function processSubscriptionInvoicePaid(tx, data) {
  const stripeSubscriptionId = data.subscription;
  if (typeof stripeSubscriptionId !== "string" || !stripeSubscriptionId) return { ignored: "missing-subscription" };

  const sub = await tx.subscription.findUnique({ where: { stripeSubscriptionId } });
  if (!sub) {
    console.warn("Stripe webhook: invoice.paid for unknown subscription", { stripeSubscriptionId, invoiceId: data.id });
    return { ignored: "subscription-not-found" };
  }

  // Already processed (idempotency).
  if (typeof data.id === "string" && data.id) {
    const existing = await tx.subscriptionBooking.findUnique({ where: { stripeInvoiceId: data.id } });
    if (existing) return { subscriptionId: sub.id, duplicate: true, periodIndex: existing.periodIndex };
  }

  // Safety: never advance past the selected term.
  if (sub.monthCompleted >= sub.months) {
    console.warn("Stripe webhook: invoice.paid beyond selected term — not activating", { subscriptionId: sub.id, monthCompleted: sub.monthCompleted, months: sub.months, invoiceId: data.id });
    return { subscriptionId: sub.id, ignored: "term-complete" };
  }

  const periodIndex = sub.monthCompleted + 1;
  const periodStart = Number.isInteger(data.period_start) ? new Date(data.period_start * 1000) : new Date();
  const periodEnd = Number.isInteger(data.period_end) ? new Date(data.period_end * 1000) : new Date();
  const paidCents = Number.isInteger(data.amount_paid) ? data.amount_paid : Number.isInteger(data.amount_due) ? data.amount_due : sub.monthlyPriceCents;
  const legacyMonthly = centsToLegacyDollars(sub.monthlyPriceCents);

  const monthBooking = await tx.booking.create({
    data: {
      customerId: sub.customerId,
      serviceId: sub.serviceId,
      date: periodStart,
      status: "accepted",
      price: legacyMonthly,
      basePriceCents: sub.monthlyPriceCents,
    },
  });

  const monthPayment = await tx.payment.create({
    data: {
      bookingId: monthBooking.id,
      method: "online",
      status: "paid",
      amount: legacyMonthly,
      amountPaid: centsToLegacyDollars(paidCents),
      amountPaidCents: paidCents,
      finalAmountCents: paidCents,
      paidAt: new Date(),
      stripePaymentIntentId: typeof data.payment_intent === "string" ? data.payment_intent : null,
    },
  });

  await tx.subscriptionBooking.create({
    data: {
      subscriptionId: sub.id,
      bookingId: monthBooking.id,
      periodIndex,
      periodStart,
      periodEnd,
      stripeInvoiceId: typeof data.id === "string" ? data.id : null,
    },
  });

  await tx.subscriptionPayment.create({
    data: {
      subscriptionId: sub.id,
      paymentId: monthPayment.id,
      periodIndex,
      stripeInvoiceId: typeof data.id === "string" ? data.id : null,
      status: "paid",
    },
  });

  const termComplete = periodIndex >= sub.months;
  const subscriptionUpdate = {
    monthCompleted: periodIndex,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    status: "active",
  };
  if (termComplete) {
    // PART G — durable final-cancel gate persisted BEFORE any Stripe call, so a
    // failed cancel request can be retried/reconciled and never overcharges.
    subscriptionUpdate.finalCancelPending = true;
    subscriptionUpdate.finalCancelPendingAt = new Date();
  }
  await tx.subscription.update({ where: { id: sub.id }, data: subscriptionUpdate });

  return {
    subscriptionId: sub.id,
    periodIndex,
    termComplete,
    finalCancel: termComplete ? { subscriptionId: sub.id } : null,
  };
}

// PART F — invoice.payment_failed: mark the subscription past-due WITHOUT
// creating/activating a new month. A later invoice.paid after recovery is
// processed normally and idempotently.
async function processSubscriptionInvoicePaymentFailed(tx, data) {
  const stripeSubscriptionId = data.subscription;
  if (typeof stripeSubscriptionId !== "string" || !stripeSubscriptionId) return { ignored: "missing-subscription" };

  const sub = await tx.subscription.findUnique({ where: { stripeSubscriptionId } });
  if (!sub) {
    console.warn("Stripe webhook: invoice.payment_failed for unknown subscription", { stripeSubscriptionId, invoiceId: data.id });
    return { ignored: "subscription-not-found" };
  }
  if (sub.monthCompleted >= sub.months || sub.status === "completed" || sub.status === "canceled") {
    return { ignored: "term-finished" };
  }

  await tx.subscription.update({ where: { id: sub.id }, data: { status: "past_due" } });
  console.warn("Stripe webhook: subscription invoice payment failed — no monthly booking activated", { subscriptionId: sub.id, invoiceId: data.id });
  return { subscriptionId: sub.id, failed: true };
}

// PART H — customer.subscription.deleted: mark the subscription completed (full
// term paid) or canceled otherwise. Historical monthly bookings/payments are
// preserved; the Subscription row is never deleted.
async function processSubscriptionDeleted(tx, data) {
  const stripeSubscriptionId = data.id;
  if (typeof stripeSubscriptionId !== "string" || !stripeSubscriptionId) return { ignored: "missing-subscription" };

  const sub = await tx.subscription.findUnique({ where: { stripeSubscriptionId } });
  if (!sub) {
    console.warn("Stripe webhook: customer.subscription.deleted for unknown subscription", { stripeSubscriptionId });
    return { ignored: "subscription-not-found" };
  }
  const termComplete = sub.monthCompleted >= sub.months;
  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      status: termComplete ? "completed" : "canceled",
      canceledAt: new Date(),
      cancelAtPeriodEnd: true,
      ...(termComplete ? { completedAt: new Date() } : {}),
    },
  });
  return { subscriptionId: sub.id, canceled: true, termComplete };
}

// =============================================================================
// PART G — finalize the final-month cancel-at-period-end with Stripe
// =============================================================================

// Runs AFTER the invoice.paid transaction has durably persisted the final month
// and finalCancelPending=true. Only Stripes' successful confirmation flips
// cancelAtPeriodEnd=true. On failure the durable pending state remains so a
// reconciliation mechanism can safely retry.
export async function finalizeStripeCancelAtPeriodEnd({ subscriptionId }, deps = {}) {
  const db = deps.db || prisma;
  const client = deps.stripeClient || stripe;
  const sub = await db.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub || !sub.stripeSubscriptionId) return { skipped: "missing" };
  if (!sub.finalCancelPending) return { skipped: "not-pending" };
  if (sub.finalCancelConfirmedAt) return { alreadyConfirmed: true };
  if (sub.cancelAtPeriodEnd) {
    await db.subscription.update({
      where: { id: sub.id },
      data: { finalCancelPending: false, finalCancelConfirmedAt: new Date() },
    });
    return { alreadyConfirmed: true };
  }
  if (!client) throw new Error("Stripe not configured");

  await client.subscriptions.update(
    sub.stripeSubscriptionId,
    { cancel_at_period_end: true },
    { idempotencyKey: `${sub.idempotencyKey}:final-cancel` },
  );

  await db.subscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: true, finalCancelPending: false, finalCancelConfirmedAt: new Date() },
  });
  return { ok: true };
}