"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Banknote, BadgePercent, Wrench, RefreshCw, Wallet,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate, moneyCents } from "@/lib/api";
import {
  reconciliationCards,
  safeReconciliationRecords,
  RECONCILIATION_CATEGORY_LABELS,
} from "@/lib/cashAdmin";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/payments", label: "Payments", icon: Banknote },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/services", label: "Services", icon: Wrench },
  { href: "/admin/promotions", label: "Discounts", icon: BadgePercent },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
];

const CATEGORY_STYLES = {
  NEEDS_TAX_QUOTE: "bg-warnbg text-amber-700 border border-amber-200",
  UNPAID_CASH: "bg-dangerbg text-danger border border-red-200",
  MISSING_RECEIPT: "bg-amber-50 text-amber-700 border border-amber-200",
  RECEIPT_MISMATCH: "bg-dangerbg text-danger border border-red-200",
  READY_FOR_COLLECTION: "bg-brand-light text-brand-dark border border-brand-soft",
  PAID: "bg-okbg text-clean-dark border border-green-200",
  REFUNDED: "bg-slate-100 text-slate-600 border border-slate-200",
};

export default function AdminPaymentsPage() {
  const [report, setReport] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    api("/admin/payments/reconciliation")
      .then(setReport)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const cards = reconciliationCards(report?.summary);
  const records = report ? safeReconciliationRecords(report.records) : [];

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Cash Payments"
      subtitle="Reconcile cash receipts, quotes, collections and refunds.">
      {err && <div className="form-error">{err}</div>}

      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><Wallet size={18} /></span>
          <div>
            <h2 className="font-bold text-ink">Cash reconciliation</h2>
            {report?.generatedAt && (
              <p className="text-xs text-muted">Updated {new Date(report.generatedAt).toLocaleString()}</p>
            )}
          </div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="card empty-state"><p className="font-semibold text-ink">Loading…</p></div>
      ) : !report ? (
        <div className="card empty-state">
          <Wallet size={36} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">No reconciliation data available.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6">
            {cards.map((card) => (
              <div key={card.key} className="card card-pad">
                <div className="text-xs uppercase tracking-wide text-muted">{labelFor(card.key)}</div>
                <div className="mt-1 text-2xl font-extrabold text-ink">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Booking</th><th>Customer</th><th>Service</th><th>Status</th><th>Amounts</th><th>Receipt</th><th>Category</th><th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan="8">
                        <div className="empty-state">
                          <Wallet size={36} className="mx-auto text-slate-300" />
                          <p className="mt-3 font-semibold text-ink">No cash payments yet.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    records.map((r) => (
                      <tr key={r.bookingId}>
                        <td className="text-xs">
                          <div className="font-semibold text-brand">#{r.bookingId.slice(0, 8).toUpperCase()}</div>
                          <div className="text-muted">{r.bookingStatus}{r.bookingDate ? ` · ${fmtDate(r.bookingDate)}` : ""}</div>
                        </td>
                        <td className="text-sm font-semibold text-ink">{r.customerName || "—"}</td>
                        <td className="text-xs text-muted">{r.serviceName || "—"}</td>
                        <td className="text-xs">
                          <div className="font-semibold capitalize">{r.paymentStatus || "—"}</div>
                          {Number.isInteger(r.amountPaidCents) && <div className="text-muted">{moneyCents(r.amountPaidCents)} paid</div>}
                        </td>
                        <td className="text-xs">
                          {Number.isInteger(r.taxableSubtotalCents) && <div>Subtotal {moneyCents(r.taxableSubtotalCents)}</div>}
                          {Number.isInteger(r.taxCents) && <div className="text-muted">Tax {moneyCents(r.taxCents)}</div>}
                          {Number.isInteger(r.finalAmountCents) && (
                            <div className="font-semibold">Total {moneyCents(r.finalAmountCents)}</div>
                          )}
                          {!Number.isInteger(r.finalAmountCents) && <div className="text-muted">no authoritative total</div>}
                        </td>
                        <td className="text-xs">
                          {r.receipt ? (
                            <div>
                              <div className="font-semibold text-brand">#{r.receipt.id.slice(0, 8).toUpperCase()}</div>
                              {r.receipt.reconcile === "ok" && <div className="text-clean">matches booking</div>}
                              {r.receipt.reconcile === "mismatch" && <div className="text-danger">amount mismatch</div>}
                              {r.receipt.reconcile === "unverifiable" && <div className="text-muted">unverifiable</div>}
                              {r.receipt.reconcile === "none" && <div className="text-muted">no receipt</div>}
                            </div>
                          ) : (
                            <span className="text-muted">missing</span>
                          )}
                        </td>
                        <td>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${CATEGORY_STYLES[r.category] || "bg-slate-100 text-slate-600"}`}>
                            {RECONCILIATION_CATEGORY_LABELS[r.category] || r.category}
                          </span>
                        </td>
                        <td className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {(r.flags || []).map((f) => (
                              <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{f}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

const CARD_LABELS = {
  totalCashRecords: "Total cash records",
  unpaidCash: "Unpaid",
  needsTaxQuote: "Need tax quote",
  readyForCollection: "Ready to collect",
  paid: "Paid",
  refunded: "Refunded",
  missingReceipts: "Missing receipts",
  receiptMismatches: "Receipt mismatches",
  receiptsUnverifiable: "Unverifiable receipts",
};

function labelFor(key) {
  return CARD_LABELS[key] || key;
}