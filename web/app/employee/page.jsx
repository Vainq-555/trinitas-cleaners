"use client";

// EMPLOYEE DASHBOARD — the employee's mobile-first home page (Phase 2B-1).
//
// Terminology is deliberately employee-specific: "assigned service(s)", never
// "my bookings", "receipts" or "payments", none of which apply to an employee
// account. Every number on this page is derived from the assignments the API
// actually returned, so there are no invented metrics.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`):
// an unauthenticated visitor goes to /login, and a customer or admin is sent to
// their own home. This page does not re-implement any of that.

import Link from "next/link";
import { ArrowRight, CalendarCheck, HardHat, Inbox } from "lucide-react";
import Shell from "@/components/Shell";
import EmployeeAssignmentCard from "@/components/EmployeeAssignmentCard";
import { useAuth } from "@/lib/auth";
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

// Shared by the two employee pages: loading, failure and unauthorized are
// distinct states, and an empty list is only ever shown after a real, successful
// response.
function AssignmentStates({ loading, error, unauthorized, empty }) {
  if (loading) {
    return <div className="empty-state">Loading your assigned services…</div>;
  }
  if (unauthorized) {
    return (
      <div className="card empty-state">
        <p className="font-semibold text-ink">Your employee session is no longer active.</p>
        <p className="mt-1 text-sm text-muted">Please sign in again to see your assigned work.</p>
        <Link href="/login" className="btn btn-primary mt-4">
          Go to sign in
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card empty-state" role="alert">
        <p className="font-semibold text-ink">We could not load your assigned services.</p>
        <p className="mt-1 text-sm text-muted">
          This is a temporary problem, not an empty schedule. Please try again.
        </p>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="card empty-state">
        <p className="font-semibold text-ink">{DASHBOARD_EMPTY_TITLE}</p>
        <p className="mt-1 text-sm text-muted">{DASHBOARD_EMPTY_BODY}</p>
      </div>
    );
  }
  return null;
}

export default function EmployeeDashboardPage() {
  const { user } = useAuth();
  const { assignments, loading, error, unauthorized } = useEmployeeAssignments();
  // Nav-only use of announcements: the unread count in the nav, from real server
  // data. Deliberately does not gate or filter the assignment list below.
  const { broadcasts } = useEmployeeBroadcasts();
  const count = visibleAssignmentCount(assignments);
  // The server already ordered this list as a work schedule (assigned start
  // first). The first row is the employee's next job, so it is previewed here.
  const nextUp = assignments[0];

  return (
    <Shell
      links={employeeNavLinks(unreadCount(broadcasts))}
      sections={["Employee Portal"]}
      title="My Work"
      subtitle="Services your administrator has assigned to you."
    >
      {/* Welcome / identity */}
      <div className="card card-pad flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand text-white">
          <HardHat size={22} />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold tracking-tight text-ink break-words">
            Welcome{user?.name ? `, ${user.name}` : ""}
          </h2>
          <p className="text-sm text-muted">Employee account · Trinitas-Cleaners</p>
        </div>
      </div>

      {/* Real, server-derived count */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="card card-pad flex items-start justify-between">
          <div>
            {loading ? (
              <div className="text-sm text-muted">Loading…</div>
            ) : (
              <div className="text-3xl font-extrabold text-ink">{count}</div>
            )}
            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {loading ? "Assigned services" : assignedServiceLabel(count)}
            </div>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light text-brand">
            <CalendarCheck size={20} />
          </span>
        </div>

        <Link href="/employee/assignments" className="card card-pad flex items-center justify-between hover:border-brand">
          <div className="min-w-0">
            <div className="text-sm font-bold text-ink">My Assigned Services</div>
            <div className="mt-1 text-xs text-muted">What, who, where and when</div>
          </div>
          <ArrowRight size={20} className="shrink-0 text-brand" />
        </Link>
      </div>

      {/* Next job */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Next assigned service</h2>
        <AssignmentStates
          loading={loading}
          error={error}
          unauthorized={unauthorized}
          empty={!loading && !error && !unauthorized && count === 0}
        />
        {nextUp ? <EmployeeAssignmentCard assignment={nextUp} /> : null}
      </div>

      {count > 1 ? (
        <div className="mt-4">
          <Link href="/employee/assignments" className="btn btn-outline w-full sm:w-auto">
            <Inbox size={16} /> View all {count} assigned services
          </Link>
        </div>
      ) : null}
    </Shell>
  );
}
