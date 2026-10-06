"use client";

// ADMIN → RESIGNATION REQUESTS (READ-ONLY QUEUE).
//
// This page reviews employee resignation requests and can APPROVE one. Approval is
// deliberately explicit: it is always preceded by a confirmation that names the
// employee and spells out the consequences, and when the employee still holds
// accepted work it is refused with 409 ORPHANED_ASSIGNMENTS and requires a SECOND,
// explicit confirmation carrying a written reason. There is no decline control, no
// rehire, and no retraction, because the backend implements none of them.
//
// SECURITY: this page sends no identity and no decision. Authorization is inherited
// from app/admin/layout.jsx (`RequireAdmin`) plus the route's own `adminOnly` guard
// and the handler's in-handler role re-check. Nothing here is a substitute for
// server-side authorization.
//
// NOT A STATUS ENDPOINT FOR EMPLOYEES: an employee's own request status is not read
// here, and this page never claims a request is approved — the status shown is always
// the status the server sent.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CalendarOff,
  RotateCcw,
  Info,
} from "lucide-react";
import Shell from "@/components/Shell";
import { adminNavLinks } from "@/lib/adminNav";
import { api, fmtDateTime } from "@/lib/api";


const FILTERS = [
  { value: "", label: "All requests" },
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
];

const STATUS_CLASS = {
  requested: "bg-warnbg text-amber-700 border border-amber-200",
  approved: "bg-okbg text-clean-dark border border-green-200",
  declined: "bg-slate-100 text-slate-500 border border-slate-200",
};

const statusClass = (status) =>
  STATUS_CLASS[status] || "bg-slate-100 text-slate-500 border border-slate-200";

// The backend validates `orphanReason` with the SAME bounded-note validator used
// for the employee's note (isValidBoundedNote, NOTE_MAX_LENGTH = 500). The bound
// is INCLUSIVE: 500 characters is accepted, 501 is refused. The server remains the
// authority; this only spares the admin a pointless round trip.
const ORPHAN_REASON_MAX_LENGTH = 500;

