"use client";

// EMPLOYEE ANNOUNCEMENTS — Phase 2B-2.
//
// Shows only what `GET /employee/broadcasts` returned, which the server has
// already scoped to this employee AND to the employee audience. There is no
// client-side filter and no client-side audience logic here by design: a
// frontend filter is not authorization, and duplicating the rule would only give
// a false sense of protection.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).

import Link from "next/link";
import { BellRing, Check, Megaphone, Newspaper, RotateCcw } from "lucide-react";
import Shell from "@/components/Shell";
import { employeeNavLinks } from "@/lib/employeeNav";
import { useEmployeeBroadcasts } from "@/lib/useEmployeeBroadcasts";
import {
  EMPTY_BODY,
  EMPTY_TITLE,
  typeLabel,
  unreadCount,
  unreadPill,
} from "@/lib/employeeBroadcasts.mjs";

export default function EmployeeBroadcastsPage() {
  const { broadcasts, loading, error, unauthorized, reload, markRead, markingId } = useEmployeeBroadcasts();
  const unread = unreadCount(broadcasts);

  return (
    <Shell
      links={employeeNavLinks(unread)}
      sections={["Employee Portal"]}
      title="Announcements"
      subtitle="Updates posted for employees by an administrator."
    >
      {/* Real, server-derived unread count. Only stated once a response arrived. */}
      {!loading && !error && !unauthorized ? (
        <p className="mb-4 text-sm text-muted">
          {unread === 0
            ? "You're all caught up."
            : `${unread} unread ${unread === 1 ? "announcement" : "announcements"}`}
        </p>
      ) : null}

      {loading ? (
        <div className="empty-state">Loading announcements…</div>
      ) : unauthorized ? (
        <div className="card empty-state">
          <p className="font-semibold text-ink">Your employee session is no longer active.</p>
          <p className="mt-1 text-sm text-muted">Please sign in again to see announcements.</p>
          <Link href="/login" className="btn btn-primary mt-4">
            Go to sign in
          </Link>
        </div>
      ) : error ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load announcements.</p>
          <p className="mt-1 text-sm text-muted">
            This is a temporary problem, not an empty inbox. Please try again.
          </p>
          <button className="btn btn-outline mt-4" onClick={reload}>
            <RotateCcw size={16} /> Try again
          </button>
        </div>
      ) : broadcasts.length === 0 ? (
        <div className="card empty-state">
          <Megaphone size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">{EMPTY_TITLE}</p>
          <p className="mt-1 text-sm text-muted">{EMPTY_BODY}</p>
        </div>
      ) : (
        // Stacked, newest first (server order). No table, so it wraps cleanly on
        // a phone instead of scrolling sideways.
        <div className="space-y-4">
          {broadcasts.map((b) => {
            const pill = unreadPill(b);
            return (
              <article
                key={b.id}
                className={`announcement-card ${pill ? "border-l-4 border-l-brand" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand">
                    {b.type === "notification" ? <BellRing size={12} /> : <Newspaper size={12} />}
                    {typeLabel(b)}
                  </span>
                  {pill ? (
                    <span className="inline-flex items-center rounded-full bg-warnbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                      {pill}
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted">
                    {new Date(b.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                {b.title ? <h3 className="mt-2 text-lg font-bold text-ink break-words">{b.title}</h3> : null}
                <p className="mt-1.5 text-slate-700 leading-relaxed break-words">{b.content}</p>

                {pill ? (
                  <button
                    className="btn btn-outline btn-sm mt-4"
                    disabled={markingId === b.id}
                    onClick={() => markRead(b.id)}
                  >
                    <Check size={14} /> {markingId === b.id ? "Marking…" : "Mark as read"}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
