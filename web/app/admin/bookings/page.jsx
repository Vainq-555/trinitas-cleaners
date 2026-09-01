"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Check, X, Hammer, Inbox, CheckCircle2, ThumbsDown, BadgePercent, Wrench,
  Banknote, RotateCcw, Receipt,
} from "lucide-react";
import Shell from "@/components/Shell";
import StatusBadge from "@/components/StatusBadge";
import { api, fmtDate, money, moneyCents } from "@/lib/api";
import { cashActionsFor, classifyCashError, collectPayload } from "@/lib/cashAdmin";

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

const SESSIONS = [
  { id: "pending", label: "Pending requests", icon: Inbox },
  { id: "worked", label: "Accepted & Worked", icon: CheckCircle2 },
  { id: "declined", label: "Declined", icon: ThumbsDown },
];

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [session, setSession] = useState("pending");
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { booking, action: "collect" | "refund" }
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");

  const load = () => api("/admin/bookings").then((d) => setBookings(d.bookings)).catch(() => {});
  const clearMessages = () => { setNotice(""); setErr(""); };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const setStatus = async (id, status) => {
    setBusyId(id);
    clearMessages();
    try {
      await api(`/admin/bookings/${id}/status`, { method: "PATCH", body: { status } });
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const openCollect = (booking) => {
    clearMessages();
    setConfirm({ booking, action: "collect" });
  };

  const openRefund = (booking) => {
    clearMessages();
    setConfirm({ booking, action: "refund" });
  };

  const runQuote = async (booking) => {
    setBusyId(booking.id);
    clearMessages();
    try {
      // Server recalculates the authoritative Stripe Tax quote from the booking's
      // stored service address and persists it. No amount/rate is computed here.
      await api(`/admin/payments/${booking.id}/cash-quote`, { method: "POST", body: {} });
      setNotice("Total calculated and stored. You can now collect the cash payment.");
      load();
    } catch (e) {
      setErr(classifyCashError(e).message);
    } finally {
      setBusyId(null);
    }
  };

  const runCashAction = async () => {
    const { booking, action } = confirm || {};
    if (!booking) return;
    setBusyId(booking.id);
    setErr("");
    setNotice("");
    try {
      if (action === "collect") {
        const payload = collectPayload(booking);
        if (!payload) throw new Error("No authoritative total is available for this booking");
        const result = await api(`/admin/payments/${booking.id}/cash-collect`, { method: "POST", body: payload });
        setNotice(
          `Collected ${moneyCents(payload.finalAmountCents)}. Payment ${result.payment.status}${result.receipt ? ` — receipt ${result.receipt.id.slice(0, 8).toUpperCase()} created.` : "."}`
        );
      } else {
        const result = await api(`/admin/payments/${booking.id}/cash-refund`, { method: "POST", body: {} });
        setNotice(`Cash refunded (${result.payment.status}).`);
      }
      setConfirm(null);
      load();
    } catch (e) {
      const classified = classifyCashError(e);
      setErr(classified.message);
      setConfirm(null);
      if (classified.refresh) load();
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

      {notice && <div className="form-ok">{notice}</div>}
      {err && <div className="form-error">{err}</div>}

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
                    <td className="font-semibold">
                      {b.payment?.method === "cash" ? (
                        Number.isInteger(b.finalAmountCents) ? (
                          <>
                            {moneyCents(b.finalAmountCents)}
                            <div className="text-xs font-normal text-muted">
                              {moneyCents(b.taxableSubtotalCents)} + {moneyCents(b.taxCents)} tax
                            </div>
                          </>
                        ) : (
                          <span className="text-sm font-normal text-muted">Total pending</span>
                        )
                      ) : (
                        money(b.price)
                      )}
                    </td>
                    <td className="text-xs">
                      <div className="font-semibold capitalize">{b.payment?.method || "—"}</div>
                      <div className={b.payment?.status === "paid" ? "text-clean" : b.payment?.status === "refunded" ? "text-danger" : "text-muted"}>{b.payment?.status || "—"}</div>
                      {b.payment?.amountPaid > 0 && <div>{money(b.payment.amountPaid)} paid</div>}
                      {b.payment?.method === "cash" && b.payment?.status === "refunded" && (
                        <div className="text-danger">Refunded on {b.payment?.refundedAt ? new Date(b.payment.refundedAt).toLocaleString() : ""}</div>
                      )}
                      {b.payment?.paidAt && <div className="text-muted">{new Date(b.payment.paidAt).toLocaleString()}</div>}
                      {b.payment?.stripeCheckoutSessionId && <div className="max-w-[130px] truncate text-muted" title={b.payment.stripeCheckoutSessionId}>{b.payment.stripeCheckoutSessionId}</div>}
                      {b.payment?.stripePaymentIntentId && <div className="max-w-[130px] truncate text-muted" title={b.payment.stripePaymentIntentId}>{b.payment.stripePaymentIntentId}</div>}
                    </td>
                    <td className="text-xs text-muted max-w-[180px] truncate">{b.note || "—"}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        {(() => {
                          const a = cashActionsFor(b);
                          if (a.canCollect) {
                            return (
                              <button className="btn btn-primary btn-sm" disabled={busyId === b.id} onClick={() => openCollect(b)}>
                                <Banknote size={14} /> Collect payment
                              </button>
                            );
                          }
                          if (a.needsQuote) {
                            return (
                              <button className="btn btn-secondary btn-sm" disabled={busyId === b.id} onClick={() => runQuote(b)}>
                                <Receipt size={14} /> {busyId === b.id ? "Calculating…" : "Calculate total"}
                              </button>
                            );
                          }
                          if (a.canRefund) {
                            return (
                              <button className="btn btn-secondary btn-sm" disabled={busyId === b.id} onClick={() => openRefund(b)}>
                                <RotateCcw size={14} /> Refund cash
                              </button>
                            );
                          }
                          if (a.isRefunded) {
                            return (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger">
                                <RotateCcw size={14} /> Refunded
                              </span>
                            );
                          }
                          return null;
                        })()}
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

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 px-4" role="dialog" aria-modal="true">
          <div className="card card-pad w-full max-w-md">
            {confirm.action === "collect" ? (
              <>
                <h2 className="font-bold text-ink">Collect cash payment</h2>
                <p className="mt-2 text-sm text-muted">
                  Confirm collection of{" "}
                  <span className="font-extrabold text-brand">{moneyCents(confirm.booking.finalAmountCents)}</span> for{" "}
                  <span className="font-semibold text-ink">{confirm.booking.customer.name}</span>.
                </p>
                <div className="mt-3 space-y-1.5 rounded-md bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between text-muted"><span>Taxable subtotal</span><span>{moneyCents(confirm.booking.taxableSubtotalCents)}</span></div>
                  <div className="flex justify-between text-muted"><span>Sales tax</span><span>{moneyCents(confirm.booking.taxCents)}</span></div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 font-extrabold text-ink"><span>Total due</span><span>{moneyCents(confirm.booking.finalAmountCents)}</span></div>
                </div>
                <p className="mt-1 text-xs text-muted">
                  The payment will be marked paid using exactly this authoritative total. A receipt will be generated.
                </p>
              </>
            ) : (
              <>
                <h2 className="font-bold text-ink">Refund cash payment</h2>
                <p className="mt-2 text-sm text-muted">
                  This will mark{" "}
                  <span className="font-semibold text-ink">{confirm.booking.customer.name}</span>&apos;s cash payment as{" "}
                  <span className="font-semibold text-danger">refunded</span>, zeroing amounts paid.
                </p>
                <p className="mt-1 text-xs text-muted">
                  The booking&apos;s quoted totals are kept unchanged.
                </p>
              </>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className={`btn btn-sm ${confirm.action === "collect" ? "btn-primary" : "btn-danger"}`}
                disabled={busyId === confirm.booking.id}
                onClick={runCashAction}
              >
                {busyId === confirm.booking.id ? "Working…" : confirm.action === "collect" ? `Collect ${moneyCents(confirm.booking.finalAmountCents)}` : "Confirm refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
