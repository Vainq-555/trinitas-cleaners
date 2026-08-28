"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Send, Download, Calculator, PlusCircle, BadgePercent,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate, money } from "@/lib/api";

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

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customerId: "", bookingId: "", subtotal: "", discount: "0", note: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/admin/receipts").then((d) => setReceipts(d.receipts)).catch(() => {});
    api("/admin/users").then((d) => setCustomers(d.users)).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const body = {
        customerId: form.customerId,
        bookingId: form.bookingId || null,
        subtotal: Number(form.subtotal),
        discount: Number(form.discount) || 0,
        note: form.note,
      };
      await api("/admin/receipts", { method: "POST", body });
      setMsg("Receipt issued and notification sent to the customer.");
      setForm({ customerId: "", bookingId: "", subtotal: "", discount: "0", note: "" });
      load();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  const subtotal = Number(form.subtotal || 0);
  const tax = subtotal * 0.0725;
  const discount = Number(form.discount) || 0;
  const total = subtotal + tax - discount;

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Receipts"
      subtitle="Issue itemized receipts with tax & discounts; send to the customer instantly.">
      {/* Generate form */}
      <div className="card card-pad mb-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-light text-brand"><PlusCircle size={18} /></span>
          <div>
            <h2 className="font-bold text-ink">Create &amp; send a receipt</h2>
            <p className="text-xs text-muted">The customer gets a notification the moment it's issued.</p>
          </div>
        </div>
        {err && <div className="form-error mt-4">{err}</div>}
        {msg && <div className="form-ok mt-4">{msg}</div>}
        <form onSubmit={create} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Customer</label>
              <select className="input" required value={form.customerId} onChange={set("customerId")}>
                <option value="">— Select customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Linked booking ID (optional)</label>
              <input className="input" value={form.bookingId} onChange={set("bookingId")}
                placeholder="Leave blank for a custom charge" />
            </div>
            <div>
              <label className="label">Subtotal ($)</label>
              <input className="input" type="number" step="0.01" min="0" required value={form.subtotal}
                onChange={set("subtotal")} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Discount ($)</label>
              <input className="input" type="number" step="0.01" min="0" value={form.discount}
                onChange={set("discount")} placeholder="0.00" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Note (optional)</label>
              <input className="input" value={form.note} onChange={set("note")}
                placeholder="e.g. Spring cleaning special" />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button className="btn btn-primary" disabled={busy}>
              <Send size={16} /> {busy ? "Creating…" : "Issue receipt"}
            </button>
            {form.subtotal && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-line px-4 py-2 text-sm">
                <Calculator size={15} className="text-muted" />
                <span className="text-muted">
                  {money(subtotal)} + tax {money(tax)}
                  {discount > 0 && <> − {money(discount)}</>} ={" "}
                  <span className="font-extrabold text-brand">{money(total)}</span>
                </span>
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Receipt list */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt #</th><th>Customer</th><th>Service</th><th>Subtotal</th><th>Tax</th><th>Discount</th><th>Total</th><th>Date</th><th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr>
                  <td colSpan="9">
                    <div className="empty-state">
                      <ReceiptText size={36} className="mx-auto text-slate-300" />
                      <p className="mt-3 font-semibold text-ink">No receipts issued yet.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="font-bold text-brand">#{r.id.slice(0, 8).toUpperCase()}</td>
                    <td className="font-semibold">{r.customer.name}</td>
                    <td className="text-xs text-muted">{r.booking?.service?.name || "Custom charge"}</td>
                    <td>{money(r.subtotal)}</td>
                    <td className="text-muted">{money(r.tax)}</td>
                    <td>{r.discount ? <span className="text-clean">{money(r.discount)}</span> : "—"}</td>
                    <td className="font-extrabold text-brand">{money(r.total)}</td>
                    <td className="text-xs text-muted">{fmtDate(r.createdAt)}</td>
                    <td className="text-right">
                      <a href={`/api/admin/receipts/${r.id}/pdf`} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                        <Download size={14} /> PDF
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}