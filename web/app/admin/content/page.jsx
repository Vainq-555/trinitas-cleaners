"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Star, BadgePercent, Wrench, BookOpen, Globe, Plus, Save, Pencil, Power, Trash2, X, Store, CircleHelp,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

const DEFAULT_PAGE = "how-it-works";

const CONTENT_TYPES = [
  { id: "how-it-works", label: "How It Works", icon: BookOpen },
  { id: "faq", label: "FAQ", icon: CircleHelp },
];

const pageConfig = (page) =>
  page === "faq"
    ? { typeName: "FAQ", titleField: "Question", bodyField: "Answer", noun: "question" }
    : { typeName: "How It Works", titleField: "Title", bodyField: "Body", noun: "section" };

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/services", label: "Services", icon: Wrench },
  { href: "/admin/business", label: "Business Info", icon: Store },
  { href: "/admin/promotions", label: "Discounts", icon: BadgePercent },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
  { href: "/admin/content", label: "How It Works", icon: BookOpen },
  { href: "/admin/content?page=faq", label: "FAQ", icon: CircleHelp },
];

const emptyForm = { sectionKey: "", title: "", body: "", order: 0, isActive: true };

export default function ContentPage() {
  const [sections, setSections] = useState([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [scope, setScope] = useState(""); // "" = Global site, otherwise a serviceId
  const [services, setServices] = useState([]);

  const cfg = pageConfig(page);

  const load = async (scoped = scope, pageArg = page) => {
    try {
      const suffix = scoped ? `?serviceId=${encodeURIComponent(scoped)}` : "";
      const data = await api(`/admin/content/${pageArg}${suffix}`);
      setSections(data.sections);
    } catch (error) {
      setErr(error.message);
    }
  };

  const changePage = (value) => {
    setPage(value);
    setScope("");
    setMsg("");
    setErr("");
    load("", value);
  };

  const changeScope = (value) => {
    setScope(value);
    setMsg("");
    setErr("");
    load(value);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const svc = params.get("service");
    const pageParam = params.get("page") === "faq" ? "faq" : DEFAULT_PAGE;
    if (svc && pageParam === DEFAULT_PAGE) setScope(svc);
    setPage(pageParam);
    api("/admin/services")
      .then((d) => setServices(Array.isArray(d?.services) ? d.services : []))
      .catch(() => {});
    load(svc && pageParam === DEFAULT_PAGE ? svc : "", pageParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const clientValidate = (fields) => {
    if (!fields.sectionKey?.trim()) return "Section key is required.";
    if (!fields.title?.trim()) return "Title is required.";
    if (!fields.body?.trim()) return "Body is required.";
    const order = Number(fields.order);
    if (!Number.isInteger(order) || order < 0) return "Order must be a non-negative integer.";
    if (typeof fields.isActive !== "boolean") return "Active state is invalid.";
    return null;
  };

  const create = async (event) => {
    event.preventDefault();
    const order = Number(form.order);
    const body = { ...form, order };
    const validationError = clientValidate(body);
    if (validationError) return setErr(validationError);
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api(`/admin/content/${page}`, {
        method: "POST",
        body: {
          sectionKey: body.sectionKey.trim(),
          title: body.title.trim(),
          body: body.body.trim(),
          order: body.order,
          isActive: body.isActive,
          ...(scope ? { serviceId: scope } : {}),
        },
      });
      setForm({ ...emptyForm });
      setMsg("Section created.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (section) => {
    setEditing(section);
    setEditForm({
      sectionKey: section.sectionKey,
      title: section.title,
      body: section.body,
      order: section.order,
      isActive: section.isActive,
    });
    setErr("");
    setMsg("");
  };

  const setEdit = (key) => (event) => setEditForm({ ...editForm, [key]: event.target.value });

  const saveEdit = async (event) => {
    event.preventDefault();
    const order = Number(editForm.order);
    const fields = { ...editForm, order };
    const validationError = clientValidate(fields);
    if (validationError) return setErr(validationError);
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api(`/admin/content/${page}/${editing.id}`, {
        method: "PUT",
        body: {
          sectionKey: fields.sectionKey.trim(),
          title: fields.title.trim(),
          body: fields.body.trim(),
          order: fields.order,
          isActive: fields.isActive,
        },
      });
      setEditing(null);
      setMsg("Section updated.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (section) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api(`/admin/content/${page}/${section.id}`, {
        method: "PUT",
        body: { isActive: !section.isActive },
      });
      setMsg(section.isActive ? "Section deactivated." : "Section activated.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (section) => {
    if (!confirm("Delete this section? This cannot be undone.")) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api(`/admin/content/${page}/${section.id}`, { method: "DELETE" });
      setMsg("Section deleted.");
      await load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      links={links}
      sections={["Admin Portal"]}
      title={`${cfg.typeName} Content`}
      subtitle={
        page === "faq"
          ? "Manage the questions and answers shown on the public FAQ page."
          : scope
            ? `Manage this service's How It Works steps. Global content is separate and unchanged.`
            : "Manage the instructional sections shown on the public How It Works page."
      }
    >
      <div className="card card-pad mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[260px]">
            <label className="label">Content</label>
            <select className="input" value={page} onChange={(e) => changePage(e.target.value)}>
              {CONTENT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          {page === DEFAULT_PAGE && (
            <div className="flex-1 min-w-[260px]">
              <label className="label">Applies to</label>
              <select className="input" value={scope} onChange={(e) => changeScope(e.target.value)}>
                <option value="">Global site (/how-it-works)</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          {scope && page === DEFAULT_PAGE && (
            <div className="rounded-lg bg-brand-light px-4 py-2.5 text-sm text-brand-dark flex items-center gap-2">
              <BookOpen size={15} />
              Editing steps for <strong>{services.find((s) => s.id === scope)?.name || "this service"}</strong>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">
          {page === "faq"
            ? "Questions and answers here appear on the public FAQ page. FAQ is site-wide content (global only)."
            : scope
              ? "Only this service's steps are listed and created below. Global /how-it-works content is separate and unchanged."
              : "Sections here appear on the public How It Works page. Choose a service above to manage that service's own steps."}
        </p>
      </div>

      {msg && <div className="form-ok">{msg}</div>}
      {err && <div className="form-error">{err}</div>}

      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand">
            {page === "faq" ? <CircleHelp size={18} /> : <BookOpen size={18} />}
          </span>
          <div>
            <h2 className="font-bold text-ink">{page === "faq" ? "Add a question" : "Add a section"}</h2>
            <p className="text-xs text-muted">
              {page === "faq"
                ? "New questions are added to the bottom. Change the Order number to reposition."
                : scope
                  ? "New steps are added to the bottom. Change the Order number to reposition this service's steps."
                  : "New sections are added to the bottom. Change the Order number to reposition."}
            </p>
          </div>
        </div>
        <form onSubmit={create} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Key *</label>
              <input
                className="input"
                required
                value={form.sectionKey}
                onChange={set("sectionKey")}
                placeholder="e.g. request-service"
              />
              <p className="mt-1 text-[11px] text-muted">Stable unique key. Editable after creation, but must stay unique for this page.</p>
            </div>
            <div>
              <label className="label">Order *</label>
              <input
                className="input"
                required
                type="number"
                min="0"
                step="1"
                value={form.order}
                onChange={set("order")}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">{cfg.titleField} *</label>
              <input
                className="input"
                required
                value={form.title}
                onChange={set("title")}
                placeholder={page === "faq" ? "The question customers may ask" : "e.g. Step 1 — Create an account"}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">{cfg.bodyField} *</label>
              <textarea
                className="textarea"
                required
                value={form.body}
                onChange={set("body")}
                placeholder={page === "faq" ? "Provide a clear answer." : "Describe what this step covers."}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              Active and visible on the public site
            </label>
          </div>
          <button className="btn btn-primary mt-5" disabled={busy}>
            <Plus size={16} /> {busy ? "Saving..." : "Add section"}
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Section</th>
                <th>Key</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sections.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <div className="empty-state">
                      <CircleHelp size={36} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-semibold text-ink">
                        {page === "faq"
                          ? "No FAQ questions yet."
                          : scope
                            ? "No steps for this service yet."
                            : "No sections yet."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                sections.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-sm font-bold text-brand">{s.order}</td>
                    <td className="font-semibold text-ink">{s.title}</td>
                    <td>
                      <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{s.sectionKey}</code>
                    </td>
                    <td>
                      {s.isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-clean-dark border border-green-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-clean" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex gap-2">
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(s)}>
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          className={`btn btn-sm ${s.isActive ? "btn-ghost" : "btn-primary"}`}
                          disabled={busy}
                          onClick={() => toggleActive(s)}
                        >
                          <Power size={13} /> {s.isActive ? "Disable" : "Enable"}
                        </button>
                        <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => remove(s)}>
                          <Trash2 size={13} /> Delete
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
      <p className="mt-4 text-xs text-muted">
        Inactive sections are hidden from the public site but remain here for editing.
        Deactivate a section rather than deleting it if you may need it again later.
      </p>

      {editing && editForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
          onClick={() => setEditing(null)}
        >
          <div
            className="card card-pad w-full max-w-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-ink">{page === "faq" ? "Edit question" : "Edit section"}</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setEditing(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            {err && <div className="form-error mt-3">{err}</div>}
            <form onSubmit={saveEdit} className="mt-4 space-y-4">
              <div>
                <label className="label">Key *</label>
                <input
                  className="input"
                  required
                  value={editForm.sectionKey}
                  onChange={setEdit("sectionKey")}
                />
              </div>
              <div>
                <label className="label">{cfg.titleField} *</label>
                <input
                  className="input"
                  required
                  value={editForm.title}
                  onChange={setEdit("title")}
                />
              </div>
              <div>
                <label className="label">{cfg.bodyField} *</label>
                <textarea
                  className="textarea"
                  required
                  value={editForm.body}
                  onChange={setEdit("body")}
                />
              </div>
              <div>
                <label className="label">Order *</label>
                <input
                  className="input"
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={editForm.order}
                  onChange={setEdit("order")}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })}
                />
                Active and visible on the public site
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={busy}>
                  <Save size={16} /> {busy ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}