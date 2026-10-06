"use client";

import { useEffect, useState } from "react";
import {
  Check,
  X,
  Hammer,
  Inbox,
  CheckCircle2,
  ThumbsDown,
  Banknote,
  RotateCcw,
  Receipt,
  Eye,
  UsersRound,
  UserPlus,
} from "lucide-react";
import Shell from "@/components/Shell";
import { adminNavLinks } from "@/lib/adminNav";
import StatusBadge from "@/components/StatusBadge";
import { api, fmtDate, money, moneyCents } from "@/lib/api";
import { formatChicagoSchedule } from "@/lib/schedule";
import { cashActionsFor, classifyCashError, collectPayload } from "@/lib/cashAdmin";
import { BOOKING_TABS, DEFAULT_TAB, EMPTY_STATE_TEXT, filterBySession, countBySession } from "@/lib/bookingsTabs";
import {
  subscriptionStatusInfo,
  subscriptionTerm,
  subscriptionProgress,
  subscriptionMonthlyPriceCents,
  subscriptionPeriodText,
} from "@/lib/subscriptions";


const SESSION_ICONS = {
  all: Inbox,
  pending: Inbox,
  worked: CheckCircle2,
  declined: ThumbsDown,
};

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [session, setSession] = useState(DEFAULT_TAB);
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { booking, action: "collect" | "refund" }
  const [details, setDetails] = useState(null); // booking detail modal (service location + schedule)
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const [employees, setEmployees] = useState([]);
  const [assignment, setAssignment] = useState(null); // { booking } assign-employee dialog
  const [assignForm, setAssignForm] = useState({ employeeId: "", scheduledStartAt: "" });
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignErr, setAssignErr] = useState("");

  const load = () => api("/admin/bookings").then((d) => setBookings(d.bookings)).catch(() => {});
  const clearMessages = () => { setNotice(""); setErr(""); };

  useEffect(() => {
    load();
    api("/admin/employees").then((d) => setEmployees(d.employees || [])).catch(() => {});
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

  const enabledEmployees = employees.filter((e) => !e.disabledAt);
  const assignedEmployee = (booking) => booking.employeeAssignments?.[0]?.employee?.name || null;

  const openAssign = (booking) => {
    clearMessages();
    const current = booking.employeeAssignments?.[0];
    setAssignErr(""); // reset per-open
    setAssignForm({
      employeeId: current?.employeeId || "",
      // datetime-local needs local YYYY-MM-DDTHH:mm; the API returns ISO UTC.
      scheduledStartAt: current?.scheduledStartAt ? new Date(current.scheduledStartAt).toISOString().slice(0, 16) : "",
    });
    setAssignment({ booking });
  };

  const submitAssign = async () => {
    const booking = assignment?.booking;
    if (!booking) return;
    if (!assignForm.employeeId) {
      setAssignErr("Select an employee to assign.");
      return;
    }
    setAssignBusy(true);
    setAssignErr(""); // reset per-submit
    setNotice("");
    setErr("");
    try {
      // Reuses the existing upsert endpoint. visibleToEmployee is intentionally
      // omitted: new assignments keep the server default, reassignment keeps the
      // existing flag exactly (see applyBookingAssignment).
      const body = { employeeId: assignForm.employeeId };
      if (assignForm.scheduledStartAt) body.scheduledStartAt = new Date(assignForm.scheduledStartAt).toISOString();
      await api(`/admin/bookings/${booking.id}/assignment`, { method: "POST", body });
      const name = employees.find((e) => e.id === assignForm.employeeId)?.name || "";
      setNotice(
        `${bookings.find((b) => b.id === booking.id)?.employeeAssignments?.[0]?.employee
          ? "Reassigned" : "Assigned"} ${name} to ${booking.service?.name} for ${booking.customer?.name}.`
      );
      setAssignment(null);
      load();
    } catch (e) {
      setAssignErr(e.message);
    } finally {
      setAssignBusy(false);
    }
  };
  const shown = filterBySession(bookings, session);
  const counts = countBySession(bookings);

  return (
    <Shell links={adminNavLinks()} sections={["Admin Portal"]} title="Booking Management"
      subtitle="All bookings are grouped into tabs by status. Newly paid online bookings appear under Accepted & Worked.">
      <div className="flex flex-wrap gap-2 mb-6">
        {BOOKING_TABS.map((s) => {
          const Icon = SESSION_ICONS[s.id];
          return (
            <button key={s.id} className={`tab-btn ${session === s.id ? "tab-btn-active" : ""}`} onClick={() => setSession(s.id)}>
              {Icon ? <Icon size={14} className="inline -mt-0.5 mr-1.5" /> : null}
              {s.label} <span className="ml-1 opacity-70">({counts[s.id]})</span>
            </button>
          );
        })}
      </div>

      {notice && <div className="form-ok">{notice}</div>}
      {err && <div className="form-error">{err}</div>}

      {shown.length === 0 ? (
        <div className="card empty-state">
          <Inbox size={36} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">{EMPTY_STATE_TEXT[session] || "No bookings in this session."}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                   <th>Customer</th><th>Service</th><th>Date</th><th>Total</th><th>Payment</th><th>Subscription</th><th>Note</th><th>Status</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="font-semibold text-ink">{b.customer.name}</div>
                      <div className="text-xs text-muted">{b.customer.email}</div>
                    </td>
                    <td>
                      <div>{b.service.name}{b.subscription && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">Monthly</span>
                        )}</div>
                      {assignedEmployee(b) && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                          <UsersRound size={11} /> Assigned: {assignedEmployee(b)}
                        </span>
                      )}
                    </td>
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
                      <td className="align-top text-[11px]">
                        {b.subscription ? (
                          <div className="space-y-1">
                            <StatusBadge status={subscriptionStatusInfo(b.subscription).status} />
                            <div className="font-semibold text-ink">{subscriptionTerm(b.subscription)}</div>
                            <div className="text-muted">{subscriptionProgress(b.subscription)}</div>
                            {subscriptionMonthlyPriceCents(b.subscription) != null && (
                              <div className="font-semibold text-brand">{moneyCents(subscriptionMonthlyPriceCents(b.subscription))}<span className="font-normal text-muted"> / month</span></div>
                            )}
                            {subscriptionPeriodText(b.subscription) && <div className="text-muted">Period: {subscriptionPeriodText(b.subscription)}</div>}
                            {b.subscription.cancelAtPeriodEnd && (
                              <div className="text-amber-700 font-semibold">Cancel at period end</div>
                            )}
                            {b.subscription.finalCancelPending && !b.subscription.finalCancelConfirmedAt && (
                              <div className="text-amber-700 font-semibold">Final cancel pending</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className="text-xs text-muted max-w-[180px] truncate">{b.note || "—"}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetails(b)} title="View service location and schedule">
                          <Eye size={14} /> Details
                        </button>
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
                          <>
                            <button className="btn btn-secondary btn-sm" disabled={busyId === b.id} onClick={() => openAssign(b)} title="Assign this accepted booking to an employee">
                              <UserPlus size={14} /> {assignedEmployee(b) ? "Reassign" : "Assign"}
                            </button>
                            <button className="btn btn-secondary btn-sm" disabled={busyId === b.id} onClick={() => setStatus(b.id, "worked")}>
                              <Hammer size={14} /> Mark worked
                            </button>
                          </>
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

      {details && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 px-4" role="dialog" aria-modal="true">
          <div className="card card-pad w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-ink">Booking details</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetails(null)}><X size={14} /> Close</button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Customer</h3>
                <p className="mt-1 font-semibold text-ink">{details.customer.name}</p>
                <p className="text-xs text-muted">{details.customer.email}</p>
                {details.customer.phone && <p className="text-xs text-muted">{details.customer.phone}</p>}
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Service</h3>
                <p className="mt-1 font-semibold text-ink">{details.service.name}</p>
                <div className="mt-1"><StatusBadge status={details.status} /></div>
                {details.subscription && (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">Monthly</span>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-brand-light/40 p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-brand">Schedule</h3>
              {formatChicagoSchedule(details.scheduledStartAt) ? (
                <div className="mt-1 text-ink">
                  <p className="font-semibold">{formatChicagoSchedule(details.scheduledStartAt).date}</p>
                  <p className="font-semibold">{formatChicagoSchedule(details.scheduledStartAt).time}</p>
                  <p className="text-xs text-muted">Clock: America/Chicago</p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">Not scheduled for a start time</p>
              )}
              <p className="mt-2 text-xs text-muted">Requested booking date: {fmtDate(details.date)}</p>
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Service location</h3>
              {details.serviceLocationAddressLine1 ? (
                <div className="mt-1 text-sm text-ink">
                  <p>{details.serviceLocationAddressLine1}{details.serviceLocationAddressLine2 ? `, ${details.serviceLocationAddressLine2}` : ""}</p>
                  <p>{details.serviceLocationCity}, {details.serviceLocationState} {details.serviceLocationPostalCode}{details.serviceLocationCountry ? ` · ${details.serviceLocationCountry}` : ""}</p>
                  {details.serviceLocationInstructions && <p className="mt-1 text-xs text-muted">{details.serviceLocationInstructions}</p>}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">Not provided for this booking</p>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Payment</h3>
                <p className="mt-1 text-sm font-semibold capitalize text-ink">{details.payment?.method || "—"}</p>
                <p className={`text-xs capitalize ${details.payment?.status === "paid" ? "text-clean" : details.payment?.status === "refunded" ? "text-danger" : "text-muted"}`}>{details.payment?.status || "—"}</p>
                {Number.isInteger(details.finalAmountCents) && <p className="mt-1 text-xs text-muted">Total: {moneyCents(details.finalAmountCents)}</p>}
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Notes for the crew</h3>
                <p className="mt-1 text-sm text-ink">{details.note || "—"}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {assignment && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 px-4" role="dialog" aria-modal="true">
          <div className="card card-pad w-full max-w-md">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-ink">Assign employee</h2>
              <button className="btn btn-ghost btn-sm" disabled={assignBusy} onClick={() => setAssignment(null)}><X size={14} /> Close</button>
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Booking</h3>
              <p className="mt-1 font-semibold text-ink">{assignment.booking.service?.name}</p>
              <p className="text-xs text-muted">{assignment.booking.customer?.name} · {fmtDate(assignment.booking.date)}</p>
            </div>

            {assignedEmployee(assignment.booking) && (
              <div className="mt-3 rounded-xl bg-brand-light/40 p-3 text-sm">
                <p className="font-semibold text-brand">
                  <UsersRound size={13} className="inline -mt-0.5 mr-1.5" />Currently assigned to {assignedEmployee(assignment.booking)}
                </p>
                <p className="mt-1 text-xs text-muted">Reassigning replaces the current assignment. The customer&apos;s own requested schedule is never modified.</p>
              </div>
            )}

            <label className="mt-4 block">
              <span className="text-sm font-semibold text-ink">Employee</span>
              <select
                className="input mt-1 w-full"
                value={assignForm.employeeId}
                disabled={assignBusy}
                onChange={(e) => setAssignForm((f) => ({ ...f, employeeId: e.target.value }))}
              >
                <option value="">Select an employee…</option>
                {enabledEmployees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="text-sm font-semibold text-ink">Employee scheduled start <span className="font-normal text-muted">(optional)</span></span>
              <input
                type="datetime-local"
                className="input mt-1 w-full"
                value={assignForm.scheduledStartAt}
                disabled={assignBusy}
                onChange={(e) => setAssignForm((f) => ({ ...f, scheduledStartAt: e.target.value }))}
              />
              <span className="mt-1 block text-xs text-muted">The employee&apos;s own schedule; distinct from the booking&apos;s requested start.</span>
            </label>

            {assignErr && <div className="form-error mt-3">{assignErr}</div>}

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-outline btn-sm" disabled={assignBusy} onClick={() => setAssignment(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={assignBusy} onClick={submitAssign}>
                {assignBusy ? "Assigning…" : assignedEmployee(assignment.booking) ? "Reassign" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
