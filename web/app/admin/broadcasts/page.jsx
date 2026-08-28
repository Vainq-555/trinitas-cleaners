"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Send, Trash2, BellRing, Newspaper, BadgePercent,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDateTime } from "@/lib/api";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/promotions", label: "Discounts", icon: BadgePercent },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
];

export default function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ type: "announcement", target: "public", title: "", content: "", userId: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/admin/broadcasts").then((d) => setBroadcasts(d.broadcasts)).catch(() => {});
    api("/admin/users").then((d) => setCustomers(d.users)).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const publish = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api("/admin/broadcasts", { method: "POST", body: form });
      setMsg("Broadcast published.");
      setForm({ type: "announcement", target: "public", title: "", content: "", userId: "" });
      load();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this broadcast?")) return;
    await api(`/admin/broadcasts/${id}`, { method: "DELETE" });
    load();
  };

  const targetLabel = (b) =>
    b.target === "public" ? { text: "Public site", cls: "bg-brand-light text-brand" }
      : b.target === "all" ? { text: "All customers", cls: "bg-clean-light text-clean" }
      : { text: b.user?.name || "Specific customer", cls: "bg-warnbg text-amber-700" };

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Notifications & Announcements"
      subtitle="Publish to the public site, all customers, or one specific customer.">
      {/* Publish form */}
      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><Megaphone size={18} /></span>
          <div>
            <h2 className="font-bold text-ink">Publish a broadcast</h2>
            <p className="text-xs text-muted">Pick a type and choose who sees it.</p>
          </div>
        </div>
        {err && <div className="form-error mt-4">{err}</div>}
        {msg && <div className="form-ok mt-4">{msg}</div>}
        <form onSubmit={publish} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={set("type")}>
                <option value="announcement">Announcement — general news, holiday hours</option>
                <option value="notification">Notification — booking updates, direct alerts</option>
              </select>
            </div>
            <div>
              <label className="label">Target</label>
              <select className="input" value={form.target} onChange={set("target")}>
                <option value="public">Public main site</option>
                <option value="all">All customer accounts</option>
                <option value="specific_user">A specific customer account</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Title</label>
              <input className="input" value={form.title} onChange={set("title")}
                placeholder="e.g. Holiday Hours — July 4th" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Content</label>
              <textarea className="textarea" required value={form.content} onChange={set("content")}
                placeholder="Write the message to broadcast…" />
            </div>
            {form.target === "specific_user" && (
              <div className="sm:col-span-2">
                <label className="label">Customer</label>
                <select className="input" required value={form.userId} onChange={set("userId")}>
                  <option value="">— Select customer —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button className="btn btn-primary mt-5" disabled={busy}>
            <Send size={16} /> {busy ? "Publishing…" : "Publish broadcast"}
          </button>
        </form>
      </div>

      {/* History */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th><th>Target</th><th>Message</th><th>Sent</th><th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <div className="empty-state">
                      <BellRing size={36} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-semibold text-ink">Nothing published yet.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                broadcasts.map((b) => {
                  const t = targetLabel(b);
                  return (
                    <tr key={b.id}>
                      <td>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                          b.type === "announcement" ? "bg-brand-light text-brand" : "bg-warnbg text-amber-700"
                        }`}>
                          {b.type === "announcement" ? <Newspaper size={12} /> : <BellRing size={12} />}
                          {b.type}
                        </span>
                      </td>
                      <td>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${t.cls}`}>
                          {t.text}
                        </span>
                      </td>
                      <td className="text-xs max-w-[320px]">
                        <span className="text-ink">{b.content}</span>
                      </td>
                      <td className="text-xs text-muted whitespace-nowrap">{fmtDateTime(b.createdAt)}</td>
                      <td className="text-right">
                        <button className="btn btn-danger btn-sm" onClick={() => remove(b.id)}>
                          <Trash2 size={13} /> Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}