"use client";

// EMPLOYEE → MY AVAILABILITY — Phase 2B-4.
//
// INFORMATIONAL ONLY. This page lets an employee say when they are generally
// able to work. It does NOT reserve anything, does NOT appear on a customer's
// booking, and does NOT create an assignment: BookingAssignment remains the only
// source of truth for actual work. The page says so in plain words, because an
// employee reading "Available" must not assume they are scheduled.
//
// SECURITY: the API takes the employee identity from the session
// (`req.user.id`), so there is no employee-id field in this form and no way to
// address another employee's availability. Authorization is inherited from
// app/employee/layout.jsx (`RequireEmployee`).

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import Shell from "@/components/Shell";
import { employeeNavLinks } from "@/lib/employeeNav";
import { useEmployeeAvailability } from "@/lib/useEmployeeAvailability";
import {
  AVAILABILITY_DISCLAIMER,
  AVAILABILITY_EMPTY_BODY,
  AVAILABILITY_EMPTY_TITLE,
  availabilityDateLabel,
  availabilityKindLabel,
  availabilityWindowLabel,
  groupByDate,
  isUnavailable,
} from "@/lib/employeeAvailability.mjs";

const EMPTY_FORM = { date: "", startTime: "", endTime: "", kind: "available", note: "" };

export default function EmployeeAvailabilityPage() {
  const {
    availability,
    loading,
    error,
    unauthorized,
    saving,
    saved,
    savingId,
    reload,
    addWindow,
    updateWindow,
    removeWindow,
  } = useEmployeeAvailability();

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState(null);

  const groups = groupByDate(availability);
  const isEditing = Boolean(editingId);

  // The same "end must be after start" rule the server enforces, checked here
  // only so the employee gets an instant message instead of a round trip. The
  // server remains the authority and re-validates everything.
  const validate = (candidate) => {
    if (!candidate.date) return "Choose a date.";
    if (!candidate.startTime || !candidate.endTime) return "Enter a start and end time.";
    if (candidate.startTime >= candidate.endTime) return "The end time must be after the start time.";
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate(form);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    const payload = {
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      kind: form.kind,
      ...(form.note ? { note: form.note } : {}),
    };
    const result = isEditing ? await updateWindow(editingId, payload) : await addWindow(payload);
    if (result) {
      setForm(EMPTY_FORM);
      setEditingId(null);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setForm({
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      kind: row.kind,
      note: row.note ?? "",
    });
    setFormError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  return (
    <Shell
      links={employeeNavLinks()}
      sections={["Employee Portal"]}
      title="My Availability"
      subtitle="Let the admin know when you are generally able to work."
    >
      {/* Stated in the business's own words, on the page itself. */}
      <div className="card card-pad mb-5 border-l-4 border-l-brand">
        <p className="text-sm text-slate-700 leading-relaxed">{AVAILABILITY_DISCLAIMER}</p>
      </div>

      {/* Add / edit form */}
      <form className="card card-pad mb-6" onSubmit={submit}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
          {isEditing ? "Edit availability" : "Add availability"}
        </h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-ink">Date</span>
            <input
              type="date"
              className="input mt-1 w-full"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Type</span>
            <select
              className="input mt-1 w-full"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="available">I am available</option>
              <option value="unavailable">I am unavailable</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Start time</span>
            <input
              type="time"
              className="input mt-1 w-full"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">End time</span>
            <input
              type="time"
              className="input mt-1 w-full"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </label>
        </div>

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
        {error && !formError ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            We could not save that. Please try again.
          </p>
        ) : null}
        {saved ? (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted">
            <Check size={14} /> Saved.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={saving || Boolean(savingId)}>
            {saving ? "Saving…" : isEditing ? "Save changes" : <><Plus size={16} /> Add</>}
          </button>
          {isEditing ? (
            <button type="button" className="btn btn-outline" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {/* States */}
      {loading ? (
        <div className="empty-state">Loading your availability…</div>
      ) : unauthorized ? (
        <div className="card empty-state">
          <p className="font-semibold text-ink">Your employee session is no longer active.</p>
          <p className="mt-1 text-sm text-muted">Please sign in again to manage your availability.</p>
          <Link href="/login" className="btn btn-primary mt-4">
            Go to sign in
          </Link>
        </div>
      ) : error ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load your availability.</p>
          <p className="mt-1 text-sm text-muted">
            This is a temporary problem, not an empty schedule. Please try again.
          </p>
          <button className="btn btn-outline mt-4" onClick={reload}>
            <RotateCcw size={16} /> Try again
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="card empty-state">
          <CalendarClock size={32} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">{AVAILABILITY_EMPTY_TITLE}</p>
          <p className="mt-1 text-sm text-muted">{AVAILABILITY_EMPTY_BODY}</p>
        </div>
      ) : (
        // Stacked cards grouped by day — no table, so it wraps on a phone.
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.date}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">
                {availabilityDateLabel(group.date)}
              </h2>
              <div className="space-y-3">
                {group.items.map((row) => (
                  <article
                    key={row.id}
                    className={`card card-pad ${isUnavailable(row) ? "border-l-4 border-l-slate-400" : "border-l-4 border-l-brand"}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                          isUnavailable(row) ? "bg-slate-100 text-slate-600" : "bg-brand-light text-brand"
                        }`}
                      >
                        {availabilityKindLabel(row)}
                      </span>
                      <span className="text-sm font-semibold text-ink">
                        {availabilityWindowLabel(row)}
                      </span>
                    </div>
                    {row.note ? <p className="mt-1.5 text-sm text-slate-700">{row.note}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => startEdit(row)}
                        disabled={Boolean(savingId) || saving}
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => removeWindow(row.id)}
                        disabled={Boolean(savingId) || saving}
                      >
                        <Trash2 size={14} />
                        {savingId === row.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
