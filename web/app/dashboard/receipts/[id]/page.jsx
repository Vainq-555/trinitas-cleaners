"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  Printer, Download, ArrowLeft, Sparkles as SparkleIcon,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate, fmtDateTime, money } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function ReceiptDetailPage({ params }) {
  const [receipt, setReceipt] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api("/receipts").then((d) => {
      const r = d.receipts.find((x) => x.id === params.id);
      if (r) setReceipt(r);
      else setNotFound(true);
    }).catch(() => setNotFound(true));
  }, [params.id]);

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Receipt"
      subtitle="Print or download a PDF copy for your records.">
      <div className="print-toolbar no-print mb-6 flex flex-wrap justify-center gap-2">
        <button className="btn btn-outline" onClick={() => window.print()}>
          <Printer size={16} /> Print
        </button>
        <a className="btn btn-primary" href={`/api/receipts/${params.id}/pdf`} target="_blank" rel="noreferrer">
          <Download size={16} /> Download PDF
        </a>
      </div>

      {notFound ? (
        <div className="empty-state">
          <p className="font-semibold text-ink">Receipt not found.</p>
          <Link href="/dashboard/receipts" className="btn btn-outline mt-4">
            <ArrowLeft size={15} /> Back to receipts
          </Link>
        </div>
      ) : !receipt ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <div className="receipt-sheet">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand text-white">
                <SparkleIcon size={20} />
              </span>
              <div>
                <div className="text-lg font-extrabold text-ink">Trinitas-Cleaners</div>
                <div className="text-xs text-muted">Anoka, MN 55303</div>
                <div className="text-xs text-muted">trinitascleaner@gmail.com · 1 763-620-4955</div>
              </div>
            </div>
            <div className="text-right">
              <div className="inline-block rounded-lg bg-brand px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">Receipt</div>
              <div className="mt-1.5 text-sm font-semibold text-ink">#{receipt.id.slice(0, 8).toUpperCase()}</div>
              <div className="text-xs text-muted">{fmtDateTime(receipt.createdAt)}</div>
            </div>
          </div>

          <hr className="my-6 border-line" />

          {/* Billed to */}
          <div className="text-xs font-bold uppercase tracking-wide text-brand">Billed to</div>
          <div className="mt-2 text-sm">
            <div className="font-semibold text-ink">{receipt.customer.name}</div>
            {receipt.customer.address && <div className="text-muted">{receipt.customer.address}</div>}
            <div className="text-muted">{receipt.customer.email}</div>
            {receipt.customer.phone && <div className="text-muted">{receipt.customer.phone}</div>}
          </div>

          <hr className="my-6 border-line" />

          {/* Itemization */}
          <div className="text-xs font-bold uppercase tracking-wide text-brand">Itemized charges</div>
          <div className="mt-3">
            <div className="flex items-center justify-between py-2">
              <span className="font-semibold text-ink">{receipt.booking?.service?.name || "Custom charge"}</span>
              <span className="font-semibold">{money(receipt.subtotal)}</span>
            </div>
            {receipt.booking && (
              <div className="text-xs text-muted">
                Booking #{receipt.booking.id.slice(0, 8).toUpperCase()} · {fmtDate(receipt.booking.date)}
              </div>
            )}
            <div className="flex items-center justify-between py-2 border-t border-dashed border-line">
              <span className="text-sm text-ink">Tax ({(receipt.taxRate * 100).toFixed(2)}%)</span>
              <span className="text-sm">{money(receipt.tax)}</span>
            </div>
            {receipt.discount > 0 && (
              <div className="flex items-center justify-between py-2 border-t border-dashed border-line">
                <span className="text-sm text-clean">Discount</span>
                <span className="text-sm text-clean">− {money(receipt.discount)}</span>
              </div>
            )}
          </div>

          {/* Total */}
          <div className="mt-5 flex items-center justify-between border-t-2 border-ink pt-4">
            <span className="text-lg font-extrabold text-ink">TOTAL</span>
            <span className="text-2xl font-extrabold text-brand">{money(receipt.total)}</span>
          </div>

          {receipt.note && (
            <div className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm text-muted">
              <span className="font-semibold">Note:</span> {receipt.note}
            </div>
          )}

          <div className="mt-8 text-center text-xs text-muted">
            Thank you for choosing Trinitas-Cleaners!<br />
            Questions? trinitascleaner@gmail.com
          </div>
        </div>
      )}
    </Shell>
  );
}