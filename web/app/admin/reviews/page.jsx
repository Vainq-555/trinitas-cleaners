"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Star, Check, X, Inbox, BadgePercent, Wrench, BookOpen, Store,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate } from "@/lib/api";
import {
  REVIEW_TABS,
  DEFAULT_TAB,
  ALL_SERVICES,
  filterReviews,
  countByStatus,
  EMPTY_STATE_TEXT,
} from "@/lib/reviewsAdmin";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/services", label: "Services", icon: Wrench },
  { href: "/admin/business", label: "Business Info", icon: Store },
  { href: "/admin/promotions", label: "Discounts", icon: BadgePercent },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
  { href: "/admin/content", label: "How It Works", icon: BookOpen },
];

const reviewStatusStyles = {
  pending: "bg-warnbg text-amber-700 border border-amber-200",
  approved: "bg-okbg text-clean-dark border border-green-200",
  rejected: "bg-dangerbg text-danger border border-red-200",
};

// Local moderation-status chip for reviews. Deliberately separate from the
// booking StatusBadge (which only understands booking statuses).
function ReviewStatus({ status }) {
  const label = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${reviewStatusStyles[status] || "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

// Read-only star rating display.
function Stars({ value, size = 15 }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
      ))}
    </span>
  );
}

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [services, setServices] = useState([]);
  const [tab, setTab] = useState(DEFAULT_TAB);
  const [serviceFilter, setServiceFilter] = useState(ALL_SERVICES);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    api("/admin/reviews").then((d) => setReviews(d.reviews)).catch(() => {});
    api("/admin/services").then((d) => setServices(d.services)).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live monitoring
    return () => clearInterval(t);
  }, []);

  const setStatus = async (id, status) => {
    setBusyId(id);
    setNotice("");
    setErr("");
    try {
      await api(`/admin/reviews/${id}/status`, { method: "PATCH", body: { status } });
      setNotice(status === "approved" ? "Review approved and now visible to the public." : "Review rejected.");
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const counts = countByStatus(reviews);
  const shown = filterReviews(reviews, { status: tab, serviceId: serviceFilter });

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Review Moderation"
      subtitle="Approve or reject customer reviews. Only pending reviews need action.">
      {err && <div className="form-error mb-6">{err}</div>}
      {notice && <div className="form-ok mb-6">{notice}</div>}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {REVIEW_TABS.map((t) => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? "tab-btn-active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label} <span className="ml-1 opacity-70">({counts[t.id]})</span>
          </button>
        ))}
        <select className="input ml-auto" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}
          aria-label="Filter by service">
          <option value={ALL_SERVICES}>All services</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th><th>Service</th><th>Rating</th><th>Review</th><th>Created</th><th>Status</th><th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">
                      <Inbox size={36} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-semibold text-ink">{EMPTY_STATE_TEXT[tab]}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold whitespace-nowrap">{r.customer?.name || "—"}</td>
                    <td className="text-xs text-muted whitespace-nowrap">{r.service?.name || "—"}</td>
                    <td><Stars value={r.rating} /></td>
                    <td className="text-xs max-w-[320px]">
                      {r.title && (
                        <>
                          <span className="font-semibold text-ink">{r.title}</span>
                          <br />
                        </>
                      )}
                      <span>{r.body}</span>
                    </td>
                    <td className="text-xs text-muted whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                    <td><ReviewStatus status={r.status} /></td>
                    <td className="text-right">
                      {r.status === "pending" && (
                        <span className="inline-flex items-center gap-2">
                          <button className="btn btn-primary btn-sm" disabled={busyId === r.id} onClick={() => setStatus(r.id, "approved")}>
                            <Check size={13} /> Approve
                          </button>
                          <button className="btn btn-danger btn-sm" disabled={busyId === r.id} onClick={() => setStatus(r.id, "rejected")}>
                            <X size={13} /> Reject
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}