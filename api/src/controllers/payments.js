import Stripe from "stripe";
import prisma from "../utils/prisma.js";
import { badRequest } from "../utils/validators.js";
import { PUBLIC_WEB_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from "../config.js";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const paymentInclude = { service: true, customer: { select: { name: true, email: true } }, payment: true };

export async function createCheckout(req, res) {
  if (!stripe || !STRIPE_SECRET_KEY.startsWith("sk_test_")) return res.status(503).json({ error: "Stripe test mode is not configured" });
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: paymentInclude });
  if (!booking || booking.customerId !== req.user.id) return res.status(404).json({ error: "Booking not found" });
  if (!booking.payment || booking.payment.method !== "online") return badRequest(res, "This booking is not an online payment");
  if (["paid", "refunded"].includes(booking.payment.status)) {
    return badRequest(res, `This booking's payment is already ${booking.payment.status} and cannot be paid again`);
  }
  if (booking.payment.stripeCheckoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(booking.payment.stripeCheckoutSessionId);
    if (session.status === "open") return res.json({ url: session.url });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: booking.customer.email,
    line_items: [{ price_data: { currency: "usd", product_data: { name: booking.service.name }, unit_amount: Math.round(booking.price * 100) }, quantity: 1 }],
    metadata: { bookingId: booking.id },
    payment_intent_data: { metadata: { bookingId: booking.id } },
    success_url: `${PUBLIC_WEB_URL}/dashboard/bookings?payment=success&booking_id=${booking.id}`,
    cancel_url: `${PUBLIC_WEB_URL}/dashboard/bookings?payment=cancelled&booking_id=${booking.id}`,
  });

  await prisma.payment.update({ where: { bookingId: booking.id }, data: { stripeCheckoutSessionId: session.id } });
  res.json({ url: session.url });
}

async function processEvent(tx, event) {
  const data = event.data.object;
  const bookingId = data.metadata?.bookingId;
  const paymentWhere = bookingId
    ? { bookingId }
    : data.id.startsWith("cs_")
      ? { stripeCheckoutSessionId: data.id }
      : { stripePaymentIntentId: data.payment_intent || data.id };
  const payment = await tx.payment.findFirst({ where: paymentWhere });
  if (!payment) return;

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (data.payment_status !== "paid" && event.type === "checkout.session.completed") return;
    const total = data.amount_total == null ? payment.amount : data.amount_total / 100;
    if (Math.abs(total - payment.amount) > 0.01) {
      const mismatch = new Error("Stripe webhook amount does not match stored Payment.amount");
      mismatch.code = "PAYMENT_AMOUNT_MISMATCH";
      mismatch.details = {
        eventId: event.id,
        eventType: event.type,
        bookingId: payment.bookingId,
        paymentId: payment.id,
        expectedAmount: payment.amount,
        receivedAmount: total,
      };
      throw mismatch;
    }
    if (payment.status === "refunded") return;
    await tx.payment.update({ where: { id: payment.id }, data: { status: "paid", amountPaid: total, paidAt: new Date(), stripePaymentIntentId: typeof data.payment_intent === "string" ? data.payment_intent : payment.stripePaymentIntentId } });
  } else if (event.type === "checkout.session.expired") {
    if (payment.status !== "paid" && payment.status !== "refunded") await tx.payment.update({ where: { id: payment.id }, data: { status: "cancelled" } });
  } else if (event.type === "payment_intent.payment_failed" || event.type === "checkout.session.async_payment_failed") {
    if (payment.status !== "paid" && payment.status !== "refunded") await tx.payment.update({ where: { id: payment.id }, data: { status: "failed", failureReason: data.last_payment_error?.message || "Payment failed", stripePaymentIntentId: data.id.startsWith("pi_") ? data.id : payment.stripePaymentIntentId } });
  } else if (event.type === "charge.refunded") {
    if (payment.status === "paid") await tx.payment.update({ where: { id: payment.id }, data: { status: "refunded", refundedAt: new Date(), amountPaid: 0 } });
  }
}

export async function stripeWebhook(req, res) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: "Stripe webhook is not configured" });
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET); }
  catch (error) { return res.status(400).json({ error: `Webhook signature verification failed: ${error.message}` }); }
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
