"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Star, Ban, UserCheck, MessageCircle, Inbox,
  RefreshCw, BadgePercent, Wrench, BookOpen, Store, Eye, EyeOff, UserRound,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDateTime } from "@/lib/api";
import { feedQuery, chronological } from "@/lib/community";

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
];

const toQuery = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p.toString();
};

export default function AdminCommunityPage() {
  // `messages` stays newest-first (server order); rendered reversed below.
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextBefore: null });
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [paging, setPaging] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [profileBusyId, setProfileBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");

  const scrollRef = useRef(null);
  const pollingRef = useRef(false);
  const [loadAnchor, setLoadAnchor] = useState(null);

  // Community blocking is ONLY communityBlockedAt: the customer may still log
  // in, read the community, and use every other feature of their account.
  const blockedAtOf = (customerId) => users.find((u) => u.id === customerId)?.communityBlockedAt ?? null;

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const q = toQuery(feedQuery({ limit: 100 }));
      const [feed, statuses, profileRows] = await Promise.all([
        api(`/admin/community/messages?${q}`),
        api("/admin/community/users"),
        api("/admin/community/profiles"),
      ]);
      setMessages(feed.messages || []);
      setPage({ hasMore: feed.hasMore, nextBefore: feed.nextBefore });
      setUsers(statuses.users || []);
      setProfiles(profileRows.profiles || []);
    } catch (e) {
      setLoadError(e.message || "Couldn't load the community. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Poll: newest 50 every 10s, merged in place. Never resets the conversation
  // and never touches pagination state.
  const refreshNewest = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const q = toQuery(feedQuery({ limit: 50 }));
      const feed = await api(`/admin/community/messages?${q}`);
      setMessages((prev) => mergeMessages(prev, feed.messages));
    } catch {
      // Silent poll failures: the next tick recovers.
    } finally {
      pollingRef.current = false;
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(refreshNewest, 10000);
    return () => clearInterval(t);
  }, []);

  // Keep the admin's place when an older page is prepended.
  useEffect(() => {
    if (loadAnchor && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = loadAnchor.scrollTop + (el.scrollHeight - loadAnchor.scrollHeight);
      setLoadAnchor(null);
    }
  }, [loadAnchor, messages]);

  const loadOlder = async () => {
    if (paging || !page.nextBefore) return;
    setPaging(true);
    const el = scrollRef.current;
    setLoadAnchor(el ? { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop } : null);
    try {
      const q = toQuery(feedQuery({ limit: 50, before: page.nextBefore }));
      const feed = await api(`/admin/community/messages?${q}`);
      setMessages((prev) => mergeMessages(prev, feed.messages));
      setPage({ hasMore: feed.hasMore, nextBefore: feed.nextBefore });
    } catch (e) {
      setErr(e.message || "Couldn't load older messages. Please try again.");
    } finally {
      setPaging(false);
    }
  };

  const moderationError = (e) => {
    if (e.status === 401 || e.status === 403) {
      return "Your session may have expired. Please refresh and try again.";
    }
    if (e.status === 404) return "That customer could not be found.";
    if (e.status === 429) return "Too many requests. Please wait a moment and try again.";
    if (e.status === 400) return e.message;
    return "Something went wrong. Please try again.";
  };

  const block = async (customer) => {
    setErr("");
    if (!confirm(
      `Block ${customer.name} from posting to the community?\n\nThey can still log in, read the community, and message you. This does not delete their account, cancel bookings, or affect payments or reviews.`
    )) return;
    setBusyId(customer.id);
    try {
      const result = await api(`/admin/community/users/${customer.id}/block`, { method: "POST" });
      applyStatus(result.user);
      setNotice(`${customer.name} is blocked from posting to the community.`);
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setBusyId(null);
    }
  };

  const unblock = async (customer) => {
    setErr("");
    if (!confirm(`Allow ${customer.name} to post to the community again?`)) return;
    setBusyId(customer.id);
    try {
      const result = await api(`/admin/community/users/${customer.id}/unblock`, { method: "POST" });
      applyStatus(result.user);
      setNotice(`${customer.name} can post to the community again.`);
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setBusyId(null);
    }
  };

  // Apply the authoritative moderation result returned by the API without
  // reloading the whole app. The customer stays visible in the feed.
  const applyStatus = (user) => {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, communityBlockedAt: user.communityBlockedAt } : u)));
  };

  // Profile moderation hides/unhides the public profile only. Admin NEVER
  // edits profile content and never impersonates the customer.
  const hideProfile = async (profile) => {
    setErr("");
    if (!confirm(
      `Hide ${profile.displayName.trim() || "this customer"}'s community profile from other customers?\n\nThis only hides their public profile. It does not delete their account, block posting, or affect bookings, payments, or your private messages. Their profile content is never changed.`
    )) return;
    setProfileBusyId(profile.userId);
    try {
      const result = await api(`/admin/community/profiles/${profile.userId}/hide`, { method: "POST" });
      applyProfile(result.profile);
      setNotice(`${profile.displayName.trim() || "This customer"}'s profile is hidden from other customers.`);
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setProfileBusyId(null);
    }
  };

  const unhideProfile = async (profile) => {
    setErr("");
    if (!confirm(`Show ${profile.displayName.trim() || "this customer"}'s community profile to other customers again?`)) return;
    setProfileBusyId(profile.userId);
    try {
      const result = await api(`/admin/community/profiles/${profile.userId}/unhide`, { method: "POST" });
      applyProfile(result.profile);
      setNotice(`${profile.displayName.trim() || "This customer"}'s profile is visible again.`);
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setProfileBusyId(null);
    }
  };

  const applyProfile = (profile) => {
    setProfiles((prev) => prev.map((p) => (p.userId === profile.userId ? profile : p)));
  };

  const shown = chronological(messages);

  return (
    <Shell links={links} sections={["Admin Portal"]} title="Community"
      subtitle="Monitor the shared customer community and block or unblock posting access.">
      {err && <div className="form-error mb-6">{err}</div>}
      {notice && <div className="form-ok mb-6">{notice}</div>}

      <p className="mb-4 max-w-2xl text-sm text-muted">
        This is the single shared community where customers talk with each
        other. Blocking only stops a customer from <em>posting</em>; it never
        deletes their account or affects bookings, payments, reviews, or your
        private messages with them. For one-on-one conversations, open the{" "}
        <Link href="/admin/messages" className="font-semibold text-brand underline">Message Admin</Link>{" "}
        area.
      </p>

      <div className="card overflow-hidden flex flex-col" style={{ height: "calc(100vh - 280px)", minHeight: 420 }}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-clean-light text-clean">
            <MessageCircle size={18} />
          </span>
          <div>
            <div className="font-bold text-ink">Customer Community</div>
            <div className="text-xs text-muted">Newest messages first · refreshes automatically</div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-50/60 p-5 space-y-3">
          {loading ? (
            <div className="empty-state">Loading community…</div>
          ) : loadError ? (
            <div className="empty-state">
              <p className="font-semibold text-ink">Couldn't load the community.</p>
              <p className="text-sm">{loadError}</p>
              <button className="btn btn-outline mt-3" onClick={load}>
                <RefreshCw size={15} /> Retry
              </button>
            </div>
          ) : (
            <>
              {page.hasMore && (
                <div className="text-center">
                  <button className="btn btn-outline btn-sm" onClick={loadOlder} disabled={paging}>
                    <RefreshCw size={14} /> {paging ? "Loading…" : "Load older messages"}
                  </button>
                </div>
              )}

              {shown.length === 0 ? (
                <div className="empty-state">
                  <Inbox size={36} className="mx-auto text-slate-300" />
                  <p className="mt-3 font-semibold text-ink">No community messages yet.</p>
                  <p className="text-sm">Messages customers post will appear here.</p>
                </div>
              ) : (
                shown.map((m) => {
                  const customerId = m.customer?.id;
                  const isBlocked = Boolean(customerId && blockedAtOf(customerId));
                  return (
                    <div key={m.id} className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 lg:flex-row lg:items-start">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-bold text-ink">{m.customer?.name || "Community member"}</span>
                          {customerId && <span className="text-[11px] text-muted">{customerId}</span>}
                          <span className="text-[11px] text-muted">· {fmtDateTime(m.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700">{m.content}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                        {customerId ? (
                          <>
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide border ${
                              isBlocked ? "bg-warnbg text-amber-700 border-amber-200" : "bg-okbg text-clean-dark border-green-200"
                            }`}>
                              {isBlocked ? "Blocked from posting" : "Allowed to post"}
                            </span>
                            {isBlocked ? (
                              <button className="btn btn-outline btn-sm" disabled={busyId === customerId} onClick={() => unblock({ id: customerId, name: m.customer?.name || "this customer" })}>
                                <UserCheck size={13} /> {busyId === customerId ? "Unblocking…" : "Unblock"}
                              </button>
                            ) : (
                              <button className="btn btn-danger btn-sm" disabled={busyId === customerId} onClick={() => block({ id: customerId, name: m.customer?.name || "this customer" })}>
                                <Ban size={13} /> {busyId === customerId ? "Blocking…" : "Block posting"}
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted">author unavailable</span>
                        )}
                        <Link href="/admin/messages" className="btn btn-ghost btn-sm" aria-label="Go to the Message Admin page">
                          <MessageSquare size={13} /> Message Customer
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>

      <div className="card mt-6 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-clean-light text-clean">
            <UserRound size={18} />
          </span>
          <div>
            <div className="font-bold text-ink">Community Profiles</div>
            <div className="text-xs text-muted">Hide or show a customer's public profile</div>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading profiles…</div>
        ) : profiles.length === 0 ? (
          <div className="empty-state">
            <p className="font-semibold text-ink">No profiles yet.</p>
            <p className="text-sm">Customers get a profile the first time they open it.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {profiles.map((p) => {
              const isHidden = Boolean(p.moderationHiddenAt);
              const location = [p.locationCity, p.locationState].filter(Boolean).join(", ");
              return (
                <li key={p.userId} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-ink">{p.displayName || "Community member"}</span>
                      <span className="text-[11px] text-muted">{p.userId}</span>
                      {p.online !== undefined && (
                        <span className={`text-[11px] font-semibold ${p.online ? "text-emerald-600" : "text-muted"}`}>
                          {p.online ? "Online" : "Offline"}
                        </span>
                      )}
                    </div>
                    {location && <p className="mt-0.5 text-xs text-muted">{location}</p>}
                    {p.bio && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.bio}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide border ${
                      isHidden ? "bg-warnbg text-amber-700 border-amber-200" : "bg-okbg text-clean-dark border-green-200"
                    }`}>
                      {isHidden ? "Hidden" : "Visible"}
                    </span>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={profileBusyId === p.userId}
                      onClick={() => (isHidden ? unhideProfile(p) : hideProfile(p))}
                    >
                      {isHidden ? <Eye size={13} /> : <EyeOff size={13} />}
                      {profileBusyId === p.userId
                        ? "Working…"
                        : isHidden
                          ? "Show profile"
                          : "Hide profile"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Shell>
  );
}

function mergeMessages(existing, incoming) {
  const byId = new Map();
  for (const m of [...existing, ...incoming]) {
    if (m && typeof m.id === "string") byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}