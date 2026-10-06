"use client";

// ADMIN → AVAILABLE SHIFTS — Phase 2B-4.
//
// The admin's window onto the Phase 2B-4 behaviour: publish work that has no
// assignee, read who asked for it, approve or decline, and read employee
// availability for planning.
//
// THE ONE RULE THIS PAGE MUST NOT BREAK: an employee who REQUESTS a shift is not
// assigned it. Approval is the only thing that assigns, and it goes through the
// same server-side assignment rules as assigning a booking by hand — including
// the "already assigned to someone else" 409. This page has no control that
// assigns a shift as a side effect of anything else.
//
// The candidate picker is a list of accepted, unarchived bookings. Every visible
// control here is an admin action the API already authorises; the API is still
// the authority, and this page assumes nothing.

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Send,
  Check,
  X,
  Plus,
} from "lucide-react";
import Shell from "@/components/Shell";
import { adminNavLinks } from "@/lib/adminNav";
import { api } from "@/lib/api";
import { formatChicagoSchedule } from "@/lib/schedule.mjs";
import { requestStatusClass, requestStatusLabel } from "@/lib/employeeShifts.mjs";
import {
  AVAILABILITY_DISCLAIMER,
  availabilityDateLabel,
  availabilityWindowLabel,
  groupByDate,
} from "@/lib/employeeAvailability.mjs";


function startTimeLabel(shift) {
  const when = formatChicagoSchedule(shift?.booking?.scheduledStartAt);
  if (when) return `${when.date} at ${when.time}`;
  return shift?.booking?.date ?? "Time to be confirmed";
}

function locationLabel(booking) {
  return [booking?.serviceLocationAddressLine1, booking?.serviceLocationCity, booking?.serviceLocationState]
    .filter(Boolean)
    .join(", ");
}

