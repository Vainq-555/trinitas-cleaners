import prisma from "../utils/prisma.js";
import { badRequest, isDate, isValidBookingStatus } from "../utils/validators.js";
import { effectivePrice } from "./services.js";
import { dollarsToCents } from "../utils/money.js";
import { calculatePreTaxQuote } from "../utils/promotions.js";
import { promotionSnapshot } from "../utils/pricing.js";
import { claimPromotionUsage } from "../utils/promotionUsage.js";

const bookingInclude = {
  service: true,
  payment: true,
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
  if (!service) return badRequest(res, "Service not found");

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
  const address = serviceAddress || {};
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
  if (booking.customerId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "You can only delete your own bookings" });
  }
  // A paid booking must not be deleted: deleting it cascades to the Payment
  // record, losing the record of collected funds without any refund flow.
  if (req.user.role !== "admin" && booking.payment?.status === "paid") {
    return res.status(403).json({
      error: "This booking has already been paid and cannot be deleted. Contact us if you need to change or cancel it.",
    });
  }
  await prisma.booking.delete({ where: { id } });
  res.json({ ok: true });
}

export async function listMyBookings(req, res) {
  const bookings = await prisma.booking.findMany({
    where: { customerId: req.user.id },
    orderBy: { createdAt: "desc" },
    include: bookingInclude,
  });
  res.json({ bookings });
}

// ---- Admin side ----

export async function adminListBookings(req, res) {
  const { status } = req.query;
  const where = status && isValidBookingStatus(status) ? { status } : {};
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
