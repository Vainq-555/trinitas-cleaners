import Stripe from "stripe";
import prisma from "../utils/prisma.js";
import { badRequest } from "../utils/validators.js";
import { STRIPE_SECRET_KEY } from "../config.js";
import { centsToLegacyDollars } from "../utils/money.js";
import { TaxAddressRequiredError, TaxUnavailableError } from "../utils/tax.js";
import {
  assertPaidAmountMatches,
  bookingAddress,
  calculateBookingQuote,
  createSnapshotReceipt,
  saveQuote,
} from "./payments.js";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

class CashPaymentConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "CashPaymentConflictError";
    this.code = "CASH_PAYMENT_CONFLICT";
  }
}

function resolveAddress(body, booking) {
  const submitted = body?.serviceAddress;
  if (submitted && typeof submitted === "object") return submitted;
  return bookingAddress(booking);
}

function paidFields(payment, quote, paidAt) {
  const finalized = centsToLegacyDollars(quote.finalAmountCents);
  return {
    status: "paid",
    finalAmountCents: quote.finalAmountCents,
    amount: finalized,
    amountPaidCents: quote.finalAmountCents,
    amountPaid: finalized,
    paidAt,
  };
}

export async function collectCashPayment(req, res, deps = {}) {
  const {
    findBooking = (id) =>
      prisma.booking.findUnique({
        where: { id },
        include: {
          payment: true,
          customer: { select: { name: true, email: true } },
          service: { select: { name: true } },
        },
      }),
    quoteForBooking = (booking, address) => calculateBookingQuote(booking, address, stripe),
    saveQuote: persistQuote = saveQuote,
    createSnapshotReceipt: snapshotReceipt = createSnapshotReceipt,
    enforceAmount = assertPaidAmountMatches,
    runTransaction = (fn) => prisma.$transaction(fn),
    paidAt = () => new Date(),
    paymentStatus = async (id) => (await prisma.payment.findUnique({ where: { id }, select: { status: true } }))?.status,
  } = deps;

  const { finalAmountCents } = req.body || {};

  const booking = await findBooking(req.params.bookingId);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  const payment = booking.payment;
  if (!payment) return badRequest(res, "This booking has no payment record");
  if (payment.method !== "cash") return badRequest(res, "This booking is not a cash payment");
  if (payment.status === "refunded") return res.status(409).json({ error: "This cash payment has been refunded and cannot be collected" });
  if (payment.status === "paid") return res.status(409).json({ error: "This cash payment has already been collected" });

  const address = resolveAddress(req.body, booking);

  let quote;
  try {
    quote = await quoteForBooking(booking, address);
  } catch (error) {
    if (error instanceof TaxAddressRequiredError || error.code === "TAX_ADDRESS_REQUIRED") {
      return res.status(422).json({ error: error.message, code: "TAX_ADDRESS_REQUIRED", requiresAddress: true });
    }
    if (error instanceof TaxUnavailableError || error.code === "TAX_UNAVAILABLE") {
      return res.status(503).json({ error: error.message, retryable: error.retryable !== false });
    }
    if (error.message?.includes("Money value")) {
      return res.status(409).json({ error: "This legacy booking cannot be safely repriced" });
    }
    console.error("Cash quote failed", error);
    return res.status(500).json({ error: "Unable to prepare cash collection" });
  }

  if (!Number.isInteger(finalAmountCents)) return badRequest(res, "finalAmountCents must be an integer number of cents");

  try {
    enforceAmount(quote.finalAmountCents, finalAmountCents);
  } catch (error) {
    if (error.code === "PAYMENT_AMOUNT_MISMATCH") {
      return res.status(409).json({
        error: error.message,
        code: "PAYMENT_AMOUNT_MISMATCH",
        expectedFinalAmountCents: quote.finalAmountCents,
      });
    }
    throw error;
  }

  try {
    const result = await runTransaction(async (tx) => {
      const data = paidFields(payment, quote, paidAt());
      const updated = await tx.payment.updateMany({ where: { id: payment.id, status: "unpaid" }, data });
      if (updated.count !== 1) throw new CashPaymentConflictError("payment is no longer unpaid (concurrent collect or state change)");
      const updatedBooking = await persistQuote(booking, quote, tx);
      const updatedPayment = { ...payment, ...data };
      const receipt = await snapshotReceipt(tx, updatedBooking, updatedPayment);
      return { booking: updatedBooking, payment: updatedPayment, receipt };
    });
    return res.json({
      ok: true,
      bookingId: booking.id,
      payment: {
        id: result.payment.id,
        method: result.payment.method,
        status: result.payment.status,
        amount: result.payment.amount,
        amountPaid: result.payment.amountPaid,
        amountPaidCents: result.payment.amountPaidCents,
        finalAmountCents: result.payment.finalAmountCents,
        paidAt: result.payment.paidAt,
      },
      receipt: result.receipt ? { id: result.receipt.id } : null,
    });
  } catch (error) {
    if (error instanceof CashPaymentConflictError) {
      const status = await paymentStatus(payment.id);
      if (status === "paid") return res.status(409).json({ error: "This cash payment has already been collected" });
      if (status === "refunded") return res.status(409).json({ error: "This cash payment has been refunded and cannot be collected" });
      return res.status(409).json({ error: "This cash payment cannot be collected in its current state" });
    }
    throw error;
  }
}

