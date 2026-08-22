"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, UserRound, ArrowLeft, BadgePercent,
} from "lucide-react";
import Shell from "@/components/Shell";
import StatusBadge from "@/components/StatusBadge";
import { api, fmtDate, fmtDateTime, money } from "@/lib/api";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
];

export default function InspectUserPage({ params }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/admin/users/${params.id}`).then(setData).catch(() => setData({ notFound: true }));
  }, [params.id]);

  if (!data) {
    return (
      <Shell links={links} sections={["Admin Portal"]} title="Customer account">
        <div className="empty-state">Loading customer data…</div>
      </Shell>
    );
  }

  if (data.notFound) {
    return (
      <Shell links={links} sections={["Admin Portal"]} title="Customer account">
        <div className="empty-state"><p className="font-semibold text-ink">Customer not found.</p></div>
      </Shell>
    );
  }

  const { user, serviceCatalog, bookings, receipts, messages } = data;

  return (
    <Shell links={links} sections={["Admin Portal"]} title={`Account — ${user.name}`}
      subtitle="Impersonation view: everything this customer sees from their dashboard.">
      <Link href="/admin/users" className="btn btn-ghost btn-sm mb-4">
        <ArrowLeft size={15} /> Back to customers
      </Link>

      {/* Customer header card */}
      <div className="card card-pad">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand text-white">
            <UserRound size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-ink">{user.name}</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                user.status === "online" ? "bg-okbg text-clean-dark" : "bg-slate-100 text-slate-500"
              }`}>
                {user.status}
              </span>
            </div>
            <p className="text-sm text-muted">{user.email} · {user.phone || "no phone"} · {user.address || "no address"}</p>
          </div>
          <div className="text-right text-xs text-muted">
            Last active<br />
            <span className="font-semibold text-ink">{user.lastActiveAt ? fmtDateTime(user.lastActiveAt) : "never"}</span>
          </div>
        </div>
      </div>

      {/* Personalized pricing */}
      <div className="card card-pad mt-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-light text-brand"><BadgePercent size={16} /></span>
            <h2 className="font-bold text-ink">Service catalog &amp; personalized prices</h2>
          </div>
          <Link href={`/admin/pricing?customer=${user.id}`} className="btn btn-outline btn-sm">Adjust pricing</Link>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Service</th><th>Base price</th><th>This customer pays</th><th>Description</th></tr>
            </thead>
            <tbody>
              {serviceCatalog.map((s) => (
                <tr key={s.id}>
                  <td className="font-semibold">{s.name}</td>
                  <td className="text-muted">{money(s.basePrice)}</td>
                  <td>
                    <span className="font-bold text-brand">{money(s.price)}</span>{" "}
                    {s.personalized && <span className="rounded-full bg-warnbg px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">override</span>}
                  </td>
                  <td className="text-xs text-muted">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Bookings */}
        <div className="card card-pad">
          <h2 className="font-bold text-ink">Bookings</h2>
          {bookings.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No bookings.</p>
          ) : (
            <div className="mt-3 divide-y divide-line">
              {bookings.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">{b.service.name}</div>
                    <div className="text-xs text-muted">{fmtDate(b.date)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <StatusBadge status={b.status} />
                    <div className="mt-1 text-xs font-semibold">{money(b.price)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Receipts */}
        <div className="card card-pad">
          <h2 className="font-bold text-ink">Receipts</h2>
          {receipts.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No receipts issued.</p>
          ) : (
            <div className="mt-3 divide-y divide-line">
              {receipts.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">#{r.id.slice(0, 8).toUpperCase()}</div>
                    <div className="text-xs text-muted">{fmtDate(r.createdAt)} · {r.booking?.service?.name || "Custom"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-semibold">{money(r.total)}</span>
                    <div className="mt-1">
                      <a href={`/api/admin/receipts/${r.id}/pdf`} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                        <ReceiptText size={13} /> PDF
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="card card-pad mt-6">
        <h2 className="font-bold text-ink">Conversation</h2>
        {messages.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No messages yet.</p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {messages.map((m) => (
              <div key={m.id} className={`rounded-2xl border px-4 py-2.5 text-sm ${
                m.sender.role === "admin" ? "bg-brand-light border-brand-soft text-brand-dark" : "bg-slate-50 border-line text-ink"
              }`}>
                <span className="font-semibold">{m.sender.name}:</span> {m.content}
                <div className="mt-0.5 text-[11px] opacity-70">{fmtDateTime(m.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}