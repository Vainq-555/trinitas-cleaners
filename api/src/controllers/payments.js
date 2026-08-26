import Stripe from "stripe";
import prisma from "../utils/prisma.js";
import { badRequest } from "../utils/validators.js";
import { PUBLIC_WEB_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from "../config.js";
import { dollarsToCents, centsToLegacyDollars, basisPointsToLegacyRate } from "../utils/money.js";
import { calculatePreTaxQuote } from "../utils/promotions.js";
import { calculateStripeTax, TaxAddressRequiredError, TaxUnavailableError } from "../utils/tax.js";
import { calculateFinalQuote, promotionSnapshot } from "../utils/pricing.js";
import { claimPromotionUsage } from "../utils/promotionUsage.js";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const paymentInclude = { service: true, customer: { select: { name: true, email: true } }, payment: true };

function addressDiagnostics(address) {
  const fields = ["line1", "city", "state", "postalCode", "country"];
  return {
    present: Boolean(address),
    fields: Object.fromEntries(fields.map((field) => [field, {
      type: typeof address?.[field],
      nonEmpty: typeof address?.[field] === "string" && Boolean(address[field].trim()),
      length: typeof address?.[field] === "string" ? address[field].trim().length : 0,
    }])),
  };
}

export function assertPaidAmountMatches(expectedCents, receivedCents) {
  if (!Number.isInteger(expectedCents) || !Number.isInteger(receivedCents) || receivedCents !== expectedCents) {
    const mismatch = new Error("Stripe webhook amount does not match stored final amount");
    mismatch.code = "PAYMENT_AMOUNT_MISMATCH";
    throw mismatch;
  }
}

function bookingAddress(booking) {
  return {
    line1: booking.taxAddressLine1,
    line2: booking.taxAddressLine2,
    city: booking.taxAddressCity,
    state: booking.taxAddressState,
    postalCode: booking.taxAddressPostalCode,
    country: booking.taxAddressCountry,
  };
}

function addressFields(address) {
  return {
    taxAddressLine1: address.line1,
    taxAddressLine2: address.line2 || null,
    taxAddressCity: address.city,
    taxAddressState: address.state,
    taxAddressPostalCode: address.postalCode,
    taxAddressCountry: address.country,
  };
}

function publicQuote(quote) {
  return {
    basePriceCents: quote.basePriceCents,
    discountCents: quote.discountCents,
    taxableSubtotalCents: quote.taxableSubtotalCents,
    taxCents: quote.taxCents,
    taxRateBasisPoints: quote.taxRateBasisPoints,
    finalAmountCents: quote.finalAmountCents,
    taxCalculationId: quote.taxCalculationId,
    promotion: quote.promotion
      ? { code: quote.promotion.code, name: quote.promotion.name, discountType: quote.promotion.discountType, discountValue: quote.promotion.discountValue }
      : null,
  };
}

async function calculateBookingQuote(booking, serviceAddress) {
  let preTax;
  if (Number.isInteger(booking.basePriceCents) && Number.isInteger(booking.taxableSubtotalCents)) {
    preTax = {
      basePriceCents: booking.basePriceCents,
      discountCents: booking.discountCents || 0,
      taxableSubtotalCents: booking.taxableSubtotalCents,
      promotion: booking.promotionId
        ? { id: booking.promotionId, code: booking.promotionCodeSnapshot, name: booking.promotionNameSnapshot, discountType: booking.promotionDiscountTypeSnapshot, discountValue: booking.promotionDiscountValueSnapshot }
        : null,
    };
  } else {
    // Legacy Float values are converted only at this compatibility boundary.
    preTax = calculatePreTaxQuote({ basePriceCents: dollarsToCents(booking.price), serviceId: booking.serviceId, promotions: [] });
  }

  const rawAddress = serviceAddress || bookingAddress(booking);
  const tax = await calculateStripeTax({ stripe, amountCents: preTax.taxableSubtotalCents, serviceId: booking.serviceId, address: rawAddress });
  return { ...calculateFinalQuote({ preTax, serviceId: booking.serviceId, tax }), taxAddress: {
    line1: rawAddress.line1,
    line2: rawAddress.line2 || null,
    city: rawAddress.city,
    state: rawAddress.state,
    postalCode: rawAddress.postalCode,
    country: rawAddress.country,
  } };
}

async function saveQuote(booking, quote) {
  const snapshot = promotionSnapshot(quote);
  const data = {
    basePriceCents: quote.basePriceCents,
    discountCents: quote.discountCents,
    taxableSubtotalCents: quote.taxableSubtotalCents,
    taxRateBasisPoints: quote.taxRateBasisPoints,
    taxCents: quote.taxCents,
    finalAmountCents: quote.finalAmountCents,
    taxCalculationId: quote.taxCalculationId,
    ...(quote.taxAddress ? addressFields(quote.taxAddress) : {}),
    ...snapshot,
  };
  return prisma.booking.update({ where: { id: booking.id }, data });
}

export async function createCheckout(req, res) {
  const { confirm = false, approvedFinalAmountCents, serviceAddress } = req.body || {};
  console.info("Checkout service address received", addressDiagnostics(serviceAddress));
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: paymentInclude });
  if (!booking || booking.customerId !== req.user.id) return res.status(404).json({ error: "Booking not found" });
  if (!booking.payment || booking.payment.method !== "online") return badRequest(res, "This booking is not an online payment");
  if (["paid", "refunded"].includes(booking.payment.status)) return badRequest(res, `This booking's payment is already ${booking.payment.status} and cannot be paid again`);
  console.info("Checkout stored service address", addressDiagnostics(bookingAddress(booking)));

  let quote;
  try {
    if (Number.isInteger(booking.finalAmountCents) && Number.isInteger(booking.taxCents)) {
      quote = {
        basePriceCents: booking.basePriceCents,
        discountCents: booking.discountCents || 0,
        taxableSubtotalCents: booking.taxableSubtotalCents,
        taxCents: booking.taxCents,
        taxRateBasisPoints: booking.taxRateBasisPoints,
        finalAmountCents: booking.finalAmountCents,
        taxCalculationId: booking.taxCalculationId,
        promotion: booking.promotionId ? { code: booking.promotionCodeSnapshot, name: booking.promotionNameSnapshot, discountType: booking.promotionDiscountTypeSnapshot, discountValue: booking.promotionDiscountValueSnapshot } : null,
      };
    } else {
      quote = await calculateBookingQuote(booking, serviceAddress);
      await saveQuote(booking, quote);
    }
  } catch (error) {
    if (error instanceof TaxAddressRequiredError || error.code === "TAX_ADDRESS_REQUIRED") {
      return res.status(422).json({ error: error.message, code: "TAX_ADDRESS_REQUIRED", requiresAddress: true });
    }
    if (error instanceof TaxUnavailableError || error.code === "TAX_UNAVAILABLE") return res.status(503).json({ error: error.message, retryable: error.retryable !== false });
    if (error.message?.includes("Money value")) return res.status(409).json({ error: "This legacy booking cannot be safely repriced" });
    console.error("Checkout quote failed", error);
    return res.status(500).json({ error: "Unable to prepare checkout" });
  }

  if (!confirm) return res.json({ requiresConfirmation: true, quote: publicQuote(quote) });
  if (!Number.isInteger(approvedFinalAmountCents) || approvedFinalAmountCents !== quote.finalAmountCents) return badRequest(res, "The approved amount does not match the current quote");
  if (!stripe || !STRIPE_SECRET_KEY.startsWith("sk_test_")) return res.status(503).json({ error: "Stripe test mode is not configured", retryable: true });

  if (booking.promotionId && !booking.promotionUsageClaimedAt) {
    try {
      await prisma.$transaction((tx) => claimPromotionUsage(tx, booking));
    } catch (error) {
      return badRequest(res, error.message);
    }
  }

  // Persist the amount before creating Checkout so the webhook always has an
  // authoritative cents value, even if the session request is retried.
  await prisma.payment.update({
    where: { bookingId: booking.id },
    data: { finalAmountCents: quote.finalAmountCents, amount: centsToLegacyDollars(quote.finalAmountCents) },
  });

  if (booking.payment.stripeCheckoutSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(booking.payment.stripeCheckoutSessionId);
      if (existing.status === "open") return res.json({ url: existing.url, quote: publicQuote(quote) });
    } catch {
      // A stale session is replaced by a new session below.
    }
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: booking.customer.email,
      line_items: [{ price_data: { currency: "usd", product_data: { name: booking.service.name }, unit_amount: quote.finalAmountCents }, quantity: 1 }],
      metadata: { bookingId: booking.id, taxCalculationId: quote.taxCalculationId },
      payment_intent_data: { metadata: { bookingId: booking.id, taxCalculationId: quote.taxCalculationId } },
      success_url: `${PUBLIC_WEB_URL}/dashboard/bookings?payment=success&booking_id=${booking.id}`,
      cancel_url: `${PUBLIC_WEB_URL}/dashboard/bookings?payment=cancelled&booking_id=${booking.id}`,
    });
  } catch (error) {
    console.error("Stripe Checkout creation failed", { bookingId: booking.id, code: error.code });
    return res.status(503).json({ error: "Secure checkout is temporarily unavailable. Please try again.", retryable: true });
  }

  await prisma.payment.update({ where: { bookingId: booking.id }, data: { stripeCheckoutSessionId: session.id } });
  res.json({ url: session.url, quote: publicQuote(quote) });
}

