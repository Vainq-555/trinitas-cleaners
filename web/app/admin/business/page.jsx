"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Star, TicketPercent, Store, MapPin, Wrench, BookOpen,
  Plus, Save, Pencil, Power, X,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/services", label: "Services", icon: Wrench },
  { href: "/admin/business", label: "Business Info", icon: Store },
  { href: "/admin/promotions", label: "Discounts", icon: TicketPercent },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
  { href: "/admin/content", label: "How It Works", icon: BookOpen },
];

const emptyBusiness = {
  businessName: "",
  phone: "",
  email: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
  hoursWeek: "",
  hoursWeekend: "",
  responseTime: "",
};

const emptyAreaForm = { name: "", city: "", state: "", postalCode: "", description: "", order: "0", isActive: true };

export default function BusinessPage() {
  const [business, setBusiness] = useState(emptyBusiness);
  const [areas, setAreas] = useState([]);
  const [form, setForm] = useState(emptyAreaForm);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await api("/admin/business-information");
      const b = data?.business;
      setBusiness(
        b
          ? {
              businessName: b.businessName || "",
              phone: b.phone || "",
              email: b.email || "",
              addressLine1: b.addressLine1 || "",
              city: b.city || "",
              state: b.state || "",
              postalCode: b.postalCode || "",
              hoursWeek: b.hoursWeek || "",
              hoursWeekend: b.hoursWeekend || "",
              responseTime: b.responseTime || "",
            }
          : { ...emptyBusiness },
      );
    } catch (error) {
      setErr(error.message);
    }
    try {
      const data = await api("/admin/service-areas");
      setAreas(data?.areas || []);
    } catch (error) {
      setErr(error.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const set = (key) => (event) => setBusiness({ ...business, [key]: event.target.value });

  const validBusiness = () => {
    if (!business.businessName.trim()) return "Business name is required.";
    if (!business.phone.trim()) return "Phone is required.";
    if (!business.email.trim()) return "Email is required.";
    if (!business.city.trim()) return "City is required.";
    if (!/^[A-Za-z]{2}$/.test(business.state.trim())) return "State must be a 2-letter code.";
    if (!/^\d{5}(-\d{4})?$/.test(business.postalCode.trim())) return "Postal code must be a valid US ZIP code.";
    if (!business.hoursWeek.trim()) return "Weekday hours are required.";
    if (!business.hoursWeekend.trim()) return "Weekend hours are required.";
    if (!business.responseTime.trim()) return "Response time is required.";
    return null;
  };

  const saveBusiness = async (event) => {
    event.preventDefault();
    const validationError = validBusiness();
    if (validationError) return setErr(validationError);
    setBusy(true); setErr(""); setMsg("");
    try {
      await api("/admin/business-information", {
        method: "PUT",
        body: {
          businessName: business.businessName.trim(),
          phone: business.phone.trim(),
          email: business.email.trim(),
          addressLine1: business.addressLine1.trim() || null,
          city: business.city.trim(),
          state: business.state.trim().toUpperCase(),
          postalCode: business.postalCode.trim(),
          hoursWeek: business.hoursWeek.trim(),
          hoursWeekend: business.hoursWeekend.trim(),
          responseTime: business.responseTime.trim(),
        },
      });
      setMsg("Business information saved.");
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const setFormField = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const validArea = (fields) => {
    if (!fields.name.trim()) return "Service area name is required.";
    if (!fields.city.trim()) return "City is required.";
    if (!/^[A-Za-z]{2}$/.test(fields.state.trim())) return "State must be a 2-letter code.";
    const order = Number(fields.order);
    if (!Number.isInteger(order) || order < 0) return "Order must be a non-negative integer.";
    return null;
  };

  const createArea = async (event) => {
    event.preventDefault();
    const validationError = validArea(form);
    if (validationError) return setErr(validationError);
    setBusy(true); setErr(""); setMsg("");
    try {
      await api("/admin/service-areas", {
        method: "POST",
        body: {
          name: form.name.trim(),
          city: form.city.trim(),
          state: form.state.trim().toUpperCase(),
          postalCode: form.postalCode.trim() || null,
          description: form.description.trim() || null,
          order: Number(form.order),
          isActive: form.isActive,
        },
      });
      setForm({ ...emptyAreaForm });
      setMsg("Service area created.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (area) => {
    setEditing(area);
    setEditForm({
      name: area.name,
      city: area.city,
      state: area.state,
      postalCode: area.postalCode || "",
      description: area.description || "",
      order: String(area.order ?? 0),
      isActive: area.isActive,
    });
    setErr(""); setMsg("");
  };

  const setEditField = (key) => (event) => setEditForm({ ...editForm, [key]: event.target.value });

  const saveEdit = async (event) => {
    event.preventDefault();
    const validationError = validArea(editForm);
    if (validationError) return setErr(validationError);
    setBusy(true); setErr(""); setMsg("");
    try {
      await api(`/admin/service-areas/${editing.id}`, {
        method: "PUT",
        body: {
          name: editForm.name.trim(),
          city: editForm.city.trim(),
          state: editForm.state.trim().toUpperCase(),
          postalCode: editForm.postalCode.trim() || null,
          description: editForm.description.trim() || null,
          order: Number(editForm.order),
          isActive: editForm.isActive,
        },
      });
      setEditing(null);
      setMsg("Service area updated.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (area) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      await api(`/admin/service-areas/${area.id}`, {
        method: "PUT",
        body: { isActive: !area.isActive },
      });
      setMsg(area.isActive ? "Service area deactivated." : "Service area activated.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Business Info & Service Areas"
      subtitle="Manage the business facts and service-area coverage shown on the public site.">
      {msg && <div className="form-ok">{msg}</div>}
      {err && <div className="form-error">{err}</div>}

      {/* Business information */}
      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><Store size={18} /></span>
          <div>
            <h2 className="font-bold text-ink">Business information</h2>
            <p className="text-xs text-muted">Contact details and hours shown on the public site.</p>
          </div>
        </div>
        <form onSubmit={saveBusiness} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Business name *</label>
              <input className="input" required value={business.businessName} onChange={set("businessName")} placeholder="e.g. Trinitas-Cleaners" />
            </div>
            <div>
              <label className="label">Phone *</label>
              <input className="input" required value={business.phone} onChange={set("phone")} placeholder="e.g. 1 763-620-4955" />
            </div>
            <div>
              <label className="label">Email *</label>
              <input className="input" required type="email" value={business.email} onChange={set("email")} placeholder="e.g. trinitascleaner@gmail.com" />
            </div>
            <div>
              <label className="label">Address line 1 <span className="text-muted">(optional)</span></label>
              <input className="input" value={business.addressLine1} onChange={set("addressLine1")} placeholder="Street address (if any)" />
            </div>
            <div>
              <label className="label">City *</label>
              <input className="input" required value={business.city} onChange={set("city")} placeholder="e.g. Anoka" />
            </div>
            <div>
              <label className="label">State *</label>
              <input className="input" required maxLength="2" value={business.state} onChange={set("state")} placeholder="e.g. MN" />
            </div>
            <div>
              <label className="label">Postal code *</label>
              <input className="input" required maxLength="10" value={business.postalCode} onChange={set("postalCode")} placeholder="e.g. 55303" />
            </div>
            <div>
              <label className="label">Weekday hours *</label>
              <input className="input" required value={business.hoursWeek} onChange={set("hoursWeek")} placeholder="e.g. Monday – Saturday · 8:00 AM – 6:00 PM" />
            </div>
            <div>
              <label className="label">Weekend hours *</label>
              <input className="input" required value={business.hoursWeekend} onChange={set("hoursWeekend")} placeholder="e.g. Sunday · Closed" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Response time *</label>
              <input className="input" required value={business.responseTime} onChange={set("responseTime")} placeholder="e.g. Replies within one business day" />
            </div>
          </div>
          <button className="btn btn-primary mt-5" disabled={busy}>
            <Save size={16} /> {busy ? "Saving..." : "Save business info"}
          </button>
        </form>
      </div>

      {/* Service areas */}
      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><MapPin size={18} /></span>
          <div>
            <h2 className="font-bold text-ink">Create a service area</h2>
            <p className="text-xs text-muted">Active areas appear on the public Service Areas page. Use order to control listing position.</p>
          </div>
        </div>
        <form onSubmit={createArea} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Name *</label>
              <input className="input" required value={form.name} onChange={setFormField("name")} placeholder="e.g. Anoka" />
            </div>
            <div>
              <label className="label">City *</label>
              <input className="input" required value={form.city} onChange={setFormField("city")} placeholder="e.g. Anoka" />
            </div>
            <div>
              <label className="label">State *</label>
              <input className="input" required maxLength="2" value={form.state} onChange={setFormField("state")} placeholder="e.g. MN" />
            </div>
            <div>
              <label className="label">Postal code</label>
              <input className="input" maxLength="10" value={form.postalCode} onChange={setFormField("postalCode")} placeholder="e.g. 55303" />
            </div>
            <div>
              <label className="label">Order</label>
              <input className="input" type="number" min="0" step="1" value={form.order} onChange={setFormField("order")} placeholder="0" />
            </div>
            <label className="inline-flex items-end gap-2 pb-2 text-sm font-semibold text-ink">
              <input type="checkbox" className="input !w-auto !p-2" checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              Active
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Description</label>
              <textarea className="textarea" value={form.description} onChange={setFormField("description")}
                placeholder="Coverage details shown to customers." />
            </div>
          </div>
          <button className="btn btn-primary mt-5" disabled={busy}>
            <Plus size={16} /> {busy ? "Saving..." : "Create service area"}
          </button>
        </form>
      </div>

      {/* Service area list */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Area</th><th>City</th><th>State</th><th>Postal code</th><th>Order</th><th>Status</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {areas.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">
                      <MapPin size={36} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-semibold text-ink">No service areas yet.</p>
                      <p className="text-xs text-muted">Create your first coverage area above.</p>
                    </div>
                  </td>
                </tr>
              ) : areas.map((area) => (
                <tr key={area.id}>
                  <td>
                    <div className="font-semibold text-ink">{area.name}</div>
                    {area.description && <div className="text-xs text-muted max-w-[280px]">{area.description}</div>}
                  </td>
                  <td className="text-sm text-muted whitespace-nowrap">{area.city}</td>
                  <td className="text-sm text-muted whitespace-nowrap">{area.state}</td>
                  <td className="text-sm text-muted whitespace-nowrap">{area.postalCode || "—"}</td>
                  <td className="text-sm text-muted whitespace-nowrap">{area.order}</td>
                  <td>
                    {area.isActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-clean-dark border border-green-200"><span className="h-1.5 w-1.5 rounded-full bg-clean" /> Active</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Inactive</span>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <div className="inline-flex gap-2">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(area)} title="Edit"><Pencil size={13} /> Edit</button>
                      <button className={`btn btn-sm ${area.isActive ? "btn-ghost" : "btn-primary"}`} disabled={busy} onClick={() => toggleActive(area)} title={area.isActive ? "Deactivate" : "Activate"}>
                        <Power size={13} /> {area.isActive ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">Service areas are never deleted here. Deactivate an area to remove it from the public page while preserving its settings.</p>

      {/* Edit area dialog */}
      {editing && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="card card-pad w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-ink">Edit service area</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} aria-label="Close"><X size={16} /></button>
            </div>
            {err && <div className="form-error mt-3">{err}</div>}
            <form onSubmit={saveEdit} className="mt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Name *</label>
                  <input className="input" required value={editForm.name} onChange={setEditField("name")} />
                </div>
                <div>
                  <label className="label">City *</label>
                  <input className="input" required value={editForm.city} onChange={setEditField("city")} />
                </div>
                <div>
                  <label className="label">State *</label>
                  <input className="input" required maxLength="2" value={editForm.state} onChange={setEditField("state")} />
                </div>
                <div>
                  <label className="label">Postal code</label>
                  <input className="input" maxLength="10" value={editForm.postalCode} onChange={setEditField("postalCode")} placeholder="e.g. 55303" />
                </div>
                <div>
                  <label className="label">Order</label>
                  <input className="input" type="number" min="0" step="1" value={editForm.order} onChange={setEditField("order")} />
                </div>
                <label className="inline-flex items-end gap-2 pb-2 text-sm font-semibold text-ink">
                  <input type="checkbox" className="input !w-auto !p-2" checked={editForm.isActive}
                    onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })} />
                  Active
                </label>
                <div className="sm:col-span-2">
                  <label className="label">Description</label>
                  <textarea className="textarea" value={editForm.description} onChange={setEditField("description")} />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
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