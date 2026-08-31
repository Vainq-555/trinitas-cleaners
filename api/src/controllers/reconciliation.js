import prisma from "../utils/prisma.js";
import { centsToLegacyDollars } from "../utils/money.js";

export const RECONCILIATION_CATEGORIES = [
  "NEEDS_TAX_QUOTE",
  "UNPAID_CASH",
  "MISSING_RECEIPT",
  "RECEIPT_MISMATCH",
  "READY_FOR_COLLECTION",
  "PAID",
  "REFUNDED",
];

const EPSILON = 1e-6;

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function reconcileBookingReceipt(booking, receipt) {
  if (!receipt) return { status: "none", details: { method: "no-receipt" } };

  const compared = [];
  const centsCheck = (field, a, b) => {
    if (Number.isInteger(a) && Number.isInteger(b)) compared.push({ field, booking: a, receipt: b });
  };
  centsCheck("taxableSubtotalCents", booking.taxableSubtotalCents, receipt.taxableSubtotalCents);
  centsCheck("taxCents", booking.taxCents, receipt.taxCents);
  centsCheck("finalAmountCents", booking.finalAmountCents, receipt.finalAmountCents);
  if (compared.length > 0) {
    const mismatched = compared.filter((c) => c.booking !== c.receipt);
    return {
      status: mismatched.length ? "mismatch" : "ok",
      details: { method: "cents", compared, mismatched: mismatched.map((c) => c.field) },
    };
  }

  const floatCompared = [];
  const floatCheck = (field, bookingValue, receiptValue) => {
    if (bookingValue !== null && bookingValue !== undefined && isNumber(receiptValue)) {
      floatCompared.push({ field, booking: bookingValue, receipt: receiptValue });
    }
  };
  floatCheck(
    "subtotal",
    Number.isInteger(booking.taxableSubtotalCents) ? centsToLegacyDollars(booking.taxableSubtotalCents) : null,
    receipt.subtotal,
  );
  floatCheck("tax", Number.isInteger(booking.taxCents) ? centsToLegacyDollars(booking.taxCents) : null, receipt.tax);
  floatCheck(
    "total",
    Number.isInteger(booking.finalAmountCents) ? centsToLegacyDollars(booking.finalAmountCents) : null,
    receipt.total,
  );
  if (floatCompared.length > 0) {
    const mismatched = floatCompared.filter((c) => Math.abs(c.booking - c.receipt) > EPSILON);
    return {
      status: mismatched.length ? "mismatch" : "ok",
      details: { method: "legacy-floats", compared: floatCompared, mismatched: mismatched.map((c) => c.field) },
    };
  }

  return { status: "unverifiable", details: { method: "no-authoritative-data" } };
}

export function categorizeCashRecord(booking) {
  const payment = booking.payment || {};
  const receipts = Array.isArray(booking.receipts) ? booking.receipts : [];
  const receipt = receipts[0] || null;
  const paymentStatus = payment.status || null;
  const refunded = paymentStatus === "refunded";
  const paid = paymentStatus === "paid";
  const notPaid = !refunded && !paid;

  const hasTaxQuote =
    Number.isInteger(booking.taxableSubtotalCents) &&
    Number.isInteger(booking.taxCents) &&
    Number.isInteger(booking.finalAmountCents);
  const needsTaxQuote = !hasTaxQuote;
  const reconcile = reconcileBookingReceipt(booking, receipt);

  const flags = [];
  if (notPaid) flags.push("UNPAID_CASH");
  if (needsTaxQuote) flags.push("NEEDS_TAX_QUOTE");
  if (!receipt) flags.push("MISSING_RECEIPT");
  if (reconcile.status === "mismatch") flags.push("RECEIPT_MISMATCH");
  if (notPaid && hasTaxQuote) flags.push("READY_FOR_COLLECTION");
  if (paid) flags.push("PAID");
  if (refunded) flags.push("REFUNDED");

  let category;
  if (refunded) category = "REFUNDED";
  else if (reconcile.status === "mismatch") category = "RECEIPT_MISMATCH";
  else if (paid && !receipt) category = "MISSING_RECEIPT";
  else if (paid) category = "PAID";
  else if (notPaid && hasTaxQuote) category = "READY_FOR_COLLECTION";
  else if (notPaid) category = "NEEDS_TAX_QUOTE";
  else category = "UNPAID_CASH";

  return { category, flags, hasTaxQuote, needsTaxQuote, reconcile, notPaid };
}