export function receiptSnapshotData(booking, payment) {
  if (!Number.isInteger(booking.finalAmountCents) || !Number.isInteger(payment.finalAmountCents)) return null;
  return {
    customerId: booking.customerId,
    bookingId: booking.id,
    subtotal: centsToLegacyDollars(booking.taxableSubtotalCents),
    taxRate: basisPointsToLegacyRate(booking.taxRateBasisPoints || 0),
    tax: centsToLegacyDollars(booking.taxCents),
    discount: centsToLegacyDollars(booking.discountCents || 0),
    total: centsToLegacyDollars(payment.finalAmountCents),
    baseAmountCents: booking.basePriceCents,
    discountCents: booking.discountCents,
    taxableSubtotalCents: booking.taxableSubtotalCents,
    taxRateBasisPoints: booking.taxRateBasisPoints,
    taxCents: booking.taxCents,
    finalAmountCents: payment.finalAmountCents,
  };
}

async function createSnapshotReceipt(tx, booking, payment) {
  const data = receiptSnapshotData(booking, payment);
  if (!data) return;
  const existing = await tx.receipt.findFirst({ where: { bookingId: booking.id } });
  if (existing) return;
  await tx.receipt.create({ data });
}

async function processEvent(tx, event) {
  const data = event.data.object;
  const bookingId = data.metadata?.bookingId;
  const paymentWhere = bookingId ? { bookingId } : data.id.startsWith("cs_") ? { stripeCheckoutSessionId: data.id } : { stripePaymentIntentId: data.payment_intent || data.id };
  const payment = await tx.payment.findFirst({ where: paymentWhere });
  if (!payment) return;

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (data.payment_status !== "paid" && event.type === "checkout.session.completed") return;
    const receivedCents = data.amount_total;
    const expectedCents = payment.finalAmountCents;
    try { assertPaidAmountMatches(expectedCents, receivedCents); }
    catch (error) {
      error.details = { eventId: event.id, eventType: event.type, bookingId: payment.bookingId, paymentId: payment.id, expectedCents, receivedCents };
      throw error;
    }
    if (payment.status === "refunded") return;
    const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: "paid", amountPaidCents: receivedCents, amountPaid: centsToLegacyDollars(receivedCents), paidAt: new Date(), stripePaymentIntentId: typeof data.payment_intent === "string" ? data.payment_intent : payment.stripePaymentIntentId } });
    const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
    if (booking) {
      if (booking.status === "pending") await tx.booking.update({ where: { id: booking.id }, data: { status: "accepted" } });
      await createSnapshotReceipt(tx, booking, updated);
    }
  } else if (event.type === "checkout.session.expired") {
    if (payment.status !== "paid" && payment.status !== "refunded") await tx.payment.update({ where: { id: payment.id }, data: { status: "cancelled" } });
  } else if (event.type === "payment_intent.payment_failed" || event.type === "checkout.session.async_payment_failed") {
    if (payment.status !== "paid" && payment.status !== "refunded") await tx.payment.update({ where: { id: payment.id }, data: { status: "failed", failureReason: data.last_payment_error?.message || "Payment failed", stripePaymentIntentId: data.id.startsWith("pi_") ? data.id : payment.stripePaymentIntentId } });
  } else if (event.type === "charge.refunded") {
    if (payment.status === "paid") await tx.payment.update({ where: { id: payment.id }, data: { status: "refunded", refundedAt: new Date(), amountPaid: 0, amountPaidCents: 0 } });
  }
}

export async function stripeWebhook(req, res) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.error("Stripe webhook received but not configured", { hasStripe: Boolean(stripe), hasSecret: Boolean(STRIPE_WEBHOOK_SECRET) });
    return res.status(503).json({ error: "Stripe webhook is not configured" });
  }
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET); }
  catch (error) {
    console.error("Stripe webhook signature verification failed", { message: error.message });
    return res.status(400).json({ error: `Webhook signature verification failed: ${error.message}` });
  }
  console.info("Stripe webhook received", { eventType: event.type, eventId: event.id });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.stripeWebhookEvent.create({ data: { eventId: event.id, eventType: event.type } });
      await processEvent(tx, event);
    });
  } catch (error) {
    if (error.code === "P2002" && error.meta?.target?.includes("eventId")) return res.json({ received: true, duplicate: true });
    if (error.code === "PAYMENT_AMOUNT_MISMATCH") {
      console.error("Stripe webhook amount mismatch — payment left unchanged", error.details);
      return res.status(409).json({ error: "Payment amount mismatch; event not applied" });
    }
    console.error("Stripe webhook processing failed", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
  res.json({ received: true });
}