export default function AdminResignationPage() {
  const [resignations, setResignations] = useState([]);
  const [counts, setCounts] = useState({ requested: 0, approved: 0, declined: 0 });
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---- Approval state (added for the admin decision) ----
  // `busy` is the existing admin convention: a string key of `${id}:approve`.
  // Any truthy value disables every Approve button, so one slow approval cannot
  // be joined by a second click on another row.
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  // The orphan gate is a two-STEP decision and is never automatic: the first
  // request is refused with 409 ORPHANED_ASSIGNMENTS, and NOTHING is retried
  // until an admin explicitly confirms abandonment WITH a written reason.
  const [orphan, setOrphan] = useState(null); // { id, employeeName, count, bookingIds, message }
  const [orphanReason, setOrphanReason] = useState("");
  const [orphanReasonError, setOrphanReasonError] = useState(null);

  const load = useCallback(async (status) => {
    setLoading(true);
    setError(null);
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const data = await api(`/admin/resignation${query}`);
      setResignations(Array.isArray(data?.resignations) ? data.resignations : []);
      setCounts(data?.counts ?? { requested: 0, approved: 0, declined: 0 });
    } catch (err) {
      setError(err);
      setResignations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [load, filter]);

  const unauthorized = error?.status === 401 || error?.status === 403;

  const approvePath = (id) => `/admin/resignation/${encodeURIComponent(id)}/approve`;

  const closeOrphan = () => {
    // Closing the gate is a purely local action: no request is sent.
    setOrphan(null);
    setOrphanReason("");
    setOrphanReasonError(null);
  };

  // Called after ANY successful approval. Shows the real declinedShiftRequests
  // count the server returned, then reloads the queue through the existing
  // load(filter) so the list, counts and ordering all come from the server.
  const approvalSucceeded = async (res, who) => {
    const declined = Number(res?.declinedShiftRequests) || 0;
    setNotice({
      tone: "ok",
      text: `Resignation approved for ${who}. ${declined} pending shift request${
        declined === 1 ? "" : "s"
      } declined.`,
    });
    await load(filter);
  };

  // 400 "already decided" / race, and 404 both mean the queue is stale. Show the
  // server's own message and refresh; never attempt a second approval.
  const approvalFailedAndReload = async (err) => {
    setNotice({ tone: "error", text: err?.message || "We could not record that decision." });
    await load(filter);
  };

  const approve = async (request) => {
    const who = request.employeeName || "This employee";
    const question =
      `Approve the resignation for ${who}?\n\n` +
      `This ENDS the employment relationship. Their role becomes a customer and they are set offline, ` +
      `and any shift requests they still have pending will be declined.\n\n` +
      `This is an administrative decision that cannot be undone from here.`;
    if (!window.confirm(question)) return;

    setBusy(`${request.id}:approve`);
    setNotice(null);
    try {
      // No body: nothing is overridden, so the server decides whether the orphan
      // gate applies.
      const res = await api(approvePath(request.id), { method: "POST" });
      await approvalSucceeded(res, who);
    } catch (err) {
      if (err?.status === 409 && err?.data?.code === "ORPHANED_ASSIGNMENTS") {
        // REFUSED, not failed. No retry, no loop: open the explicit gate and let
        // the admin decide, with the real count and booking IDs the server sent.
        setOrphan({
          id: request.id,
          employeeName: who,
          count: err?.data?.orphanedAssignmentCount ?? 0,
          bookingIds: Array.isArray(err?.data?.orphanedBookingIds) ? err.data.orphanedBookingIds : [],
          message: err?.data?.error,
        });
        setOrphanReason("");
        setOrphanReasonError(null);
        setNotice({
          tone: "error",
          text: err?.data?.error || "This employee still holds accepted bookings.",
        });
      } else if (err?.status === 401 || err?.status === 403) {
        // The page's existing unauthorized pattern.
        setError(err);
      } else {
        await approvalFailedAndReload(err);
      }
    } finally {
      setBusy(null);
    }
  };

  // The SECOND request. It is only ever reached from the explicit gate, after a
  // valid reason, and it sends EXACTLY the two fields the backend reads.
  const confirmOrphanedApproval = async () => {
    if (!orphan) return;

    const reason = orphanReason.trim();
    if (reason.length === 0) {
      setOrphanReasonError("A reason is required to abandon outstanding assignments.");
      return;
    }
    if (reason.length > ORPHAN_REASON_MAX_LENGTH) {
      setOrphanReasonError(`The reason cannot exceed ${ORPHAN_REASON_MAX_LENGTH} characters.`);
      return;
    }

    setBusy(`${orphan.id}:approve`);
    setOrphanReasonError(null);
    setNotice(null);
    try {
      const res = await api(approvePath(orphan.id), {
        method: "POST",
        body: { confirmOrphanedAssignments: true, orphanReason: reason },
      });
      const who = orphan.employeeName || "This employee";
      closeOrphan();
      await approvalSucceeded(res, who);
    } catch (err) {
      if (err?.status === 400) {
        // The two reason failures belong next to the field that caused them.
        setOrphanReasonError(err?.message || "We could not record that decision.");
      } else if (err?.status === 401 || err?.status === 403) {
        closeOrphan();
        setError(err);
      } else if (err?.status === 404) {
        closeOrphan();
        await approvalFailedAndReload(err);
      } else {
        setNotice({ tone: "error", text: err?.message || "We could not record that decision." });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell title="Resignation Requests" links={adminNavLinks()}>
      <section className="card card-pad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Employee resignations</h2>
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
            Approving a request ends that employee&apos;s employment: their role becomes a
            customer, they are set offline, and any shift requests they still have pending are declined.
            It cannot be undone from here.
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
        <div className="empty-state">Loading resignation requests…</div>
      ) : unauthorized ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">Your admin session is no longer active.</p>
          <p className="mt-1 text-sm text-muted">Please sign in again to review resignation requests.</p>
        </div>
      ) : error ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load the resignation queue.</p>
          <p className="mt-1 text-sm text-muted">This is a temporary problem, not an empty queue.</p>
          <button className="btn btn-outline mt-4" onClick={() => load(filter)}>
            <RotateCcw size={16} /> Try again
          </button>
        </div>
      ) : resignations.length === 0 ? (
        <div className="card empty-state">
          <CalendarOff size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">Nothing to review.</p>
          <p className="mt-1 text-sm text-muted">
            {filter
              ? "There are no resignation requests with this status."
              : "When an employee submits a resignation request it will appear here for review."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {resignations.map((request) => (
            <article key={request.id} className="card card-pad">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusClass(request.status)}`}
                >
                  {request.status}
                </span>
                <span className="text-sm font-semibold text-ink">
                  {request.employeeName || "Employee"}
                </span>
              </div>

              {request.note ? <p className="mt-1.5 text-sm text-slate-700">{request.note}</p> : null}

              <p className="mt-2 text-xs text-muted">
                Requested {request.createdAt ? fmtDateTime(request.createdAt) : "recently"}
                {request.decidedAt ? ` · decided ${fmtDateTime(request.decidedAt)}` : ""}
                {request.decidedByName ? ` by ${request.decidedByName}` : ""}
              </p>

              {request.orphanedAssignmentCount !== null && request.orphanedAssignmentCount !== undefined ? (
                <p className="mt-2 text-xs text-muted">
                  Outstanding assignments abandoned: {request.orphanedAssignmentCount}
                  {request.orphanReason ? ` · reason: ${request.orphanReason}` : ""}
                  {request.orphanAcknowledgedAt
                    ? ` · acknowledged ${fmtDateTime(request.orphanAcknowledgedAt)}`
                    : ""}
                </p>
              ) : null}

              {/* Approve is offered ONLY while the server still reports the
                  request as pending. A decided request exposes no action at all,
                  because the server would refuse a second decision anyway. */}
              {request.status === "requested" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => approve(request)}
                    disabled={Boolean(busy)}
                  >
                    <Check size={14} />
                    {busy === `${request.id}:approve` ? "Approving…" : "Approve"}
                  </button>
                </div>
              ) : null}

              {/* The orphan gate. A real inline confirmation, because the backend
                  also REQUIRES a written reason — `window.confirm()` alone cannot
                  satisfy it. */}
              {orphan && orphan.id === request.id ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-warnbg p-3">
                  <p className="flex items-start gap-2 text-sm font-semibold text-amber-800">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>
                      {orphan.employeeName} still holds {orphan.count} accepted booking
                      {orphan.count === 1 ? "" : "s"}. Approving now abandons that work — the
                      bookings are not reassigned or cancelled.
                    </span>
                  </p>
                  {orphan.bookingIds.length > 0 ? (
                    <p className="mt-1.5 break-words text-xs text-amber-800">
                      Affected bookings: {orphan.bookingIds.join(", ")}
                    </p>
                  ) : null}
                  <label className="mt-2 block">
                    <span className="text-sm font-semibold text-ink">
                      Reason for abandoning them (required)
                    </span>
                    <textarea
                      className="input mt-1 w-full min-h-[80px]"
                      placeholder="Why these assignments are being abandoned"
                      value={orphanReason}
                      onChange={(e) => {
                        setOrphanReason(e.target.value);
                        setOrphanReasonError(null);
                      }}
                      maxLength={ORPHAN_REASON_MAX_LENGTH}
                      disabled={Boolean(busy)}
                    />
                  </label>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted">
                    <span>
                      {orphanReason.trim().length}/{ORPHAN_REASON_MAX_LENGTH}
                    </span>
                  </div>
                  {orphanReasonError ? (
                    <p className="mt-2 text-sm text-danger" role="alert">
                      {orphanReasonError}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={closeOrphan}
                      disabled={Boolean(busy)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={confirmOrphanedApproval}
                      disabled={Boolean(busy)}
                    >
                      {busy === `${orphan.id}:approve` ? "Approving…" : "Confirm abandonment & approve"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}