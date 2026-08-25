"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  Download, Eye, ReceiptIndianRupee,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate, money, moneyCents } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/receipts").then((d) => setReceipts(d.receipts)).finally(() => setLoading(false));
  }, []);

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Receipts"
      subtitle="Itemized receipts for every payment. Download as PDF or print.">
      {loading ? (
        <div className="empty-state">Loading receipts…</div>
      ) : receipts.length === 0 ? (
        <div className="card empty-state">
          <ReceiptIndianRupee size={36} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">No receipts yet.</p>
          <p className="text-sm">Once the admin issues a receipt for your work, it will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {receipts.map((r) => (
            <div key={r.id} className="card p-5 flex flex-col transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
              <div className="flex items-center justify-between">
                <span className="rounded-lg bg-brand-light px-2.5 py-1 text-xs font-bold text-brand">
                  #{r.id.slice(0, 8).toUpperCase()}
                </span>
                <span className="text-xs text-muted">{fmtDate(r.createdAt)}</span>
              </div>
              <p className="mt-3 font-semibold text-ink">{r.booking?.service?.name || "Custom charge"}</p>
               <p className="mt-3 text-2xl font-extrabold text-brand">{Number.isInteger(r.finalAmountCents) ? moneyCents(r.finalAmountCents) : money(r.total)}</p>
              <div className="mt-4 pt-4 border-t border-line flex gap-2">
                <Link href={`/dashboard/receipts/${r.id}`} className="btn btn-outline btn-sm flex-1">
                  <Eye size={14} /> View
                </Link>
                <a className="btn btn-primary btn-sm flex-1" href={`/api/receipts/${r.id}/pdf`} target="_blank" rel="noreferrer">
                  <Download size={14} /> PDF
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
