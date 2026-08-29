"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Eye, Wifi, UserRound, BadgePercent, Wrench,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDateTime } from "@/lib/api";

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

const StatusPill = ({ status }) =>
  status === "online" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-okbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-clean-dark border border-green-200">
      <span className="h-1.5 w-1.5 rounded-full bg-clean animate-pulse" /> Online
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 border border-line">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Offline
    </span>
  );

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("all");

  const load = () => api("/admin/users").then((d) => setUsers(d.users)).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live monitoring
    return () => clearInterval(t);
  }, []);

  const shown = filter === "all" ? users : users.filter((u) => u.status === filter);
  const onlineCount = users.filter((u) => u.status === "online").length;

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Customer Monitoring"
      subtitle="Click any customer to inspect their full account — no password needed.">
      <div className="flex flex-wrap gap-2 mb-6">
        <button className={`tab-btn ${filter === "all" ? "tab-btn-active" : ""}`} onClick={() => setFilter("all")}>
          All <span className="ml-1 opacity-70">({users.length})</span>
        </button>
        <button className={`tab-btn ${filter === "online" ? "tab-btn-active" : ""}`} onClick={() => setFilter("online")}>
          <Wifi size={13} className="inline -mt-0.5 mr-1" />Online ({onlineCount})
        </button>
        <button className={`tab-btn ${filter === "offline" ? "tab-btn-active" : ""}`} onClick={() => setFilter("offline")}>
          Offline ({users.length - onlineCount})
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th><th>Customer</th><th>Contact</th><th>Bookings</th><th>Receipts</th><th>Last active</th><th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td><StatusPill status={u.status} /></td>
                  <td className="font-semibold">{u.name}</td>
                  <td className="text-xs text-muted">
                    {u.email}
                    <br />{u.phone || "—"}
                  </td>
                  <td>{u._count.bookings}</td>
                  <td>{u._count.receipts}</td>
                  <td className="text-xs text-muted">{u.lastActiveAt ? fmtDateTime(u.lastActiveAt) : "never"}</td>
                  <td className="text-right">
                    <Link href={`/admin/users/${u.id}`} className="btn btn-primary btn-sm">
                      <Eye size={14} /> View account
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