export default function AdminShiftsPage() {
  const [shifts, setShifts] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ bookingId: "", notes: "", closesAt: "" });
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, c, a] = await Promise.all([
        api("/admin/shifts"),
        api("/admin/shifts/candidates"),
        api("/admin/availability"),
      ]);
      setShifts(Array.isArray(s?.shifts) ? s.shifts : []);
      setCandidates(Array.isArray(c?.bookings) ? c.bookings : []);
      setAvailability(Array.isArray(a?.availability) ? a.availability : []);
    } catch (err) {
      setError(err);
      setShifts([]);
      setCandidates([]);
      setAvailability([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (tone, text) => setNotice({ tone, text });

  const createShift = async (e) => {
    e.preventDefault();
    if (!form.bookingId) {
      setFormError("Choose a booking to offer.");
      return;
    }
    setFormError(null);
    setBusy("create");
    try {
      await api("/admin/shifts", {
        method: "POST",
        body: {
          bookingId: form.bookingId,
          ...(form.notes ? { notes: form.notes } : {}),
          ...(form.closesAt ? { closesAt: form.closesAt } : {}),
        },
      });
      setForm({ bookingId: "", notes: "", closesAt: "" });
      flash("ok", "Shift published to the employee pool.");
      await load();
    } catch (err) {
      flash("bad", err?.message ?? "We could not publish that shift.");
    } finally {
      setBusy(null);
    }
  };

  // Close / reopen. This only controls whether employees can see and request
  // the shift; it assigns nobody and cancels nothing.
  const togglePublished = async (shift) => {
    setBusy(`${shift.id}:publish`);
    try {
      await api(`/admin/shifts/${encodeURIComponent(shift.id)}`, {
        method: "PATCH",
        body: { published: !shift.publishedAt },
      });
      flash("ok", shift.publishedAt ? "Shift closed for requests." : "Shift reopened for requests.");
      await load();
    } catch (err) {
      flash("bad", err?.message ?? "We could not change that shift.");
    } finally {
      setBusy(null);
    }
  };

  const decide = async (shift, request, approve) => {
    setBusy(`${request.id}:${approve ? "approve" : "decline"}`);
    try {
      await api(`/admin/shifts/${encodeURIComponent(shift.id)}/request/${encodeURIComponent(request.id)}/${approve ? "approve" : "decline"}`, {
        method: "POST",
        // Required by the server when the booking is already assigned to someone
        // else, so the UI must never silently reassign work.
        body: approve ? { confirmReassignment: true } : {},
      });
      flash(
        "ok",
        approve
          ? `${request.employee?.name ?? "Employee"} was approved and assigned.`
          : "Request declined.",
      );
      await load();
    } catch (err) {
      flash("bad", err?.message ?? "We could not record that decision.");
    } finally {
      setBusy(null);
    }
  };

  const availabilityGroups = groupByDate(availability);

  return (
    <Shell links={adminNavLinks()} sections={["Admin Portal"]} title="Shifts & Availability" subtitle="Publish unassigned work, and see who has asked for it.">
      {notice ? (
        <p className={`mb-4 text-sm ${notice.tone === "ok" ? "text-muted" : "text-danger"}`} role="alert">
          {notice.text}
        </p>
      ) : null}

      <div className="card card-pad mb-6 border-l-4 border-l-brand">
        <p className="text-sm text-slate-700 leading-relaxed">
          An employee requesting a shift does <strong>not</strong> assign it. Only approval assigns work, and it
          follows the same rules as assigning a booking by hand — a shift already assigned to another employee
          is never reassigned without confirmation.
        </p>
      </div>

      {/* Publish */}
      <form className="card card-pad mb-6" onSubmit={createShift}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Offer a shift</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-semibold text-ink">Booking with no assignee</span>
            <select
              className="input mt-1 w-full"
              value={form.bookingId}
              onChange={(e) => setForm({ ...form, bookingId: e.target.value })}
            >
              <option value="">Select a booking…</option>
              {candidates.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.date} · {b.service?.name ?? "Service"} · {locationLabel(b) || "no address"}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Notes (optional)</span>
            <input
              className="input mt-1 w-full"
              placeholder="Anything employees should know"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Close requests at (optional)</span>
            <input
              type="datetime-local"
              className="input mt-1 w-full"
              value={form.closesAt}
              onChange={(e) => setForm({ ...form, closesAt: e.target.value })}
            />
          </label>
        </div>
        {formError ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {formError}
          </p>
        ) : null}
        <button className="btn btn-primary mt-4" disabled={busy === "create"}>
          <Plus size={16} /> {busy === "create" ? "Publishing…" : "Publish to pool"}
        </button>
      </form>

      {loading ? (
        <div className="empty-state">Loading shifts…</div>
      ) : error ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load shifts.</p>
          <p className="mt-1 text-sm text-muted">This is a temporary problem, not an empty list.</p>
          <button className="btn btn-outline mt-4" onClick={load}>
            <RefreshCw size={16} /> Try again
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {shifts.length === 0 ? (
            <div className="card empty-state">
              <Send size={30} className="mx-auto text-slate-300" />
              <p className="mt-3 font-semibold text-ink">No shifts offered yet.</p>
              <p className="mt-1 text-sm text-muted">Publish a booking above to let employees request it.</p>
            </div>
          ) : null}

          {shifts.map((shift) => {
            const assignee = shift.booking?.employeeAssignments?.[0] ?? null;
            const place = locationLabel(shift.booking);
            return (
              <article key={shift.id} className="card card-pad">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                      shift.publishedAt ? "bg-brand-light text-brand" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {shift.publishedAt ? "Open" : "Closed"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                    {shift.booking?.service?.name ?? "Service"}
                  </span>
                  {assignee ? (
                    <span className="rounded-full bg-warnbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                      Assigned: {assignee.employee?.name ?? assignee.employeeId}
                    </span>
                  ) : null}
                </div>

                <h3 className="mt-2 text-base font-bold text-ink break-words">{startTimeLabel(shift)}</h3>
                {place ? <p className="mt-1 text-sm text-slate-700 break-words">{place}</p> : null}
                {shift.notes ? <p className="mt-1.5 text-sm text-slate-700 break-words">{shift.notes}</p> : null}

                <div className="mt-3">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => togglePublished(shift)}
                    disabled={busy === `${shift.id}:publish`}
                  >
                    {shift.publishedAt ? "Close requests" : "Reopen requests"}
                  </button>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                    Requests ({shift.requests?.length ?? 0})
                  </h4>
                  {(shift.requests ?? []).length === 0 ? (
                    <p className="mt-1.5 text-sm text-muted">No requests yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {shift.requests.map((request) => (
                        <li key={request.id} className="rounded-lg bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink">
                              {request.employee?.name ?? "Employee"}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${requestStatusClass(request.status)}`}
                            >
                              {requestStatusLabel(request.status)}
                            </span>
                          </div>
                          {request.note ? (
                            <p className="mt-1 text-sm text-slate-700 break-words">{request.note}</p>
                          ) : null}
                          {request.status === "requested" ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => decide(shift, request, true)}
                                disabled={busy === `${request.id}:approve`}
                              >
                                <Check size={14} /> Approve &amp; assign
                              </button>
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => decide(shift, request, false)}
                                disabled={busy === `${request.id}:decline`}
                              >
                                <X size={14} /> Decline
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Availability review */}
      <div className="card card-pad mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Employee availability</h2>
        <p className="mt-2 text-sm text-slate-700 leading-relaxed">{AVAILABILITY_DISCLAIMER}</p>

        {availability.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No employees have added availability yet.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {availabilityGroups.map((group) => (
              <div key={group.date}>
                <h3 className="text-sm font-bold text-muted">{availabilityDateLabel(group.date)}</h3>
                <ul className="mt-1.5 space-y-1.5">
                  {group.items.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="font-semibold">{row.employee?.name ?? "Employee"}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          row.kind === "unavailable" ? "bg-slate-100 text-slate-600" : "bg-brand-light text-brand"
                        }`}
                      >
                        {row.kind === "unavailable" ? "Unavailable" : "Available"}
                      </span>
                      <span>{availabilityWindowLabel(row)}</span>
                      {row.note ? <span className="text-slate-600 break-words">— {row.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
