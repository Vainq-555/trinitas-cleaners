"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Star, Send, Trash2, BellRing, Newspaper, BadgePercent, Wrench, BookOpen, Store,
MessageCircle,
  UsersRound,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDateTime } from "@/lib/api";

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
  { href: "/admin/community", label: "Community", icon: MessageCircle },
  { href: "/admin/community/groups", label: "Groups", icon: UsersRound },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
  { href: "/admin/content", label: "How It Works", icon: BookOpen },
];

export default function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [employees, setEmployees] = useState([]);
  // Phase 2B-2: `audience` (customer | employee) is chosen FIRST and is explicit.
  // The target options are then derived from it, so the four deliverable cases
  // read unambiguously — All customers / A specific customer / All employees /
  // A specific employee — and the invalid "public site + employee" combination is
  // not even offered (the server rejects it too).
  const EMPTY_FORM = { type: "announcement", audience: "customer", target: "all", title: "", content: "", userId: "" };
  const [form, setForm] = useState(EMPTY_FORM);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const TARGET_OPTIONS = {
    customer: [
      { value: "public", label: "Public main site" },
      { value: "all", label: "All customers" },
      { value: "specific_user", label: "A specific customer" },
    ],
    employee: [
      { value: "all", label: "All employees" },
      { value: "specific_user", label: "A specific employee" },
    ],
  };

  const load = () => {
    api("/admin/broadcasts").then((d) => setBroadcasts(d.broadcasts)).catch(() => {});
    api("/admin/users").then((d) => setCustomers(d.users)).catch(() => {});
    api("/admin/employees").then((d) => setEmployees(d.employees)).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Changing the audience resets the target to that audience's first valid option
  // and clears any previously chosen recipient, so a customer id can never be
  // submitted while the audience says "employee".
  const setAudience = (e) => {
    const audience = e.target.value;
    setForm({ ...form, audience, target: TARGET_OPTIONS[audience][0].value, userId: "" });
  };

  const publish = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api("/admin/broadcasts", { method: "POST", body: form });
      setMsg("Broadcast published.");
      setForm(EMPTY_FORM);
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

  // Labels are explicit about BOTH the audience and the target. A row is never
  // shown as a bare "All", because "all" means "all of this audience" only.
  const targetLabel = (b) => {
    if (b.target === "public") return { text: "Public site · All customers", cls: "bg-brand-light text-brand" };
    const employee = b.audience === "employee";
    if (b.target === "all") {
      return employee
        ? { text: "All employees", cls: "bg-clean-light text-clean" }
        : { text: "All customers", cls: "bg-clean-light text-clean" };
    }
    return {
      text: `${employee ? "Specific employee" : "Specific customer"}: ${b.user?.name || "—"}`,
      cls: "bg-warnbg text-amber-700",
    };
  };

  const isEmployee = form.audience === "employee";

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Notifications & Announcements"
      subtitle="Publish to the public site, to all customers, to all employees, or to one specific account.">
      {/* Publish form */}
      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><Megaphone size={18} /></span>
          <div>
            <h2 className="font-bold text-ink">Publish a broadcast</h2>
            <p className="text-xs text-muted">Pick the audience first, then who within it receives it.</p>
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
              <label className="label">Audience</label>
              <select className="input" value={form.audience} onChange={setAudience}>
                <option value="customer">Customers</option>
                <option value="employee">Employees</option>
              </select>
              <p className="mt-1 text-xs text-muted">
                {isEmployee
                  ? "Only employee accounts will receive this. Customers will not see it."
                  : "Only customer accounts will receive this. Employees will not see it."}
              </p>
            </div>
            <div>
              <label className="label">Who receives it</label>
              <select className="input" value={form.target} onChange={set("target")}>
                {TARGET_OPTIONS[form.audience].map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
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
                <label className="label">{isEmployee ? "Employee" : "Customer"}</label>
                <select className="input" required value={form.userId} onChange={set("userId")}>
                  <option value="">
                    — Select {isEmployee ? "employee" : "customer"} —
                  </option>
                  {isEmployee
                    ? employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.email}){emp.disabledAt ? " — disabled" : ""}
                        </option>
                      ))
                    : customers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                      ))}
                </select>
                {isEmployee ? (
                  <p className="mt-1 text-xs text-muted">
                    A disabled employee cannot sign in, so they will not receive this until an
                    admin reactivates their account.
                  </p>
                ) : null}
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
