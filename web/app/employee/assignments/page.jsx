"use client";

// MY ASSIGNED SERVICES — the employee's full work list (Phase 2B-1).
//
// The employee sees ONLY the assignments the server already approved for them:
// `GET /employee/assignments` filters on the session employee id AND
// `visibleToEmployee = true` AND an accepted, non-archived booking. This page
// performs no filtering of its own — there is deliberately no client-side
// visibility check, because a frontend filter is not authorization.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).
//
// List-only by design: there is no per-assignment detail route in this phase, so
// each card shows everything needed to answer "what, who, where, when" inline.

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import Shell from "@/components/Shell";
import EmployeeAssignmentCard from "@/components/EmployeeAssignmentCard";
import { useEmployeeAssignments } from "@/lib/useEmployeeAssignments";
import { employeeNavLinks } from "@/lib/employeeNav";
import { useEmployeeBroadcasts } from "@/lib/useEmployeeBroadcasts";
import { unreadCount } from "@/lib/employeeBroadcasts.mjs";
import {
  DASHBOARD_EMPTY_BODY,
  DASHBOARD_EMPTY_TITLE,
  assignedServiceLabel,
  visibleAssignmentCount,
} from "@/lib/employeeAssignments.mjs";

export default function EmployeeAssignmentsPage() {
  const { assignments, loading, error, unauthorized, reload } = useEmployeeAssignments();
  // Nav-only use of announcements, as on the dashboard.
  const { broadcasts } = useEmployeeBroadcasts();
  const count = visibleAssignmentCount(assignments);

  return (
    <Shell
      links={employeeNavLinks(unreadCount(broadcasts))}
      sections={["Employee Portal"]}
      title="My Assigned Services"
      subtitle="Every service currently assigned to you."
    >
      {/* Count is only stated once a real response has arrived. */}
      {!loading && !error && !unauthorized ? (
        <p className="mb-4 text-sm text-muted">{assignedServiceLabel(count)}</p>
      ) : null}

      {loading ? (
        <div className="empty-state">Loading your assigned services…</div>
      ) : unauthorized ? (
        <div className="card empty-state">
          <p className="font-semibold text-ink">Your employee session is no longer active.</p>
          <p className="mt-1 text-sm text-muted">Please sign in again to see your assigned work.</p>
          <Link href="/login" className="btn btn-primary mt-4">
            Go to sign in
          </Link>
        </div>
      ) : error ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load your assigned services.</p>
          <p className="mt-1 text-sm text-muted">
            This is a temporary problem, not an empty schedule. Please try again.
          </p>
          <button className="btn btn-outline mt-4" onClick={reload}>
            <RotateCcw size={16} /> Try again
          </button>
        </div>
      ) : count === 0 ? (
        <div className="card empty-state">
          <p className="font-semibold text-ink">{DASHBOARD_EMPTY_TITLE}</p>
          <p className="mt-1 text-sm text-muted">{DASHBOARD_EMPTY_BODY}</p>
          <Link href="/employee" className="btn btn-outline mt-4">
            Back to dashboard
          </Link>
        </div>
      ) : (
        // One card per assignment, stacked: readable on a phone, and each
        // service stays visually distinct with no table and no horizontal scroll.
        <div className="grid gap-4 md:grid-cols-2">
          {assignments.map((assignment) => (
            <EmployeeAssignmentCard key={assignment.id} assignment={assignment} />
          ))}
        </div>
      )}
    </Shell>
  );
}