function toReconciliationRecord(booking, analysis) {
  const payment = booking.payment || {};
  const receipt = (Array.isArray(booking.receipts) ? booking.receipts : [])[0] || null;
  return {
    bookingId: booking.id,
    bookingStatus: booking.status ?? null,
    bookingDate: booking.date ?? null,
    customerId: booking.customer?.id ?? null,
    customerName: booking.customer?.name ?? null,
    customerEmail: booking.customer?.email ?? null,
    serviceId: booking.service?.id ?? null,
    serviceName: booking.service?.name ?? null,
    paymentId: payment.id ?? null,
    paymentMethod: payment.method ?? null,
    paymentStatus: payment.status ?? null,
    amountPaidCents: payment.amountPaidCents ?? null,
    taxableSubtotalCents: booking.taxableSubtotalCents ?? null,
    taxCents: booking.taxCents ?? null,
    finalAmountCents: booking.finalAmountCents ?? null,
    hasTaxQuote: analysis.hasTaxQuote,
    receiptCount: (Array.isArray(booking.receipts) ? booking.receipts : []).length,
    receipt: receipt
      ? {
          id: receipt.id,
          subtotal: receipt.subtotal ?? null,
          taxRate: receipt.taxRate ?? null,
          tax: receipt.tax ?? null,
          discount: receipt.discount ?? null,
          total: receipt.total ?? null,
          taxRateBasisPoints: receipt.taxRateBasisPoints ?? null,
          taxCents: receipt.taxCents ?? null,
          finalAmountCents: receipt.finalAmountCents ?? null,
          createdAt: receipt.createdAt ?? null,
          reconcile: analysis.reconcile,
        }
      : null,
    category: analysis.category,
    flags: analysis.flags,
  };
}

export function buildReconciliation(bookings) {
  const records = [];
  for (const booking of bookings) {
    const payment = booking.payment || {};
    if (payment.method !== "cash") continue;
    records.push(toReconciliationRecord(booking, categorizeCashRecord(booking)));
  }

  const byCategory = Object.fromEntries(RECONCILIATION_CATEGORIES.map((c) => [c, 0]));
  for (const record of records) byCategory[record.category] += 1;

  const flagCount = (name) => records.filter((r) => r.flags.includes(name)).length;
  const summary = {
    totalCashRecords: records.length,
    unpaidCash: flagCount("UNPAID_CASH"),
    needsTaxQuote: flagCount("NEEDS_TAX_QUOTE"),
    readyForCollection: flagCount("READY_FOR_COLLECTION"),
    paid: flagCount("PAID"),
    refunded: flagCount("REFUNDED"),
    missingReceipts: flagCount("MISSING_RECEIPT"),
    receiptMismatches: flagCount("RECEIPT_MISMATCH"),
    receiptsUnverifiable: records.filter((r) => r.receipt && r.receipt.reconcile.status === "unverifiable").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    scope: { payments: ["cash"] },
    summary,
    byCategory,
    records,
  };
}

export async function adminPaymentReconciliation(req, res) {
  const bookings = await prisma.booking.findMany({
    where: { payment: { is: { method: "cash" } } },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      service: { select: { id: true, name: true } },
      payment: true,
      receipts: { orderBy: { createdAt: "desc" } },
    },
  });
  return res.json(buildReconciliation(bookings));
}