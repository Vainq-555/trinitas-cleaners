"use client";

// ADMIN → EMPLOYEES (Phase 2A UI for the existing Phase 2A backend).
//
// This page talks ONLY to the employee-management endpoints the backend
// already ships:
//   GET  /admin/employees                list
//   POST /admin/employees               create + issue single-use invitation
//   POST /admin/employees/:id/disable   disable (account lifecycle)
//   POST /admin/employees/:id/reactivate
//   POST /admin/employees/:id/resend-invitation  fresh link for an awaiting-activation employee
// The resend control reuses the backend's single invitation system: it never
// invents a second token flow, and it never shows, receives or stores a token
// in this page. An already-activated employee is refused by the server; the
// admin is told to have the employee sign in instead.
//
// Password rules: the admin NEVER sees, sets or receives an employee password.
// The employee sets their own password through the invitation link (the
// /activate-employee flow). This page only ever renders the whitelisted fields
// the API returns (name, email, phone, status, lastActiveAt, disabledAt, counts)
// — never passwordHash, never an invitation token, never a booking/receipt.
//
// Lifecycle shown here is derived from server fields only:
//   disabledAt set          → Disabled
//   no disabledAt, has lastActiveAt (or online) → Active
//   no disabledAt, no sign-in recorded yet      → Invited (activation pending)

import { useCallback, useEffect, useState } from "react";
import {
  UsersRound,
  Plus,
  RefreshCw,
  Ban,
  UserCheck,
  Phone,
  Mail,
  ShieldAlert,
  Clock,
} from "lucide-react";
import Shell from "@/components/Shell";
import { adminNavLinks } from "@/lib/adminNav";
import { api, fmtDateTime } from "@/lib/api";


const employeeState = (e) => {
  if (e.disabledAt) return "disabled";
  if (e.lastActiveAt || e.status === "online") return "active";
  return "invited";
};

const STATE_META = {
  active: { label: "Active", cls: "bg-okbg text-clean-dark border border-green-200" },
  invited: { label: "Invited", cls: "bg-warnbg text-amber-700 border border-amber-200" },
  disabled: { label: "Disabled", cls: "bg-slate-100 text-slate-500 border border-slate-200" },
};

