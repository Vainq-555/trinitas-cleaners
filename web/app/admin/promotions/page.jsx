"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Save, Plus, TicketPercent, Power, Pencil, X, Wrench,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate } from "@/lib/api";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/services", label: "Services", icon: Wrench },
  { href: "/admin/promotions", label: "Discounts", icon: TicketPercent },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
];

const emptyForm = {
  code: "",
  name: "",
  description: "",
  discountType: "percentage",
  discountValue: "",
  startsAt: "",
  endsAt: "",
  minSubtotal: "",
  maxUses: "",
  serviceIds: [],
  active: true,
};

const fmtValue = (p) => {
  if (p.discountType === "percentage")
    return `${(Number(p.discountValue) / 100).toLocaleString("en-US")}%`;
  return (Number(p.discountValue) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
};

const fmtCents = (cents) =>
  cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState([]);
  const [services, setServices] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/admin/promotions").then((d) => setPromotions(d.promotions)).catch(() => {});
    api("/services").then((d) => setServices(d.services)).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleService = (id) =>
    setForm({
      ...form,
      serviceIds: form.serviceIds.includes(id)
        ? form.serviceIds.filter((s) => s !== id)
        : [...form.serviceIds, id],
    });

  const validate = () => {
    if (!form.name.trim()) return "Name is required.";
    if (form.code && !/^[A-Za-z0-9_-]+$/.test(form.code)) return "Code may only contain letters, numbers, - and _.";
    const value = Number(form.discountValue);
    if (!Number.isFinite(value) || value <= 0) return "Discount value must be greater than 0.";
    if (form.discountType === "percentage" && value > 100) return "Percentage discount cannot exceed 100%.";
    if (form.endsAt && form.startsAt && new Date(form.endsAt) <= new Date(form.startsAt)) return "Expiration must be after the start date.";
    if (form.maxUses !== "" && (!Number.isInteger(Number(form.maxUses)) || Number(form.maxUses) <= 0)) return "Maximum uses must be a positive whole number.";
    return null;
  };

  const create = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const body = {
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        startsAt: form.startsAt || undefined,
        endsAt: form.endsAt || undefined,
        minSubtotal: form.minSubtotal === "" ? undefined : Number(form.minSubtotal),
        maxUses: form.maxUses === "" ? undefined : Number(form.maxUses),
        serviceIds: form.serviceIds,
        active: form.active,
      };
      await api("/admin/promotions", { method: "POST", body });
      setMsg("Promotion created.");
      setForm(emptyForm);
      load();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (p) => {
    setEditForm({
      name: p.name,
      description: p.description || "",
      active: p.active,
      startsAt: toLocalInput(p.startsAt),
      endsAt: toLocalInput(p.endsAt),
      priority: p.priority ?? 0,
      maxUses: p.maxUses == null ? "" : String(p.maxUses),
    });
    setEditing(p);
    setErr(""); setMsg("");
  };

  const setEdit = (k) => (e) => setEditForm({ ...editForm, [k]: e.target.value });

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim()) { setErr("Name is required."); return; }
    if (editForm.endsAt && editForm.startsAt && new Date(editForm.endsAt) <= new Date(editForm.startsAt)) { setErr("Expiration must be after the start date."); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      await api(`/admin/promotions/${editing.id}`, {
        method: "PATCH",
        body: {
          name: editForm.name.trim(),
          description: editForm.description.trim() || null,
          active: editForm.active,
          startsAt: editForm.startsAt || null,
          endsAt: editForm.endsAt || null,
          priority: Number(editForm.priority) || 0,
          maxUses: editForm.maxUses === "" ? null : Number(editForm.maxUses),
        },
      });
      setMsg("Promotion updated.");
      setEditing(null);
      load();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (p) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      await api(`/admin/promotions/${p.id}`, { method: "PATCH", body: { active: !p.active } });
      setMsg(p.active ? "Promotion deactivated." : "Promotion activated.");
      load();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const serviceNames = (p) =>
    p.services?.length
      ? p.services.map((ps) => services.find((service) => service.id === ps.serviceId)?.name || ps.serviceId).join(", ")
      : "All services";

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Discounts & Promotions"
      subtitle="Create discount codes, set limits, and control availability.">
      {msg && <div className="form-ok">{msg}</div>}
      {err && <div className="form-error">{err}</div>}

      {/* Create form */}
      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><TicketPercent size={18} /></span>
          <div>
            <h2 className="font-bold text-ink">Create a promotion</h2>
            <p className="text-xs text-muted">Codes are validated server-side when customers book.</p>
          </div>
        </div>
        <form onSubmit={create} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Code <span className="text-muted">(optional)</span></label>
              <input className="input" value={form.code} onChange={set("code")} placeholder="e.g. WELCOME10" />
            </div>
            <div>
              <label className="label">Name *</label>
              <input className="input" required value={form.name} onChange={set("name")} placeholder="e.g. Welcome 10% off" />
            </div>
            <div>
              <label className="label">Discount type</label>
              <select className="input" value={form.discountType} onChange={set("discountType")}>
                <option value="percentage">Percentage off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </div>
            <div>
              <label className="label">
                Discount value * {form.discountType === "percentage" ? "(%)" : "($)"}
              </label>
              <input className="input" type="number" min="0" step={form.discountType === "percentage" ? "0.01" : "0.01"}
                value={form.discountValue} onChange={set("discountValue")}
                placeholder={form.discountType === "percentage" ? "e.g. 10" : "e.g. 25"} />
            </div>
            <div>
              <label className="label">Minimum subtotal <span className="text-muted">($, optional)</span></label>
              <input className="input" type="number" min="0" step="0.01" value={form.minSubtotal} onChange={set("minSubtotal")} placeholder="e.g. 50" />
            </div>
            <div>
              <label className="label">Maximum uses <span className="text-muted">(optional)</span></label>
              <input className="input" type="number" min="1" step="1" value={form.maxUses} onChange={set("maxUses")} placeholder="Unlimited" />
            </div>
            <div>
              <label className="label">Start date <span className="text-muted">(optional)</span></label>
              <input className="input" type="datetime-local" value={form.startsAt} onChange={set("startsAt")} />
            </div>
            <div>
              <label className="label">Expiration <span className="text-muted">(optional)</span></label>
              <input className="input" type="datetime-local" value={form.endsAt} onChange={set("endsAt")} />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="label">Status</label>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                <input type="checkbox" className="input !w-auto !p-2" checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Active
              </label>
            </div>
          </div>

          <div className="mt-4">
            <label className="label">Service scope <span className="text-muted">(leave empty for all services)</span></label>
            <div className="flex flex-wrap gap-3">
              {services.map((s) => (
                <label key={s.id} className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input type="checkbox" checked={form.serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>

          <button className="btn btn-primary mt-5" disabled={busy}>
            <Plus size={16} /> {busy ? "Saving…" : "Create promotion"}
          </button>
        </form>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Active</th>
                <th>Availability</th>
                <th>Usage</th>
                <th>Service scope</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promotions.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">
                      <TicketPercent size={36} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-semibold text-ink">No promotions yet.</p>
                      <p className="text-xs text-muted">Create your first discount code above.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                promotions.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="font-semibold text-ink">{p.code || "—"}</div>
                      <div className="text-xs text-muted">{p.name}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="font-semibold text-brand">{fmtValue(p)}</span>
                    </td>
                    <td>
                      {p.active ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-clean-dark border border-green-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-clean" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-muted whitespace-nowrap">
                      {p.startsAt && <div>From {fmtDate(p.startsAt)}</div>}
                      {p.endsAt && <div>Until {fmtDate(p.endsAt)}</div>}
                      {!p.startsAt && !p.endsAt && <span>No date limits</span>}
                      {p.minSubtotalCents != null && <div>Min {fmtCents(p.minSubtotalCents)}</div>}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      <div className="font-semibold text-ink">{p.usageCount}</div>
                      <div className="text-muted">{p.maxUses == null ? "unlimited" : `of ${p.maxUses}`}</div>
                    </td>
                    <td className="text-xs text-muted max-w-[200px]">{serviceNames(p)}</td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex gap-2">
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)} title="Edit">
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          className={`btn btn-sm ${p.active ? "btn-ghost" : "btn-primary"}`}
                          onClick={() => toggleActive(p)} title={p.active ? "Deactivate" : "Activate"}>
                          <Power size={13} /> {p.active ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit dialog */}
      {editing && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="card card-pad w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-ink">Edit promotion</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}><X size={16} /></button>
            </div>
            {err && <div className="form-error mt-3">{err}</div>}
            <form onSubmit={saveEdit} className="mt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label">Name *</label>
                  <input className="input" value={editForm.name} onChange={setEdit("name")} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Description</label>
                  <input className="input" value={editForm.description} onChange={setEdit("description")} />
                </div>
                <div>
                  <label className="label">Start date</label>
                  <input className="input" type="datetime-local" value={editForm.startsAt} onChange={setEdit("startsAt")} />
                </div>
                <div>
                  <label className="label">Expiration</label>
                  <input className="input" type="datetime-local" value={editForm.endsAt} onChange={setEdit("endsAt")} />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <input className="input" type="number" value={editForm.priority} onChange={setEdit("priority")} />
                </div>
                <div>
                  <label className="label">Maximum uses</label>
                  <input className="input" type="number" min="1" value={editForm.maxUses} onChange={setEdit("maxUses")} placeholder="Unlimited" />
                </div>
                <div className="sm:col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                    <input type="checkbox" className="input !w-auto !p-2" checked={editForm.active}
                      onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} />
                    Active
                  </label>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted">
                Code, discount type/value, minimum subtotal, and service scope can&apos;t be changed after creation.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={busy}>
                  <Save size={16} /> {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}
