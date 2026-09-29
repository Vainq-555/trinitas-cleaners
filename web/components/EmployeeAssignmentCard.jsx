"use client";

// Presentational card for ONE employee assignment.
//
// Rendered from `GET /employee/assignments`, which is already server-scoped to
// the session employee and filtered to `visibleToEmployee = true`. This component
// performs no authorization and adds no fields: it renders exactly the narrow
// projection the API returns, and nothing else is fetched, inferred or guessed.
//
// It answers, at a glance on a phone: what service, for whom, where, and when.

import { Fragment } from "react";
import { CalendarClock, MapPin, Phone, StickyNote, User } from "lucide-react";
import {
  NO_LOCATION_TEXT,
  NO_START_TIME_TEXT,
  assignedStart,
  hasInstructions,
  locationLines,
} from "@/lib/employeeAssignments.mjs";

// A tap-to-call link for the customer. The phone number arrives from the same
// narrow projection the API already allowed; it is never derived from anything
// else.
function PhoneRow({ phone }) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d+]/g, "");
  return (
    <a
      href={`tel:${digits}`}
      className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline break-words"
    >
      <Phone size={15} className="shrink-0" />
      {phone}
    </a>
  );
}

// One label/value pair. Stacked (not a table) so it wraps cleanly on a narrow
// screen instead of forcing horizontal overflow.
function Detail({ icon: Icon, label, children }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div className="flex gap-2.5">
      {Icon ? <Icon size={16} className="mt-0.5 shrink-0 text-muted" /> : null}
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
        <div className="mt-0.5 text-sm font-medium text-ink break-words">{children}</div>
      </div>
    </div>
  );
}

export default function EmployeeAssignmentCard({ assignment, showServiceDescription = true }) {
  const booking = assignment?.booking || {};
  const service = booking.service || {};
  const location = booking.location || {};
  const customer = booking.customer || {};

  // The employee's OWN schedule. Never the customer's requested time.
  const start = assignedStart(assignment);
  const lines = locationLines(location);
  const instructions = hasInstructions(assignment) ? String(booking.location.instructions).trim() : null;

  return (
    <article className="card card-pad">
      {/* What am I doing, for whom? */}
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-extrabold tracking-tight text-ink break-words">
            {service.name || "Service"}
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted break-words">
            <User size={14} className="shrink-0" />
            {customer.name || "Customer"}
          </p>
        </div>
        {start ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand">
            Scheduled
          </span>
        ) : null}
      </header>

      {/* When? The employee's assigned start is the authoritative schedule. */}
      <div className="mt-4 rounded-xl border border-line bg-slate-50 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Your assigned start</div>
        {start ? (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-extrabold text-ink">{start.date}</span>
            <span className="text-base font-extrabold text-brand">{start.time}</span>
          </div>
        ) : (
          <div className="mt-1 text-sm font-medium text-muted">{NO_START_TIME_TEXT}</div>
        )}
      </div>

      {/* The customer's requested date is context, never the assigned schedule. */}
      {booking.requestedDate ? (
        <p className="mt-2 text-xs text-muted">
          Customer requested:{" "}
          {new Date(booking.requestedDate).toLocaleDateString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      ) : null}

      <div className="mt-4 space-y-3.5">
        <Detail icon={CalendarClock} label="Service">
          {service.name}
        </Detail>

        {showServiceDescription && service.description ? (
          <Detail label="Service details">{service.description}</Detail>
        ) : null}

        <Detail label="Customer phone">
          <PhoneRow phone={customer.phone} />
        </Detail>

        <Detail icon={MapPin} label="Service location">
          {lines.length ? (
            <address className="not-italic">
              {lines.map((line, i) => (
                <Fragment key={`${line}-${i}`}>
                  {i > 0 ? <br /> : null}
                  {line}
                </Fragment>
              ))}
            </address>
          ) : (
            <span className="text-muted">{NO_LOCATION_TEXT}</span>
          )}
        </Detail>

        {instructions ? (
          <Detail icon={StickyNote} label="Location instructions">
            {instructions}
          </Detail>
        ) : null}
      </div>
    </article>
  );
}