function StatePill({ employee }) {
  const { label, cls } = STATE_META[employeeState(employee)];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

export default function AdminEmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    return api("/admin/employees")
      .then((d) => setEmployees(d.employees))
      .catch((err) => setLoadError(err.message || "Could not load employees"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = employees.reduce(
    (acc, e) => {
      acc[employeeState(e)] += 1;
      return acc;
    },
    { active: 0, invited: 0, disabled: 0 }
  );

  const invite = async (ev) => {
    ev.preventDefault();
    setFormError("");
    setNotice(null);

    if (!form.name.trim()) return setFormError("Name is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return setFormError("Enter a valid email address");
    }
    if (form.phone && !/^[+\d][\d\s().-]{6,}$/.test(form.phone.trim())) {
      return setFormError("Enter a valid phone number");
    }

    setBusy("create");
    try {
      const res = await api("/admin/employees", {
        method: "POST",
        body: { name: form.name, email: form.email, phone: form.phone },
      });
      setForm({ name: "", email: "", phone: "" });
      const expires = res?.invitationExpiresAt ? fmtDateTime(res.invitationExpiresAt) : null;
      setNotice({
        tone: "ok",
        text: expires
          ? `Invitation sent to ${res.employee.email}. They must set their own password before it expires ${expires}.`
          : `Invitation sent to ${res.employee.email}.`,
      });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };

  const setDisabled = async (employee, disable) => {
    const action = disable ? "disable" : "reactivate";
    const confirmMsg = disable
      ? `Disable ${employee.name}? They will be signed out immediately and their current invitation stops working. Their history stays intact.`
      : `Reactivate ${employee.name}? They can sign in again; their account and history resume unchanged.`;
    if (!confirm(confirmMsg)) return;
    setBusy(`${employee.id}:${action}`);
    setNotice(null);
    try {
      await api(`/admin/employees/${employee.id}/${action}`, { method: "POST" });
      setNotice({ tone: "ok", text: `${employee.name} has been ${disable ? "disabled" : "reactivated"}.` });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };

  const resendInvite = async (employee) => {
    const msg = `Re-send the activation invitation to ${employee.name} (${employee.email})?\nThe previous link stops working immediately; the new one expires in 24 hours.`;
    if (!confirm(msg)) return;
    setBusy(`resend:${employee.id}`);
    setNotice(null);
    try {
      const res = await api(`/admin/employees/${employee.id}/resend-invitation`, { method: "POST" });
      const expires = res?.invitationExpiresAt ? fmtDateTime(res.invitationExpiresAt) : null;
      setNotice({
        tone: "ok",
        text: expires
          ? `A new invitation was sent to ${employee.email}; it expires ${expires}.`
          : `A new invitation was sent to ${employee.email}.`,
      });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    } finally {
      setBusy("");
    }
  };

  return (
    <Shell links={adminNavLinks()} sections={["Admin Portal"]} title="Employees"
      subtitle="Invite, monitor, and manage employee accounts. Employees set their own passwords.">
      {notice ? (
        <p className={`mb-4 text-sm ${notice.tone === "ok" ? "text-muted" : "text-danger"}`} role="alert">
          {notice.text}
        </p>
      ) : null}

      {/* Invite */}
      <form className="card card-pad mb-6" onSubmit={invite}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
          <Plus size={14} className="inline -mt-0.5 mr-1" /> Invite an employee
        </h2>
        <p className="mt-1 text-xs text-muted">
          The employee receives a single-use link and sets their own password. The admin never sees it.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="text-sm font-semibold text-ink">Full name</span>
            <input
              className="input mt-1 w-full"
              placeholder="e.g. Maya Rodriguez"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Email</span>
            <input
              type="email"
              className="input mt-1 w-full"
              placeholder="employee@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Phone (optional)</span>
            <input
              type="tel"
              className="input mt-1 w-full"
              placeholder="(312) 555-0142"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
        </div>
        {formError ? (
          <p className="mt-3 text-sm text-danger" role="alert">{formError}</p>
        ) : null}
        <button className="btn btn-primary mt-4" disabled={busy === "create"}>
          {busy === "create" ? (
            <><RefreshCw size={16} className="animate-spin" /> Sending invitation…</>
          ) : (
            <><Plus size={16} /> Send invitation</>
          )}
        </button>
      </form>

      {/* Summary */}
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-okbg border border-green-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-clean-dark">
          Active ({counts.active})
        </span>
        <span className="rounded-full bg-warnbg border border-amber-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
          Invited ({counts.invited})
        </span>
        <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Disabled ({counts.disabled})
        </span>
      </div>

      {loading ? (
        <div className="empty-state">Loading employees…</div>
      ) : loadError ? (
        <div className="card empty-state" role="alert">
          <p className="font-semibold text-ink">We could not load employees.</p>
          <p className="mt-1 text-sm text-muted">This is a temporary problem, not an empty list.</p>
          <button className="btn btn-outline mt-4" onClick={() => { setLoading(true); setLoadError(""); load(); }}>
            <RefreshCw size={16} /> Try again
          </button>
        </div>
      ) : employees.length === 0 ? (
        <div className="card empty-state">
          <UsersRound size={30} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">No employees yet.</p>
          <p className="mt-1 text-sm text-muted">Invite the first employee above to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {employees.map((e) => {
            const state = employeeState(e);
            const busyKey = e.id;
            const working =
              busy === `${busyKey}:disable` || busy === `${busyKey}:reactivate` || busy === `resend:${busyKey}`;
            const active = state === "active";
            const disabled = state === "disabled";
            return (
              <article key={e.id} className="card card-pad">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-ink truncate">{e.name}</h3>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted truncate">
                      <Mail size={13} className="shrink-0" /> {e.email}
                    </p>
                    {e.phone ? (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted truncate">
                        <Phone size={13} className="shrink-0" /> {e.phone}
                      </p>
                    ) : null}
                  </div>
                  <StatePill employee={e} />
                </div>

                <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-muted">
                  <div className="flex justify-between gap-2">
                    <dt className="flex items-center gap-1.5"><Clock size={12} /> Last active</dt>
                    <dd>{e.lastActiveAt ? fmtDateTime(e.lastActiveAt) : "Never signed in"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="flex items-center gap-1.5"><ShieldAlert size={12} /> Assignments</dt>
                    <dd>{e.assignmentCount ?? 0}</dd>
                  </div>
                  {disabled ? (
                    <div className="flex justify-between gap-2 text-slate-500">
                      <dt>Disabled</dt>
                      <dd>{fmtDateTime(e.disabledAt)}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="mt-3 flex flex-wrap gap-2">
                  {active ? (
                    <button className="btn btn-outline btn-sm" disabled={working}
                      onClick={() => setDisabled(e, true)}>
                      {working && busy === `${busyKey}:disable` ? (
                        <><RefreshCw size={14} className="animate-spin" /> Disabling…</>
                      ) : (
                        <><Ban size={14} /> Disable</>
                      )}
                    </button>
                  ) : disabled ? (
                    <button className="btn btn-primary btn-sm" disabled={working}
                      onClick={() => setDisabled(e, false)}>
                      {working && busy === `${busyKey}:reactivate` ? (
                        <><RefreshCw size={14} className="animate-spin" /> Reactivating…</>
                      ) : (
                        <><UserCheck size={14} /> Reactivate</>
                      )}
                    </button>
                  ) : (
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={working}
                      onClick={() => resendInvite(e)}
                      title="Re-send a fresh activation invitation; the previous link stops working"
                    >
                      {working && busy === `resend:${busyKey}` ? (
                        <><RefreshCw size={14} className="animate-spin" /> Resending…</>
                      ) : (
                        <><RefreshCw size={14} /> Resend invitation</>
                      )}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}