export async function adminCashCollect(req, res) {
  return collectCashPayment(req, res);
}

function refundedFields(payment, refundedAt) {
  return {
    status: "refunded",
    amountPaidCents: 0,
    amountPaid: 0,
    refundedAt,
  };
}

export async function refundCashPayment(req, res, deps = {}) {
  const {
    findBooking = (id) =>
      prisma.booking.findUnique({
        where: { id },
        include: {
          payment: true,
          customer: { select: { name: true, email: true } },
          service: { select: { name: true } },
        },
      }),
    runTransaction = (fn) => prisma.$transaction(fn),
    refundedAt = () => new Date(),
    paymentStatus = async (id) => (await prisma.payment.findUnique({ where: { id }, select: { status: true } }))?.status,
  } = deps;

  const booking = await findBooking(req.params.bookingId);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  const payment = booking.payment;
  if (!payment) return badRequest(res, "This booking has no payment record");
  if (payment.method !== "cash") return badRequest(res, "This booking is not a cash payment");
  if (payment.status !== "paid") return res.status(409).json({ error: "Only a paid cash payment can be refunded" });

  // Booking quote fields must remain untouched: only the Payment record is updated.
  const quoteBefore = {
    basePriceCents: booking.basePriceCents,
    discountCents: booking.discountCents,
    taxableSubtotalCents: booking.taxableSubtotalCents,
    taxCents: booking.taxCents,
    taxRateBasisPoints: booking.taxRateBasisPoints,
    taxCalculationId: booking.taxCalculationId,
    finalAmountCents: booking.finalAmountCents,
  };

  try {
    const result = await runTransaction(async (tx) => {
      const data = refundedFields(payment, refundedAt());
      const updated = await tx.payment.updateMany({ where: { id: payment.id, status: "paid" }, data });
      if (updated.count !== 1) throw new CashPaymentConflictError("payment is no longer paid (concurrent collect or state change)");
      return { payment: { ...payment, ...data } };
    });
    return res.json({
      ok: true,
      bookingId: booking.id,
      payment: {
        id: result.payment.id,
        method: result.payment.method,
        status: result.payment.status,
        amountPaid: result.payment.amountPaid,
        amountPaidCents: result.payment.amountPaidCents,
        refundedAt: result.payment.refundedAt,
        finalAmountCents: result.payment.finalAmountCents,
      },
      quotePreserved: quoteBefore,
    });
  } catch (error) {
    if (error instanceof CashPaymentConflictError) {
      const status = await paymentStatus(payment.id);
      if (status === "refunded") return res.status(409).json({ error: "This cash payment has already been refunded" });
      if (status === "paid") return res.status(409).json({ error: "This cash payment is already paid" });
      return res.status(409).json({ error: "This cash payment cannot be refunded in its current state" });
    }
    throw error;
  }
}

export async function adminCashRefund(req, res) {
  return refundCashPayment(req, res);
}