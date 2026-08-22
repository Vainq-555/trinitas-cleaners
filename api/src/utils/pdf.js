import PDFDocument from "pdfkit";

/**
 * Generates a professional, itemized receipt PDF for a given receipt record.
 * Returns a Buffer. Works identically for admin and customer downloads.
 */
export function buildReceiptPdf(receipt, customer, service, booking) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "LETTER" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const accent = "#0f766e"; // deep teal — brand color
    const ink = "#1f2937";
    const gray = "#6b7280";

    // ---- Header / business block ----
    doc.fontSize(20).fillColor(accent).text("Trinitas-Cleaners", { continued: true });
    doc
      .fontSize(11)
      .fillColor(ink)
      .text("  |  Receipt", { align: "left" });
    doc.moveDown(0.4);
    doc.fontSize(9.5).fillColor(gray).text("Trinitas-Cleaners");
    doc.text("Anoka, MN 55303");
    doc.text("trinitascleaner@gmail.com  |  1 763-620-4955");

    // ---- Receipt meta ----
    const metaTop = doc.y;
    doc.fontSize(10).fillColor(ink);
    doc.text("RECEIPT", doc.page.width - 48 - 150, 48, { width: 150, align: "right" });
    doc.fontSize(9).fillColor(gray);
    doc.text(`Receipt # ${receipt.id.slice(0, 8).toUpperCase()}`, doc.page.width - 48 - 150, 64, {
      width: 150,
      align: "right",
    });
    doc.text(
      `Date: ${receipt.createdAt.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
      doc.page.width - 48 - 150,
      79,
      { width: 150, align: "right" }
    );

    // ---- Customer block ----
    doc.moveDown(1.4);
    doc.y = Math.max(doc.y, metaTop + 90);
    doc.fontSize(10).fillColor(accent).text("BILLED TO");
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(ink).text(customer.name);
    doc.fontSize(9).fillColor(gray);
    if (customer.address) doc.text(customer.address);
    doc.text(customer.email);
    if (customer.phone) doc.text(customer.phone);

    // ---- Itemized line ----
    doc.moveDown(1.2);
    doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).strokeColor("#e5e7eb").stroke();
    doc.moveDown(0.6);

    doc.fontSize(10).fillColor(accent).text("ITEMIZED CHARGES");
    doc.moveDown(0.4);

    const label = service ? service.name : "Custom charge";
    doc.fontSize(10).fillColor(ink).text(label);
    if (booking) {
      doc.fontSize(9).fillColor(gray).text(
        `Booking # ${booking.id.slice(0, 8).toUpperCase()} on ${booking.date.toLocaleDateString(
          "en-US",
          { weekday: "short", year: "numeric", month: "short", day: "numeric" }
        )}`
      );
    }

    // Price columns
    doc.fillColor(ink).fontSize(10);
    doc.text("Subtotal", doc.page.width - 48 - 80, doc.y - 20, { width: 80, align: "right" });
    doc.text(formatMoney(receipt.subtotal), doc.page.width - 48 - 80, doc.y + 2, {
      width: 80,
      align: "right",
    });

    doc.moveDown(0.8);
    doc.fillColor(ink).fontSize(10).text(`Tax (${(receipt.taxRate * 100).toFixed(2)}%)`);
    doc.text(formatMoney(receipt.tax), doc.page.width - 48 - 80, doc.y - 14, {
      width: 80,
      align: "right",
    });

    if (receipt.discount > 0) {
      doc.moveDown(0.6);
      doc.fillColor(ink).text("Discount");
      doc.text(`- ${formatMoney(receipt.discount)}`, doc.page.width - 48 - 80, doc.y - 14, {
        width: 80,
        align: "right",
      });
    }

    if (receipt.note) {
      doc.moveDown(0.8);
      doc.fillColor(gray).fontSize(9).text(`Note: ${receipt.note}`);
    }

    // ---- Total ----
    doc.moveDown(1);
    doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).strokeColor("#d1d5db").stroke();
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor(accent).text("TOTAL", { continued: true });
    doc.text(formatMoney(receipt.total), { align: "right", width: doc.page.width - 96 });
    doc.moveDown(0.5);
    doc
      .moveTo(48, doc.y)
      .lineTo(doc.page.width - 48, doc.y)
      .strokeColor("#d1d5db")
      .stroke();

    // ---- Footer ----
    doc.moveDown(2);
    doc.fontSize(9).fillColor(gray).text("Thank you for choosing Trinitas-Cleaners!", {
      align: "center",
    });
    doc.fontSize(8.5).fillColor(gray).text("Questions? Contact trinitascleaner@gmail.com", {
      align: "center",
    });

    doc.end();
  });
}

export function formatMoney(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}