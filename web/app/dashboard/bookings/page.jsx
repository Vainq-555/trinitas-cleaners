"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings,
  Trash2, CalendarPlus,
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

const filters = ["all", "pending", "accepted", "worked", "declined"];

export default function BookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [paying, setPaying] = useState(null);

  const load = () =>
    api("/bookings").then((d) => setBookings(d.bookings)).finally(() => setLoading(false));

  useEffect(() => {
    load();
    // Stripe Checkout redirect feedback. URL parameters are display-only;
    // the server's webhook remains the sole authority on payment status.
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("payment");
    if (outcome) {
      const bookingId = params.get("booking_id");
      if (outcome === "success") {
        setBanner({
          kind: "ok",
          text: bookingId
            ? `Payment received for booking #${bookingId.slice(0, 6).toUpperCase()}. If the status still shows pending, it will update in a few seconds.`
            : "Payment received. Thank you!",
        });
        // Give the webhook a moment to land, then refresh the list once.
        setTimeout(() => api("/bookings").then((d) => setBookings(d.bookings)).catch(() => {}), 2500);
      } else {
        setBanner({
          kind: "error",
          text: "Checkout was not completed. Your booking is saved — you can pay anytime with “Pay now”.",
        });
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const pay = async (id) => {
    setPaying(id);
    try {
      const { url } = await api(`/bookings/${id}/checkout`, { method: "POST" });
      window.location.assign(url);
    } catch (e) {
      alert(e.message);
      setPaying(null);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this booking? This cannot be undone.")) return;
    try {
      await api(`/bookings/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const shown = filter === "all" ? bookings : bookings.filter((b) => b.status === filter);

  return (
    <Shell links={links} sections={["Customer Portal"]} title="My Bookings"
      subtitle="View history, track status, or cancel a pending booking.">
      {banner && <div className={banner.kind === "ok" ? "form-ok" : "form-error"}>{banner.text}</div>}
      <div className="flex flex-wrap gap-2 mb-6">
        {filters.map((s) => (
          <button key={s} className={`tab-btn ${filter === s ? "tab-btn-active" : ""}`} onClick={() => setFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1.5 opacity-70">({bookings.filter((b) => (s === "all" ? true : b.status === s)).length})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">Loading bookings…</div>
      ) : shown.length === 0 ? (
        <div className="card empty-state">
          <p className="font-semibold text-ink">No {filter !== "all" ? filter : ""} bookings found.</p>
          <Link href="/dashboard/services" className="btn btn-primary mt-4">
            <CalendarPlus size={16} /> Book a service
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                  <tr>
                   <th>Service</th><th>Date</th><th>Status</th><th>Price</th><th>Payment</th><th>Note</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td className="font-semibold">{b.service.name}</td>
                    <td className="text-muted">{fmtDate(b.date)}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="font-semibold">{money(b.price)}</td>
                    <td className="text-xs">
                      <div className="font-semibold capitalize">{b.payment?.method || "—"}</div>
                      <div className={b.payment?.status === "paid" ? "text-clean" : "text-muted"}>{b.payment?.status || "—"}</div>
                    </td>
                    <td className="text-muted text-xs max-w-[180px] truncate">{b.note || "—"}</td>
                    <td className="text-right">
                      {b.payment?.method === "online" && !["paid", "refunded"].includes(b.payment?.status) && (
                        <button className="btn btn-primary btn-sm mr-2" disabled={paying === b.id} onClick={() => pay(b.id)}>
                          <CalendarPlus size={14} /> {b.payment?.status === "pending" ? "Pay now" : "Retry payment"}
                        </button>
                      )}
                      {b.status === "pending" && (
                        <button className="btn btn-danger btn-sm" onClick={() => remove(b.id)}>
                          <Trash2 size={14} /> Delete
                        </button>
                      )}
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
