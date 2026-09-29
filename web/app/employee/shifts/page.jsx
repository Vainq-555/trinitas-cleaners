"use client";

// EMPLOYEE → AVAILABLE SHIFTS — Phase 2B-4.
//
// A shift is work an ADMIN has published for the employee pool. Requesting one
// does NOT assign it: the request is recorded as "requested" and only the admin
// can approve it. The wording on this page is deliberate for that reason — a
// request never reads like a confirmation.
//
// SECURITY: the server decides what is visible. This page renders exactly the
// shifts `GET /employee/shifts` returned, and it filters nothing and re-decides
// nothing. `canRequest` is the SERVER's answer, not a client guess, so a closed,
// expired, unpublished or already-assigned shift cannot be made claimable by
// editing anything in the browser.
//
// No customer data is shown: a pool shift is not yet the employee's business,
// and once a request is approved the employee gets the customer name and phone
// through the existing My Assigned Services page.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, MapPin, RotateCcw, Send } from "lucide-react";
import Shell from "@/components/Shell";
import { employeeNavLinks } from "@/lib/employeeNav";
import { useEmployeeShifts } from "@/lib/useEmployeeShifts";
import { formatChicagoSchedule } from "@/lib/schedule.mjs";
import {
  SHIFTS_EMPTY_BODY,
  SHIFTS_EMPTY_TITLE,
  canRequestShift,
  requestStatusClass,
  requestStatusLabel,
  shiftUnavailableReason,
} from "@/lib/employeeShifts.mjs";

// The concrete time, always rendered in America/Chicago rather than the
// viewer's browser timezone, matching every other appointment in the app.
function startTimeLabel(shift) {
  const formatted = formatChicagoSchedule(shift?.customerScheduledStartAt);
  if (formatted) return `${formatted.date} at ${formatted.time}`;
  return shift?.requestedDate ? `Requested for ${new Date(shift.requestedDate).toLocaleDateString()}` : "Time to be confirmed";
}

function locationLabel(location) {
  return [location?.addressLine1, location?.city, location?.state].filter(Boolean).join(", ");
}

export default function EmployeeShiftsPage() {
  const { shifts, loading, error, unauthorized, requestingId, reload, requestShift, requestableCount } =
    useEmployeeShifts();

  const [noteFor, setNoteFor] = useState({});
  const [notice, setNotice] = useState(null);

  const ask = async (shift) => {
    setNotice(null);
    const result = await requestShift(shift.id, noteFor[shift.id] ?? "");
    setNotice(
      result
        ? { tone: "ok", text: "Request sent. The admin will review it — this does not assign the shift." }
        : { tone: "bad", text: "We could not send that request. Please try again." },
    );
  };

  return (
    <Shell
      links={employeeNavLinks()}
      sections={["Employee Portal"]}
      title="Available Shifts"
      subtitle="Work the admin has opened up. Requesting a shift does not assign it."
    >
      {!loading && !error && !unauthorized ? (
        <p className="mb-4 text-sm text-muted">
          {shifts.length === 0
            ? "No shifts are open right now."
            : `${shifts.length} available ${shifts.length === 1 ? "shift" : "shifts"}${
                requestableCount > 0 ? ` · ${requestableCount} you can request` : ""
              }`}
        </p>
      ) : null}

      {notice ? (
        <p
          className={`mb-4 text-sm ${notice.tone === "ok" ? "text-muted" : "text-danger"}`}
          role="alert"
        >
          {notice.text}
        </p>
      ) : null}

      {loading ? (
        <div className="empty-state">Loading available shifts…</div>
      ) : unauthorized ? (
        <div className="card empty-state">
          <p className="font-semibold text-ink">Your employee session is no longer active.</p>
          <p className="mt-1 text-sm text-muted">Please sign in again to see available shifts.</p>
          <Link href="/login" className="btn btn-primary mt-4">
            Go to sign in
          </Link>
        </div>
      ) : error ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load available shifts.</p>
          <p className="mt-1 text-sm text-muted">
            This is a temporary problem, not an empty list. Please try again.
          </p>
          <button className="btn btn-outline mt-4" onClick={reload}>
            <RotateCcw size={16} /> Try again
          </button>
        </div>
      ) : shifts.length === 0 ? (
        <div className="card empty-state">
          <CalendarDays size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">{SHIFTS_EMPTY_TITLE}</p>
          <p className="mt-1 text-sm text-muted">{SHIFTS_EMPTY_BODY}</p>
        </div>
      ) : (
        // Stacked cards: a shift must read cleanly on a phone, not scroll sideways.
        <div className="space-y-4">
          {shifts.map((shift) => {
            const open = canRequestShift(shift);
            const reason = shiftUnavailableReason(shift);
            const place = locationLabel(shift.location);
            return (
              <article key={shift.id} className="card card-pad">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand">
                    {shift.service?.name ?? "Service"}
                  </span>
                  {shift.myRequest ? (
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${requestStatusClass(shift.myRequest.status)}`}
                    >
                      {requestStatusLabel(shift.myRequest.status)}
                    </span>
                  ) : null}
                </div>

                <h3 className="mt-2 text-base font-bold text-ink break-words">
                  {startTimeLabel(shift)}
                </h3>

                {place ? (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-700 break-words">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-muted" />
                    {place}
                  </p>
                ) : null}

                {shift.location?.instructions ? (
                  <p className="mt-1.5 text-sm text-slate-700 break-words">{shift.location.instructions}</p>
                ) : null}

                {shift.notes ? (
                  <p className="mt-1.5 text-sm text-slate-700 break-words">{shift.notes}</p>
                ) : null}

                {open ? (
                  <div className="mt-4">
                    <label className="block">
                      <span className="text-sm font-semibold text-ink">Add a note (optional)</span>
                      <input
                        className="input mt-1 w-full"
                        placeholder="Anything the admin should know"
                        value={noteFor[shift.id] ?? ""}
                        onChange={(e) => setNoteFor({ ...noteFor, [shift.id]: e.target.value })}
                      />
                    </label>
                    <button
                      className="btn btn-primary mt-3"
                      onClick={() => ask(shift)}
                      disabled={requestingId === shift.id}
                    >
                      <Send size={16} /> {requestingId === shift.id ? "Requesting…" : "Request this shift"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted">{reason}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
