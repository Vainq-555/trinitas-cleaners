import prisma from "../utils/prisma.js";
import { badRequest, isDate, isValidBookingStatus } from "../utils/validators.js";
import { effectivePrice } from "./services.js";
import { dollarsToCents } from "../utils/money.js";
import { calculatePreTaxQuote } from "../utils/promotions.js";
import { promotionSnapshot } from "../utils/pricing.js";
import { claimPromotionUsage } from "../utils/promotionUsage.js";
import { normalizeServiceAddress } from "../utils/serviceAddress.js";

const bookingInclude = {
  service: true,
  payment: true,
  // Exposes the linked monthly Subscription (when this booking is the request
  // lane of a monthly booking) so customer and admin booking lists can display
  // the subscription's own status, term, monthly price snapshot and
  // cancellation state. Present (non-null) only for monthly bookings; one-time
  // bookings have null here. Additive read-only include — no business logic.
  subscription: true,
  customer: {
    select: { id: true, name: true, email: true, phone: true, address: true },
  },
};

// ---- Customer side ----

export async function createBooking(req, res) {
  const { serviceId, date, note, paymentMethod = "cash", promoCode, serviceAddress } = req.body || {};
  if (!["cash", "online"].includes(paymentMethod)) {
    return badRequest(res, "paymentMethod must be cash or online");
  }
  if (!serviceId || !isDate(date)) {
    return badRequest(res, "serviceId and a valid date are required");
  }
  if (new Date(date).getTime() < Date.now() - 86400000) {
    return badRequest(res, "Booking date cannot be in the past");
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.isActive) return badRequest(res, "Service not found");

  const price = await effectivePrice(service, req.user.id);
  let basePriceCents;
  try {
    basePriceCents = dollarsToCents(price);
  } catch {
    return badRequest(res, "This service has an invalid price and cannot be booked online");
  }
  const promotions = await prisma.promotion.findMany({
    where: { OR: [{ services: { none: {} } }, { services: { some: { serviceId: service.id } } }] },
    include: { services: true },
  });
  const preTaxQuote = calculatePreTaxQuote({ basePriceCents, promotions, serviceId: service.id, promoCode });
  if (promoCode && !preTaxQuote.promotion) return badRequest(res, "That promotion code is invalid or unavailable");
  // Structural validation of any submitted service address BEFORE persist, so
  // a malformed address can never block later Stripe Tax calculation. This is
  // syntax-only; it does not compute tax. A missing address is still allowed
  // (tax is then captured at checkout/collection as before).
  const normalizedAddress = serviceAddress
    ? normalizeServiceAddress(serviceAddress)
    : null;
  if (normalizedAddress && !normalizedAddress.ok) {
    return badRequest(res, normalizedAddress.error);
  }
  const address = normalizedAddress ? normalizedAddress.address : {};
  const snapshot = promotionSnapshot(preTaxQuote);
  let booking;
  try {
    booking = await prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          customerId: req.user.id,
          serviceId: service.id,
          date: new Date(date),
          note: note || null,
          status: "pending",
          price,
          basePriceCents: preTaxQuote.basePriceCents,
          discountCents: preTaxQuote.discountCents,
          taxableSubtotalCents: preTaxQuote.taxableSubtotalCents,
          ...snapshot,
          taxAddressLine1: typeof address.line1 === "string" ? address.line1.trim() : null,
          taxAddressLine2: typeof address.line2 === "string" ? address.line2.trim() || null : null,
          taxAddressCity: typeof address.city === "string" ? address.city.trim() : null,
          taxAddressState: typeof address.state === "string" ? address.state.trim() : null,
          taxAddressPostalCode: typeof address.postalCode === "string" ? address.postalCode.trim() : null,
          taxAddressCountry: typeof address.country === "string" ? address.country.trim() : null,
          payment: {
            create: { method: paymentMethod, status: paymentMethod === "cash" ? "unpaid" : "pending", amount: price },
          },
        },
        include: bookingInclude,
      });
      if (preTaxQuote.promotion) await claimPromotionUsage(tx, created);
      return created;
    });
  } catch (error) {
    if (error.code === "PROMOTION_UNAVAILABLE") return badRequest(res, error.message);
    throw error;
  }

  // Notify the admin of the new booking.
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  if (admin) {
    await prisma.broadcast.create({
      data: {
        type: "notification",
        target: "specific_user",
        userId: admin.id,
        title: "New booking request",
        content: `${req.user.name} booked "${service.name}" for ${booking.date.toLocaleDateString(
          "en-US",
          { weekday: "short", month: "short", day: "numeric" }
        )}.`,
      },
    });
  }

  res.status(201).json({ booking, requiresCheckout: paymentMethod === "online" });
}

