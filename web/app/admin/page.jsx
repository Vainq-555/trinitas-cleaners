"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Clock3, Wifi, UserRound, Hammer, ArrowRight,
} from "lucide-react";
import Shell from "@/components/Shell";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import { api, fmtDateTime, money } from "@/lib/api";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/admin/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare },
  { href: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
];

export default function AdminHome() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [bookings, setBookings] = useState([]);

  const load = () => {
    api("/admin/stats").then(setStats).catch(() => {});
    api("/admin/users").then((d) => setUsers(d.users)).catch(() => {});
    api("/admin/bookings").then((d) => setBookings(d.bookings.slice(0, 6))).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live refresh
    return () => clearInterval(t);
  }, []);

  const online = users.filter((u) => u.status === "online");

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Dashboard"
      subtitle="Live overview of customers, bookings, and revenue.">
      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Clock3} label="Pending bookings" value={stats?.pending ?? "…"} accent="text-amber-600" bg="bg-warnbg" />
        <StatCard icon={Wifi} label="Online now" value={stats?.online ?? "…"} accent="text-clean" bg="bg-clean-light" />
        <StatCard icon={UserRound} label="Total customers" value={stats?.totalCustomers ?? "…"} accent="text-brand" bg="bg-brand-light" />
        <StatCard icon={Hammer} label="Jobs completed" value={stats?.worked ?? "…"} accent="text-sky-600" bg="bg-sky-100" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Who's online */}
        <div className="card card-pad">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-clean-light text-clean"><Wifi size={16} /></span>
              <h2 className="font-bold text-ink">Who's online</h2>
            </div>
            <Link href="/admin/users" className="btn btn-ghost btn-sm">All customers <ArrowRight size={14} /></Link>
          </div>
          {online.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No customers currently online.</p>
          ) : (
            <div className="mt-4 divide-y divide-line">
              {online.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-semibold text-ink">{u.name}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-clean-dark border border-green-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-clean animate-pulse" /> Online
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Latest bookings */}
        <div className="card card-pad">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-light text-brand"><CalendarCheck size={16} /></span>
              <h2 className="font-bold text-ink">Latest bookings</h2>
            </div>
            <Link href="/admin/bookings" className="btn btn-ghost btn-sm">Manage <ArrowRight size={14} /></Link>
          </div>
          {bookings.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No bookings yet.</p>
          ) : (
            <div className="mt-4 divide-y divide-line">
              {bookings.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">{b.customer.name}</div>
                    <div className="text-xs text-muted truncate">{b.service.name}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <StatusBadge status={b.status} />
                    <div className="mt-1 text-xs text-muted">{money(b.price)} · {fmtDateTime(b.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}