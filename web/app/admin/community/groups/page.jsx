"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Star, RefreshCw, BadgePercent, Wrench, BookOpen,
  Store, UserRound, MessageCircle, UsersRound, Inbox, ArrowRight,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate } from "@/lib/api";
import {
  GROUPS_LIMIT_DEFAULT,
  groupsQuery,
  mergeAdminGroups,
  groupTypeLabel,
  adminGroupStatusLabel,
} from "@/lib/groups";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Customers", icon: Users },
  { href: "/admin/community", label: "Community", icon: MessageCircle },
  { href: "/admin/community/groups", label: "Groups", icon: UsersRound },
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
];

const toQuery = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p.toString();
};

export default function AdminGroupsListPage() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT }));
      const data = await api(`/admin/community/groups?${q}`);
      setItems(data.items || []);
      setPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
    } catch (err) {
      setLoadError(err.message || "Couldn't load groups. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadMore = async () => {
    if (paging || !page.nextCursor) return;
    setPaging(true);
    setPageError("");
    try {
      const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT, before: page.nextCursor }));
      const data = await api(`/admin/community/groups?${q}`);
      setItems((prev) => mergeAdminGroups(prev, data.items || []));
      setPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
    } catch (err) {
      setPageError(err.message || "Couldn't load more groups. Please try again.");
    } finally {
      setPaging(false);
    }
  };

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Community Groups"
      subtitle="Inspect and moderate every customer group — public, private, or by invitation only.">
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Every customer-created group is listed here, including private and
        invitation-only groups and groups that were dissolved. Opening a group
        lets you inspect its members and messages, remove a member, delete a
        message, or dissolve the group. Invite codes are never shown to admins.
      </p>

      {loading ? (
        <div className="empty-state">Loading groups…</div>
      ) : loadError ? (
        <div className="empty-state">
          <p className="font-semibold text-ink">Couldn't load groups.</p>
          <p className="text-sm">{loadError}</p>
          <button className="btn btn-outline mt-3" onClick={load}>
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Inbox size={36} className="mx-auto text-slate-300" />
          <p className="mt-3 font-semibold text-ink">No groups yet.</p>
          <p className="text-sm">Groups customers create will appear here.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line">
            {items.map((g) => (
              <li key={g.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/admin/community/groups/${encodeURIComponent(g.id)}`}
                      className="font-bold text-ink hover:underline"
                    >
                      {g.name}
                    </Link>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      {groupTypeLabel(g.type)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                      g.status === "dissolved"
                        ? "bg-warnbg text-amber-700 border-amber-200"
                        : "bg-okbg text-clean-dark border-green-200"
                    }`}>
                      {adminGroupStatusLabel(g.status)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <UserRound size={12} /> {g.owner?.name || "Unknown owner"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UsersRound size={12} /> {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                    </span>
                    <span>Created {fmtDate(g.createdAt)}</span>
                    {g.dissolvedAt && <span>Dissolved {fmtDate(g.dissolvedAt)}</span>}
                  </div>
                  {g.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{g.description}</p>}
                </div>
                <Link
                  href={`/admin/community/groups/${encodeURIComponent(g.id)}`}
                  className="btn btn-outline btn-sm lg:shrink-0"
                >
                  Open group <ArrowRight size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !loadError && items.length > 0 && page.hasMore && (
        <div className="mt-5 text-center">
          {pageError && <p className="form-error mb-1">{pageError}</p>}
          <button className="btn btn-outline" onClick={loadMore} disabled={paging}>
            <RefreshCw size={14} /> {paging ? "Loading…" : "Load more groups"}
          </button>
        </div>
      )}
    </Shell>
  );
}