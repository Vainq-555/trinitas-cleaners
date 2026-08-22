import prisma from "../utils/prisma.js";
import { TAX_RATE } from "../config.js";
import { badRequest } from "../utils/validators.js";
import { buildReceiptPdf, formatMoney } from "../utils/pdf.js";

const receiptInclude = {
  customer: true,
  booking: { include: { service: true } },
};

// ---- Admin: receipt generation ----

export async function adminCreateReceipt(req, res) {
  const { customerId, bookingId, subtotal, discount = 0, taxRate = TAX_RATE, note } =
    req.body || {};

  if (!customerId || typeof subtotal !== "number" || subtotal < 0) {
    return badRequest(res, "customerId and a non-negative subtotal are required");
  }

  const customer = await prisma.user.findUnique({ where: { id: customerId } });
  if (!customer) return badRequest(res, "Customer not found");

  const tax = +(subtotal * taxRate).toFixed(2);
  const total = +(subtotal + tax - discount).toFixed(2);

  const receipt = await prisma.receipt.create({
    data: {
      customerId,
      bookingId: bookingId || null,
      subtotal,
      taxRate,
      tax,
      discount,
      total,
      note: note || null,
    },
    include: receiptInclude,
  });

  // Notify the customer a receipt is ready.
  await prisma.broadcast.create({
    data: {
      type: "notification",
      target: "specific_user",
      userId: customerId,
      title: "Receipt available",
      content: `A receipt for ${formatMoney(total)} is ready to view in your dashboard.`,
    },
  });

  res.status(201).json({ receipt });
}

export async function adminListReceipts(req, res) {
  const { customerId } = req.query;
  const where = customerId ? { customerId } : {};
  const receipts = await prisma.receipt.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: receiptInclude,
  });
  res.json({ receipts });
}

// ---- Customer side ----

export async function listMyReceipts(req, res) {
  const receipts = await prisma.receipt.findMany({
    where: { customerId: req.user.id },
    orderBy: { createdAt: "desc" },
    include: receiptInclude,
  });
  res.json({ receipts });
}

/**
 * Serve the receipt as a downloadable/printable PDF.
 * Shared by customers (own receipts only) and admins (any receipt).
 */
export async function downloadReceiptPdf(req, res) {
  const { id } = req.params;

  const receipt = await prisma.receipt.findUnique({ where: { id }, include: receiptInclude });
  if (!receipt) return res.status(404).json({ error: "Receipt not found" });

  if (req.user.role === "customer" && receipt.customerId !== req.user.id) {
    return res.status(403).json({ error: "You can only download your own receipts" });
  }

  const service = receipt.booking?.service || null;
  const pdfBuffer = await buildReceiptPdf(receipt, receipt.customer, service, receipt.booking);

  const filename = `trinitas-receipt-${receipt.id.slice(0, 8).toUpperCase()}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.send(pdfBuffer);
}