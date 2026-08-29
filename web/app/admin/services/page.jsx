"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, BadgePercent, Wrench, Plus, Save, Pencil, Power, X,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate } from "@/lib/api";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/services", label: "Services", icon: Wrench },
  { href: "/admin/promotions", label: "Discounts", icon: BadgePercent },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
];

const emptyForm = { name: "", description: "", basePrice: "", isActive: true };

export default function ServicesPage() {
  const [services, setServices] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await api("/admin/services");
      setServices(data.services);
    } catch (error) {
      setErr(error.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const validPrice = (value) => {
    const price = Number(value);
    return Number.isFinite(price) && price >= 0 ? price : null;
  };

  const create = async (event) => {
    event.preventDefault();
    const basePrice = validPrice(form.basePrice);
    if (!form.name.trim()) return setErr("Service name is required.");
    if (basePrice === null) return setErr("Enter a valid non-negative base price.");
    setBusy(true); setErr(""); setMsg("");
    try {
      await api("/admin/services", {
        method: "POST",
        body: {
          name: form.name.trim(),
          description: form.description.trim(),
          basePrice,
          isActive: form.isActive,
        },
      });
      setForm({ ...emptyForm });
      setMsg("Service created.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (service) => {
    setEditing(service);
    setEditForm({
      name: service.name,
      description: service.description || "",
      basePrice: String(service.basePrice),
      isActive: service.isActive,
    });
    setErr(""); setMsg("");
  };

  const setEdit = (key) => (event) => setEditForm({ ...editForm, [key]: event.target.value });

  const saveEdit = async (event) => {
    event.preventDefault();
    const basePrice = validPrice(editForm.basePrice);
    if (!editForm.name.trim()) return setErr("Service name is required.");
    if (basePrice === null) return setErr("Enter a valid non-negative base price.");
    setBusy(true); setErr(""); setMsg("");
    try {
      await api(`/admin/services/${editing.id}`, {
        method: "PUT",
        body: {
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          basePrice,
          isActive: editForm.isActive,
        },
      });
      setEditing(null);
      setMsg("Service updated.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (service) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      await api(`/admin/services/${service.id}`, {
        method: "PUT",
        body: { isActive: !service.isActive },
      });
      setMsg(service.isActive ? "Service deactivated." : "Service activated.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Services Manager"
      subtitle="Manage the catalog used by customers and the booking flow.">
      {msg && <div className="form-ok">{msg}</div>}
      {err && <div className="form-error">{err}</div>}

      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><Wrench size={18} /></span>
          <div>
            <h2 className="font-bold text-ink">Add a service</h2>
            <p className="text-xs text-muted">New services appear in the active customer catalog by default.</p>
          </div>
        </div>
        <form onSubmit={create} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Service name *</label>
              <input className="input" required value={form.name} onChange={set("name")} placeholder="e.g. Winter salt cleanup" />
            </div>
            <div>
              <label className="label">Base price *</label>
              <input className="input" required type="number" min="0" step="0.01" value={form.basePrice}
                onChange={set("basePrice")} placeholder="e.g. 75" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <textarea className="textarea" value={form.description} onChange={set("description")}
                placeholder="Describe what this service includes." />
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              Active and available to customers
            </label>
          </div>
          <button className="btn btn-primary mt-5" disabled={busy}>
            <Plus size={16} /> {busy ? "Saving..." : "Add service"}
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Service</th><th>Description</th><th>Base price</th><th>Status</th><th>Created</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr><td colSpan="6"><div className="empty-state"><Wrench size={36} className="mx-auto text-slate-300" /><p className="mt-3 font-semibold text-ink">No services found.</p></div></td></tr>
              ) : services.map((service) => (
                <tr key={service.id}>
                  <td className="font-semibold text-ink">{service.name}</td>
                  <td className="text-sm text-muted max-w-[320px]">{service.description || "-"}</td>
                  <td className="font-semibold text-brand whitespace-nowrap">{Number(service.basePrice).toLocaleString("en-US", { style: "currency", currency: "USD" })}</td>
                  <td>
                    {service.isActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-clean-dark border border-green-200"><span className="h-1.5 w-1.5 rounded-full bg-clean" /> Active</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Inactive</span>
                    )}
                  </td>
                  <td className="text-xs text-muted whitespace-nowrap">{fmtDate(service.createdAt)}</td>
                  <td className="text-right whitespace-nowrap">
                    <div className="inline-flex gap-2">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(service)}><Pencil size={13} /> Edit</button>
                      <button className={`btn btn-sm ${service.isActive ? "btn-ghost" : "btn-primary"}`} disabled={busy} onClick={() => toggleActive(service)}>
                        <Power size={13} /> {service.isActive ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">Services are never deleted here. Deactivate a service to remove it from the customer catalog while preserving existing bookings.</p>

      {editing && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="card card-pad w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-ink">Edit service</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} aria-label="Close"><X size={16} /></button>
            </div>
            {err && <div className="form-error mt-3">{err}</div>}
            <form onSubmit={saveEdit} className="mt-4 space-y-4">
              <div>
                <label className="label">Service name *</label>
                <input className="input" required value={editForm.name} onChange={setEdit("name")} />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="textarea" value={editForm.description} onChange={setEdit("description")} />
              </div>
              <div>
                <label className="label">Base price *</label>
                <input className="input" required type="number" min="0" step="0.01" value={editForm.basePrice} onChange={setEdit("basePrice")} />
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                <input type="checkbox" checked={editForm.isActive}
                  onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })} />
                Active and available to customers
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={busy}><Save size={16} /> {busy ? "Saving..." : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}
