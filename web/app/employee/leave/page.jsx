"use client";

// EMPLOYEE → MY LEAVE REQUESTS.
//
// A formal request for time OFF, which only an admin can approve or decline.
//
// NOT AVAILABILITY. "My Availability" (a separate page) is the employee's own
// preference about when they can work and needs no approval. This page is a request
// that gets a decision. The two are deliberately not linked: approving a request
// here never invents an availability preference, and a stated preference never
// decides a request, so neither can overwrite the other.
//
// REQUESTING IS NOT SCHEDULING. Nothing on this page creates, cancels or reassigns
// a booking, an assignment or a shift. BookingAssignment remains the only source of
// truth for actual work, and the page says so plainly so an employee does not read
// "Approved" as "my work is already moved".
//
// SECURITY: the API takes the employee identity from the session (`req.user.id`),
// so there is no employee-id field in this form and no way to address another
// employee's leave. Authorization is inherited from app/employee/layout.jsx
// (`RequireEmployee`); the server also refuses a disabled employee, because
// `authenticate` rejects a disabled account before any role check.

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarOff, Check, Info, Plus, RotateCcw } from "lucide-react";
import Shell from "@/components/Shell";
import { employeeNavLinks } from "@/lib/employeeNav";
import { useEmployeeLeave } from "@/lib/useEmployeeLeave";
import {
  LEAVE_EMPTY_BODY,
  LEAVE_EMPTY_TITLE,
  LEAVE_KINDS,
  LEAVE_REQUEST_DISCLAIMER,
  groupLeaveByWhen,
  isValidLeaveRangeInput,
  leaveDecisionLabel,
  leaveKindLabel,
  leaveRangeLabel,
  leaveStatusClass,
  leaveStatusLabel,
  todayLeaveDay,
} from "@/lib/employeeLeave.mjs";

const EMPTY_FORM = { startsOn: "", endsOn: "", kind: "", note: "" };

// One request, rendered identically wherever it appears. The only difference
// between the two sections is WHICH requests are listed, so a past request and an
// upcoming one carry exactly the same information — a request never loses its
// status, its note or its decision just because its dates have passed.
function LeaveCard({ request }) {
  return (
    <article className="card card-pad">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${leaveStatusClass(request.status)}`}
        >
          {leaveStatusLabel(request.status)}
        </span>
        <span className="text-sm font-semibold text-ink">{leaveRangeLabel(request)}</span>
        <span className="text-sm text-muted">{leaveKindLabel(request)}</span>
      </div>
      {request.note ? <p className="mt-1.5 text-sm text-slate-700">{request.note}</p> : null}
      {/* The only line about the outcome, and it is built purely from fields
          the server sent: an employee can never see a decision that was not
          made, and a pending request says exactly that. */}
      <p className="mt-2 text-xs text-muted">{leaveDecisionLabel(request)}</p>
    </article>
  );
}

// A titled section of requests. Returns nothing when it has no rows, so a page
// never shows a bare heading over nothing.
function LeaveSection({ title, hint, requests }) {
  if (requests.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      {/* Stacked cards, not a table, so it wraps on a phone. */}
      <div className="mt-3 space-y-3">
        {requests.map((request) => (
          <LeaveCard key={request.id} request={request} />
        ))}
      </div>
    </section>
  );
}

export default function EmployeeLeavePage() {
  const { leave, loading, error, unauthorized, saving, saved, reload, requestLeave } = useEmployeeLeave();

  // Split into what is still ahead of the employee and what is already behind them,
  // so a leave from last year is not filed next to one from next month. This is a
  // view of the SAME requests: nothing is deleted, no status changes, and both
  // sections together always hold every request the server sent.
  const { current, history } = useMemo(() => groupLeaveByWhen(leave, todayLeaveDay()), [leave]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);

  // The same rule the server enforces, checked here only so the employee gets an
  // instant message instead of a round trip. The server remains the authority.
  const submit = async (event) => {
    event.preventDefault();
    setFormError(null);
    if (!form.startsOn || !form.endsOn) {
      setFormError("Choose both a start date and an end date.");
      return;
    }
    if (!isValidLeaveRangeInput(form.startsOn, form.endsOn)) {
      setFormError("The end date cannot be before the start date.");
      return;
    }
    const created = await requestLeave({
      startsOn: form.startsOn,
      endsOn: form.endsOn,
      kind: form.kind,
      note: form.note,
    });
    if (created) {
      setForm(EMPTY_FORM);
      setFormError(null);
    } else {
      setFormError("We could not send that request. Please check the dates and try again.");
    }
  };

  return (
    <Shell title="My Leave" links={employeeNavLinks()}>
      <section className="card card-pad">
        <h2 className="text-lg font-bold text-ink">Request time off</h2>
        <p className="mt-1 text-sm text-muted">
          Tell the admin which days you will be away. You will see the outcome below once they decide.
        </p>

        <form className="mt-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">First day away</span>
              <input
                type="date"
                className="input mt-1 w-full"
                value={form.startsOn}
                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Last day away</span>
              <input
                type="date"
                className="input mt-1 w-full"
                value={form.endsOn}
                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
              />
            </label>
          </div>

          <label className="mt-3 block">
            <span className="text-sm font-semibold text-ink">Reason (optional)</span>
            <select
              className="input mt-1 w-full"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="">No reason given</option>
              {LEAVE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.charAt(0).toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="text-sm font-semibold text-ink">Note (optional)</span>
            <input
              className="input mt-1 w-full"
              placeholder="Anything the admin should know"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>

          {formError ? (
            <p className="mt-3 text-sm text-danger" role="alert">
              {formError}
            </p>
          ) : null}
          {saved ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted">
              <Check size={14} /> Request sent. The admin will approve or decline it.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={saving}>
              {saving ? "Sending…" : (
                <>
                  <Plus size={16} /> Request leave
                </>
              )}
            </button>
          </div>
        </form>

        <p className="mt-4 flex items-start gap-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>{LEAVE_REQUEST_DISCLAIMER}</span>
        </p>
      </section>

      {/* States */}
      {loading ? (
        <div className="empty-state">Loading your leave requests…</div>
      ) : unauthorized ? (
        <div className="card empty-state">
          <p className="font-semibold text-ink">Your employee session is no longer active.</p>
          <p className="mt-1 text-sm text-muted">Please sign in again to manage your leave requests.</p>
          <Link href="/login" className="btn btn-primary mt-4">
            Go to sign in
          </Link>
        </div>
      ) : error ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load your leave requests.</p>
          <p className="mt-1 text-sm text-muted">
            This is a temporary problem, not an empty list. Please try again.
          </p>
          <button className="btn btn-outline mt-4" onClick={reload}>
            <RotateCcw size={16} /> Try again
          </button>
        </div>
      ) : current.length === 0 && history.length === 0 ? (
        <div className="card empty-state">
          <CalendarOff size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">{LEAVE_EMPTY_TITLE}</p>
          <p className="mt-1 text-sm text-muted">{LEAVE_EMPTY_BODY}</p>
        </div>
      ) : (
        <>
          <LeaveSection
            title="Current & Upcoming Leave"
            hint="Requests that have not finished yet, nearest first. Your status is unchanged by the dates."
            requests={current}
          />
          <LeaveSection
            title="Leave History"
            hint="Requests that have already ended, most recent first. They stay here with their original outcome."
            requests={history}
          />
        </>
      )}
    </Shell>
  );
}
