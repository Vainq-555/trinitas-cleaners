"use client";

import { useState } from "react";
import { AlertTriangle, Check, Info, Send } from "lucide-react";
import Shell from "@/components/Shell";
import { employeeNavLinks } from "@/lib/employeeNav";
import { api } from "@/lib/api";

const NOTE_MAX_LENGTH = 500;

export default function EmployeeResignationPage() {
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);

  const trimmed = note.trim();

  const isValid = () => {
    const t = note.trim();
    return t.length <= NOTE_MAX_LENGTH;
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setError(null);
    setSuccess(null);

    const t = note.trim();
    if (t.length > NOTE_MAX_LENGTH) {
      setFormError(`Note cannot exceed ${NOTE_MAX_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      const body = { note: t === "" ? null : t };
      const res = await api("/employee/resignation", {
        method: "POST",
        body,
      });
      setSuccess(res?.resignation || null);
      setNote("");
    } catch (err) {
      if (err?.status === 409) {
        setError("You already have a pending resignation request.");
      } else if (err?.status === 401 || err?.status === 403) {
        setError("Your session is no longer active. Please sign in again.");
      } else {
        setError(err?.message || "We could not submit your resignation request. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell title="Resignation" links={employeeNavLinks()}>
      <section className="card card-pad">
        <h2 className="text-lg font-bold text-ink">Submit a resignation request</h2>
        <p className="mt-1 text-sm text-muted">
          This is a formal request to end your employment. Only an admin can approve it. Submitting this request does not
          mean it has been approved.
        </p>

        <form className="mt-4" onSubmit={submit}>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Note (optional)</span>
            <textarea
              className="input mt-1 w-full min-h-[120px]"
              placeholder="You may add an optional reason or context (max 500 characters)."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX_LENGTH}
              disabled={submitting}
            />
          </label>
          <div className="mt-1 flex items-center justify-between text-xs text-muted">
            <span>{trimmed.length === 0 ? "Empty or whitespace-only note will be stored as no note." : null}</span>
            <span>
              {note.length}/{NOTE_MAX_LENGTH}
            </span>
          </div>

          {formError ? (
            <p className="mt-3 text-sm text-danger" role="alert">
              {formError}
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          {success ? (
            <div className="mt-3 rounded-lg bg-okbg px-3 py-2 text-sm text-clean-dark" role="status">
              <div className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Resignation request submitted</p>
                  <p className="mt-0.5">
                    Status: <strong>{success.status || "requested"}</strong>. Your request ID: {success.id}.
                    {success.decidedAt ? " It has been decided." : " It is awaiting admin review."}
                  </p>
                  {success.note ? <p className="mt-1 text-slate-700">Note: {success.note}</p> : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={submitting || !isValid()}>
              {submitting ? (
                "Submitting..."
              ) : (
                <>
                  <Send size={16} /> Submit resignation request
                </>
              )}
            </button>
          </div>
        </form>

        <p className="mt-4 flex items-start gap-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            A pending resignation request blocks a new one. If you already have a pending request, you cannot submit
            another until it is decided.
          </span>
        </p>
      </section>

      <section className="mt-4 card card-pad">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-ink">Important</p>
            <p className="mt-0.5 text-sm text-muted">
              Approval ends your employment relationship. Any shift requests still pending at approval may be declined by
              the admin. This page only submits your request; it does not show approval status or allow retraction.
            </p>
          </div>
        </div>
      </section>
    </Shell>
  );
}
