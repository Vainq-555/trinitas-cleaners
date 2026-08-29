"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Check, X, Hammer, Inbox, CheckCircle2, ThumbsDown, BadgePercent, Wrench,
} from "lucide-react";
import Shell from "@/components/Shell";
import StatusBadge from "@/components/StatusBadge";
import { api, fmtDate, money } from "@/lib/api";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/services", label: "Services", icon: Wrench },
  { href: "/admin/promotions", label: "Discounts", icon: BadgePercent },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
];

const SESSIONS = [
  { id: "pending", label: "Pending requests", icon: Inbox },
  { id: "worked", label: "Accepted & Worked", icon: CheckCircle2 },
  { id: "declined", label: "Declined", icon: ThumbsDown },
];

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [session, setSession] = useState("pending");
  const [busyId, setBusyId] = useState(null);

  const load = () => api("/admin/bookings").then((d) => setBookings(d.bookings)).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const setStatus = async (id, status) => {
    setBusyId(id);
    try {
      await api(`/admin/bookings/${id}/status`, { method: "PATCH", body: { status } });
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const shown = bookings.filter((b) => {
    if (session === "pending") return b.status === "pending";
    if (session === "worked") return b.status === "accepted" || b.status === "worked";
    if (session === "declined") return b.status === "declined";
    return true;
  });

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Booking Management"
      subtitle="Accept or decline requests. Completed jobs live in 'Accepted & Worked'.">
      <div className="flex flex-wrap gap-2 mb-6">
        {SESSIONS.map((s) => {
          const count = s.id === "pending"
            ? bookings.filter((b) => b.status === "pending").length
            : s.id === "worked"
              ? bookings.filter((b) => b.status === "accepted" || b.status === "worked").length
              : bookings.filter((b) => b.status === "declined").length;
          return (
            <button key={s.id} className={`tab-btn ${session === s.id ? "tab-btn-active" : ""}`} onClick={() => setSession(s.id)}>
              <s.icon size={14} className="inline -mt-0.5 mr-1.5" />
              {s.label} <span className="ml-1 opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="card empty-state">
          <Inbox size={36} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">No bookings in this session.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                   <th>Customer</th><th>Service</th><th>Date</th><th>Total</th><th>Payment</th><th>Note</th><th>Status</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="font-semibold text-ink">{b.customer.name}</div>
                      <div className="text-xs text-muted">{b.customer.email}</div>
                    </td>
                    <td>{b.service.name}</td>
                    <td className="text-muted">{fmtDate(b.date)}</td>
                    <td className="font-semibold">{money(b.price)}</td>
                    <td className="text-xs">
                      <div className="font-semibold capitalize">{b.payment?.method || "—"}</div>
                      <div className={b.payment?.status === "paid" ? "text-clean" : "text-muted"}>{b.payment?.status || "—"}</div>
                      {b.payment?.amountPaid > 0 && <div>{money(b.payment.amountPaid)} paid</div>}
                      {b.payment?.paidAt && <div className="text-muted">{new Date(b.payment.paidAt).toLocaleString()}</div>}
                      {b.payment?.stripeCheckoutSessionId && <div className="max-w-[130px] truncate text-muted" title={b.payment.stripeCheckoutSessionId}>{b.payment.stripeCheckoutSessionId}</div>}
                      {b.payment?.stripePaymentIntentId && <div className="max-w-[130px] truncate text-muted" title={b.payment.stripePaymentIntentId}>{b.payment.stripePaymentIntentId}</div>}
                    </td>
                    <td className="text-xs text-muted max-w-[180px] truncate">{b.note || "—"}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        {b.status === "pending" && (
                          <>
                            <button className="btn btn-primary btn-sm" disabled={busyId === b.id} onClick={() => setStatus(b.id, "accepted")}>
                              <Check size={14} /> Accept
                            </button>
                            <button className="btn btn-danger btn-sm" disabled={busyId === b.id} onClick={() => setStatus(b.id, "declined")}>
                              <X size={14} /> Decline
                            </button>
                          </>
                        )}
                        {b.status === "accepted" && (
                          <button className="btn btn-secondary btn-sm" disabled={busyId === b.id} onClick={() => setStatus(b.id, "worked")}>
                            <Hammer size={14} /> Mark worked
                          </button>
                        )}
                        {b.status === "worked" && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-clean">
                            <CheckCircle2 size={14} /> Complete
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
