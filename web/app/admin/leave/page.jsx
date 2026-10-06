"use client";

// ADMIN → LEAVE REQUESTS.
//
// The admin's queue for employee time-off requests: who asked, which days, why, and
// whether it has been decided yet.
//
// LEAVE IS NOT AVAILABILITY, AND NEITHER IS WORK. Approving a request here records a
// DECISION and nothing else: it does not create, cancel or reassign a booking, an
// assignment or a shift (BookingAssignment stays the only source of truth for
// actual work), and it deliberately does not write an availability row — a
// preference the employee stated and a decision the admin made are different facts.
//
// A decision is made EXACTLY ONCE. The server refuses to re-decide a settled
// request, so an employee's outcome can never be silently overwritten, and the
// Approve/Decline controls are only offered while a request is genuinely pending.
//
// SECURITY: the deciding admin is taken from the session by the server
// (`req.user.id`); this page sends no identity at all, so it cannot record a
// decision as somebody else. Authorization is the route's `adminOnly` plus the
// handler's own role re-check.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarOff,
  Check,
  RotateCcw,
  X,
  Info,
} from "lucide-react";
import Shell from "@/components/Shell";
import { adminNavLinks } from "@/lib/adminNav";
import { api } from "@/lib/api";
import {
  isPendingLeave,
  leaveDecisionLabel,
  leaveKindLabel,
  leaveRangeLabel,
  leaveStatusClass,
  leaveStatusLabel,
  sortLeaveForAdmin,
} from "@/lib/employeeLeave.mjs";


const FILTERS = [
  { value: "", label: "All requests" },
  { value: "requested", label: "Awaiting decision" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
];

function requestedAtLabel(value) {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminLeavePage() {
  const [leave, setLeave] = useState([]);
  const [counts, setCounts] = useState({ requested: 0, approved: 0, declined: 0 });
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async (status) => {
    setLoading(true);
    setError(null);
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const data = await api(`/admin/leave${query}`);
      setLeave(Array.isArray(data?.leave) ? data.leave : []);
      setCounts(data?.counts ?? { requested: 0, approved: 0, declined: 0 });
    } catch (err) {
      setError(err);
      setLeave([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [load, filter]);

  // Pending first, newest first — the same order the API returns, applied again
  // client-side so the queue reads the same way after a decision.
  const ordered = useMemo(() => sortLeaveForAdmin(leave), [leave]);

  // Both decisions are confirmed, because neither can be undone: the server refuses
  // to decide a settled request, so a mis-click here cannot be quietly reversed by
  // clicking the other button.
  const decide = async (request, decision) => {
    const who = request.employeeName || "This employee";
    const question =
      decision === "approve"
        ? `Approve leave for ${who} (${leaveRangeLabel(request)})?\n\nThis records your decision only — it does not change any scheduled work.`
        : `Decline leave for ${who} (${leaveRangeLabel(request)})?\n\nThis cannot be undone from here; the employee would have to send a new request.`;
    if (!window.confirm(question)) return;

    setBusy(`${request.id}:${decision}`);
    setNotice(null);
    try {
      await api(`/admin/leave/${encodeURIComponent(request.id)}/${decision}`, { method: "POST" });
      setNotice({
        tone: "ok",
        text: decision === "approve" ? `Leave approved for ${who}.` : `Leave declined for ${who}.`,
      });
      await load(filter);
    } catch (err) {
      setNotice({ tone: "error", text: err?.message || "We could not record that decision." });
    } finally {
      setBusy(null);
    }
  };

  const unauthorized = error?.status === 401 || error?.status === 403;

  return (
    <Shell title="Leave Requests" links={adminNavLinks()}>
      <section className="card card-pad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Employee leave</h2>
            <p className="mt-1 text-sm text-muted">
              {counts.requested} awaiting a decision, {counts.approved} approved, {counts.declined} declined.
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Show</span>
            <select
              className="input mt-1"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-4 flex items-start gap-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Approving or declining records a decision only. It does not schedule, cancel or reassign any
            booking or assignment, and it does not change an employee&apos;s stated availability.
          </span>
        </p>
      </section>

      {notice ? (
        <div
          role="status"
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-okbg text-clean-dark" : "bg-dangerbg text-danger"}`}
        >
          {notice.text}
        </div>
      ) : null}

      {loading ? (
        <div className="empty-state">Loading leave requests…</div>
      ) : unauthorized ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">Your admin session is no longer active.</p>
          <p className="mt-1 text-sm text-muted">Please sign in again to review leave requests.</p>
        </div>
      ) : error ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load the leave queue.</p>
          <p className="mt-1 text-sm text-muted">This is a temporary problem, not an empty queue.</p>
          <button className="btn btn-outline mt-4" onClick={() => load(filter)}>
            <RotateCcw size={16} /> Try again
          </button>
        </div>
      ) : ordered.length === 0 ? (
        <div className="card empty-state">
          <CalendarOff size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">Nothing to review.</p>
          <p className="mt-1 text-sm text-muted">
            When an employee requests time off it will appear here for you to approve or decline.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map((request) => {
            const pending = isPendingLeave(request);
            return (
              <article key={request.id} className="card card-pad">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${leaveStatusClass(request.status)}`}
                  >
                    {leaveStatusLabel(request.status)}
                  </span>
                  <span className="text-sm font-semibold text-ink">
                    {request.employeeName || "Employee"}
                  </span>
                  <span className="text-sm text-muted">{leaveRangeLabel(request)}</span>
                  <span className="text-sm text-muted">{leaveKindLabel(request)}</span>
                </div>

                {request.note ? <p className="mt-1.5 text-sm text-slate-700">{request.note}</p> : null}

                <p className="mt-2 text-xs text-muted">
                  Requested {requestedAtLabel(request.createdAt) || "recently"}
                  {request.decidedAt ? ` · ${leaveDecisionLabel(request)}` : ""}
                </p>

                {/* Decided requests show the outcome and offer nothing further: the
                    server would refuse a second decision anyway. */}
                {pending ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => decide(request, "approve")}
                      disabled={Boolean(busy)}
                    >
                      <Check size={14} />
                      {busy === `${request.id}:approve` ? "Approving…" : "Approve"}
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => decide(request, "decline")}
                      disabled={Boolean(busy)}
                    >
                      <X size={14} />
                      {busy === `${request.id}:decline` ? "Declining…" : "Decline"}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
