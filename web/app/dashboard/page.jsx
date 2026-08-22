"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  CalendarDays, Wallet, Clock3, Megaphone, ArrowRight,
} from "lucide-react";
import Shell from "@/components/Shell";
import StatusBadge from "@/components/StatusBadge";
import { api, fmtDate, money } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardHome() {
  const [bookings, setBookings] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [broadcasts, setBroadcasts] = useState([]);

  useEffect(() => {
    api("/bookings").then((d) => setBookings(d.bookings)).catch(() => {});
    api("/receipts").then((d) => setReceipts(d.receipts)).catch(() => {});
    api("/broadcasts/mine").then((d) => setBroadcasts(d.broadcasts)).catch(() => {});
  }, []);

  const pending = bookings.filter((b) => b.status === "pending").length;
  const totalSpent = receipts.reduce((s, r) => s + r.total, 0);

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Overview" subtitle="Welcome back — here's what's happening.">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5 flex items-start justify-between">
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-ink">{bookings.length}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">Total bookings</div>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-light text-brand"><CalendarDays size={20} /></span>
        </div>
        <div className="card p-5 flex items-start justify-between">
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-500">{pending}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">Pending confirmation</div>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-warnbg text-amber-600"><Clock3 size={20} /></span>
        </div>
        <div className="card p-5 flex items-start justify-between">
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-clean">{money(totalSpent)}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">Paid to date</div>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-clean-light text-clean"><Wallet size={20} /></span>
        </div>
      </div>

      {broadcasts.length > 0 && (
        <div className="card card-pad mt-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-light text-brand"><Megaphone size={16} /></span>
            <h2 className="font-bold text-ink">Updates for you</h2>
          </div>
          <div className="mt-4 divide-y divide-line">
            {broadcasts.slice(0, 4).map((b) => (
              <div key={b.id} className="py-3.5">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    b.type === "announcement" ? "bg-brand-light text-brand" : "bg-warnbg text-amber-700"
                  }`}>
                    {b.type === "announcement" ? "Announcement" : "Notification"}
                  </span>
                  <span className="text-xs text-muted">{fmtDate(b.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  {b.title && <span className="font-semibold">{b.title}. </span>}
                  {b.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card card-pad mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Recent bookings</h2>
          <Link href="/dashboard/bookings" className="btn btn-ghost btn-sm">View all <ArrowRight size={14} /></Link>
        </div>
        {bookings.length === 0 ? (
          <div className="empty-state">
            <p className="font-semibold text-ink">You haven't booked anything yet.</p>
            <p className="text-sm">Schedule your first service in under a minute.</p>
            <Link href="/dashboard/services" className="btn btn-primary mt-4">
              <Sparkles size={16} /> Book your first service
            </Link>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Service</th><th>Date</th><th>Status</th><th>Price</th></tr>
              </thead>
              <tbody>
                {bookings.slice(0, 5).map((b) => (
                  <tr key={b.id}>
                    <td className="font-semibold">{b.service.name}</td>
                    <td className="text-muted">{fmtDate(b.date)}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="font-semibold">{money(b.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}