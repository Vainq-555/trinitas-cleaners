"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Star, Save, UserRound, BadgePercent, CalendarClock, Globe, X, Wrench, BookOpen, Store,
MessageCircle,
  UsersRound,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";
import { centsToDollars, customerMonthlyBody, customerMonthlyClearBody, globalMonthlyBody } from "@/lib/pricing";

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

export default function PricingPage() {
  const searchParams = useSearchParams();
  const preselect = searchParams.get("customer");
  const [services, setServices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState(preselect || "");
  const [globalDrafts, setGlobalDrafts] = useState({});
  const [customerDrafts, setCustomerDrafts] = useState({});
  const [monthlyGlobalDrafts, setMonthlyGlobalDrafts] = useState({});
  const [monthlyActiveDrafts, setMonthlyActiveDrafts] = useState({});
  const [customerMonthlyDrafts, setCustomerMonthlyDrafts] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const d = await api("/services").catch(() => ({ services: [] }));
    setServices(d.services);
    setGlobalDrafts(Object.fromEntries(d.services.map((s) => [s.id, s.basePrice])));
    setMonthlyGlobalDrafts(Object.fromEntries(d.services.map((s) => [s.id, centsToDollars(s.monthlyPriceCents)])));
    setMonthlyActiveDrafts(Object.fromEntries(d.services.map((s) => [s.id, Boolean(s.monthlyActive)])));
    const c = await api("/admin/users").catch(() => ({ users: [] }));
    setCustomers(c.users);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!customerId) {
      setCustomerDrafts({});
      setCustomerMonthlyDrafts({});
      return;
    }
    api(`/admin/users/${customerId}`)
      .then((d) => setCustomerDrafts(Object.fromEntries(d.serviceCatalog.map((s) => [s.id, s.price ?? ""]))))
      .catch(() => {});
  }, [customerId]);

  const saveGlobal = async (id) => {
    const basePrice = Number(globalDrafts[id]);
    if (Number.isNaN(basePrice) || basePrice < 0) return alert("Enter a valid price");
    await api(`/admin/services/${id}/price/global`, { method: "PUT", body: { basePrice } });
    setMsg("Global price updated for all customers.");
    load();
  };

  const saveCustomer = async (id) => {
    if (!customerId) return alert("Select a customer first");
    const price = Number(customerDrafts[id]);
    if (Number.isNaN(price) || price < 0) return alert("Enter a valid price");
    await api(`/admin/services/${id}/price/customer`, { method: "PUT", body: { customerId, price } });
    setMsg("Price updated for this customer only.");
    load();
  };

  const clearCustomer = async (id) => {
    if (!customerId) return;
    await api(`/admin/services/${id}/price/customer`, { method: "DELETE", body: { customerId } });
    setMsg("Override removed — customer now pays base price.");
    load();
  };

  const saveMonthlyGlobal = async (id) => {
    const active = Boolean(monthlyActiveDrafts[id]);
    const body = globalMonthlyBody(monthlyGlobalDrafts[id], active);
    if (!body) return alert(active ? "Enter a valid monthly price." : "Enter a valid price.");
    setBusy(true);
    try {
      await api(`/admin/services/${id}/price/global`, { method: "PUT", body });
      setMsg("Monthly pricing updated for all customers.");
      load();
    } finally {
      setBusy(false);
    }
  };

  const saveCustomerMonthly = async (id) => {
    const body = customerMonthlyBody(customerId, customerMonthlyDrafts[id]);
    if (!body) return alert("Enter a valid monthly price.");
    setBusy(true);
    try {
      await api(`/admin/services/${id}/price/customer`, { method: "PUT", body });
      setMsg("Monthly price updated for this customer only.");
      load();
    } finally {
      setBusy(false);
    }
  };

  const clearCustomerMonthly = async (id) => {
    const body = customerMonthlyClearBody(customerId);
    if (!body) return;
    setBusy(true);
    try {
      await api(`/admin/services/${id}/price/customer`, { method: "PUT", body });
      setMsg("Monthly override cleared — customer now pays the global monthly price.");
      load();
    } finally {
      setBusy(false);
    }
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const monthlyOn = (s) =>
    Boolean(s.monthlyActive) && Number.isInteger(s.monthlyPriceCents) && s.monthlyPriceCents >= 0;

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Pricing Control"
      subtitle="Change prices globally for everyone, or individually for one customer.">
      {msg && <div className="form-ok">{msg}</div>}

      {/* Customer selector */}
      <div className="card card-pad mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[260px]">
            <label className="label">Apply a customer-specific price</label>
            <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Select a customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </select>
          </div>
          {selectedCustomer && (
            <div className="rounded-lg bg-brand-light px-4 py-2.5 text-sm text-brand-dark flex items-center gap-2">
              <UserRound size={15} />
              Editing prices for <strong>{selectedCustomer.name}</strong>
            </div>
          )}
        </div>
        {customerId && (
          <p className="mt-3 text-xs text-muted">
            Edits in the "Per-customer" column apply <strong>only</strong> to the selected customer.
            The global price stays unchanged for everyone else.
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Service</th>
                <th><Globe size={12} className="inline -mt-0.5 mr-1" />Global base price</th>
                <th><UserRound size={12} className="inline -mt-0.5 mr-1" />Per-customer price</th>
                <th><CalendarClock size={12} className="inline -mt-0.5 mr-1" />Global monthly</th>
                <th><UserRound size={12} className="inline -mt-0.5 mr-1" />Customer monthly override</th>
                <th className="text-right">Override</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => {
                const gv = globalDrafts[s.id];
                const cv = customerDrafts[s.id];
                const hasOverride = cv !== undefined && cv !== "" && Number(cv) !== s.basePrice;
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="font-semibold text-ink">{s.name}</div>
                      <div className="text-xs text-muted">{s.description}</div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">$</span>
                        <input className="input !w-24 !px-2 !py-1.5 text-sm" type="number" step="0.01" min="0"
                          value={gv} onChange={(e) => setGlobalDrafts({ ...globalDrafts, [s.id]: e.target.value })} />
                        <button className="btn btn-outline btn-sm" onClick={() => saveGlobal(s.id)}>
                          <Save size={13} /> Save
                        </button>
                      </div>
                    </td>
                    <td>
                      {customerId ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">$</span>
                          <input className="input !w-24 !px-2 !py-1.5 text-sm" type="number" step="0.01" min="0"
                            placeholder={String(s.basePrice)} value={cv === undefined ? "" : cv}
                            onChange={(e) => setCustomerDrafts({ ...customerDrafts, [s.id]: e.target.value })} />
                          <button className="btn btn-primary btn-sm" onClick={() => saveCustomer(s.id)}>Set</button>
                          {hasOverride && (
                            <button className="btn btn-ghost btn-sm" onClick={() => clearCustomer(s.id)} title="Remove override">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">Select a customer above</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">$</span>
                        <input className="input !w-24 !px-2 !py-1.5 text-sm" type="number" step="0.01" min="0"
                          placeholder={centsToDollars(s.monthlyPriceCents) || "0.00"}
                          value={monthlyGlobalDrafts[s.id] ?? ""}
                          onChange={(e) => setMonthlyGlobalDrafts({ ...monthlyGlobalDrafts, [s.id]: e.target.value })} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                          <input type="checkbox" checked={Boolean(monthlyActiveDrafts[s.id])}
                            onChange={(e) => setMonthlyActiveDrafts({ ...monthlyActiveDrafts, [s.id]: e.target.checked })} />
                          Monthly Active
                        </label>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => saveMonthlyGlobal(s.id)}>
                          <Save size={13} /> Save Monthly
                        </button>
                      </div>
                      {monthlyOn(s) ? (
                        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-clean-dark border border-green-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-clean" /> Monthly booking on
                        </span>
                      ) : (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Monthly booking off
                        </span>
                      )}
                    </td>
                    <td>
                      {customerId ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">$</span>
                          <input className="input !w-24 !px-2 !py-1.5 text-sm" type="number" step="0.01" min="0"
                            placeholder="0.00" value={customerMonthlyDrafts[s.id] ?? ""}
                            onChange={(e) => setCustomerMonthlyDrafts({ ...customerMonthlyDrafts, [s.id]: e.target.value })} />
                          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveCustomerMonthly(s.id)}>
                            Set
                          </button>
                          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => clearCustomerMonthly(s.id)} title="Clear monthly override">
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">Select a customer above</span>
                      )}
                    </td>
                    <td className="text-right">
                      {hasOverride && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warnbg px-2.5 py-1 text-[11px] font-bold uppercase text-amber-700">
                          <BadgePercent size={12} /> Override
                        </span>
                      )}
                      {!hasOverride && customerId && <span className="text-xs text-muted">Base rate</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted">
        Global price changes affect the public site and all customer accounts immediately.
        Per-customer overrides affect only the selected account.
        "Global monthly" sets the monthly subscription price (billed every month) and whether
        monthly booking is offered. "Customer monthly override" sets a
        per-customer monthly price; clearing it keeps the one-time override.
      </p>
    </Shell>
  );
}