export async function deleteBooking(req, res) {
  const { id } = req.params;
  const booking = await prisma.booking.findUnique({ where: { id }, include: { payment: true } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  // Only Worked bookings may be archived.
  if (booking.status !== "worked") {
    return res.status(403).json({ error: "Only Worked bookings may be archived" });
  }

  // If already archived, idempotently return success.
  if (booking.archivedAt !== null) {
    return res.json({ ok: true });
  }

  // Customer may archive only their own Worked booking.
  // Admin may archive any Worked booking.
  if (req.user.role !== "admin" && booking.customerId !== req.user.id) {
    return res.status(403).json({ error: "You can only archive your own bookings" });
  }

  await prisma.booking.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  res.json({ ok: true });
}

export async function listMyBookings(req, res) {
  const bookings = await prisma.booking.findMany({
    where: {
      customerId: req.user.id,
      archivedAt: null,
      // Hide paid monthly-period bookings (the SubscriptionBooking-backed lanes
      // created by invoice.paid). They remain in the database for
      // bookkeeping/receipts, but the customer's "My Bookings" list shows only
      // the original monthly request booking (carries Booking.subscription) and
      // normal one-time bookings. The exclusion specifically targets the
      // SubscriptionBooking relation, NOT `subscription: null` — one-time and
      // month-lane bookings both have subscription = null.
      NOT: { subscriptionBookings: { some: {} } },
    },
    orderBy: { createdAt: "desc" },
    include: bookingInclude,
  });
  res.json({ bookings });
}

// ---- Admin side ----

export async function adminListBookings(req, res) {
  const { status } = req.query;
  const where = status && isValidBookingStatus(status)
    ? { status, archivedAt: null }
    : { archivedAt: null };
  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: bookingInclude,
  });
  res.json({ bookings });
}

// Accept or decline a booking request. Accepted bookings that are marked
// "worked" move into the "Accepted & Worked" session; declined ones are saved
// in the "Declined Bookings" session.
export async function adminSetBookingStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!isValidBookingStatus(status)) {
    return badRequest(res, "status must be pending | accepted | declined | worked");
  }

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const updated = await prisma.booking.update({ where: { id }, data: { status } });

  // Monthly subscription: reflect the admin decision on the linked Subscription
  // (accepted = ready for the customer's explicit "Pay Now"; declined = rejected).
  // No Stripe objects are created here.
  if (status === "accepted" || status === "declined") {
    const subscription = await prisma.subscription.findUnique({ where: { bookingId: id } });
    if (subscription) {
      await prisma.subscription.update({ where: { id: subscription.id }, data: { status } });
    }
  }

  // Notify the customer of the decision.
  await prisma.broadcast.create({
    data: {
      type: "notification",
      target: "specific_user",
      userId: booking.customerId,
      title: "Booking update",
      content: `Your booking (#${id.slice(0, 6).toUpperCase()}) was ${
        status === "accepted" ? "accepted" : status === "declined" ? "declined" : "marked as worked"
      }.`,
    },
  });

  res.json({ booking: updated });
}
