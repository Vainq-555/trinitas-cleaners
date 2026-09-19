"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, BadgeDollarSign, ReceiptText,
  MessageSquare, Megaphone, Star, RefreshCw, BadgePercent, Wrench, BookOpen,
  Store, UserRound, MessageCircle, UsersRound, ArrowLeft, Trash2, Crown, Inbox,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate, fmtDateTime } from "@/lib/api";
import {
  GROUPS_LIMIT_DEFAULT,
  groupsQuery,
  chronologicalGroupMessages,
  groupTypeLabel,
  adminGroupStatusLabel,
  isDeletedMessage,
  messageDisplayText,
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

const moderationError = (e) => {
  if (e.status === 401 || e.status === 403) {
    return "Your session may have expired. Please refresh and try again.";
  }
  if (e.status === 404) {
    return "That group, member, or message could not be found.";
  }
  if (e.status === 429) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (e.status === 400) return e.message;
  return "Something went wrong. Please try again.";
};

export default function AdminGroupDetailPage({ params }) {
  const { groupId } = use(params);

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberPage, setMemberPage] = useState({ hasMore: false, nextCursor: null });
  const [messages, setMessages] = useState([]);
  const [messagePage, setMessagePage] = useState({ hasMore: false, nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [memberPaging, setMemberPaging] = useState(false);
  const [messagePaging, setMessagePaging] = useState(false);

  const loadGroup = async () => {
    const data = await api(`/admin/community/groups/${encodeURIComponent(groupId)}`);
    setGroup(data.group);
  };

  const loadRoster = async () => {
    const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT }));
    const data = await api(`/admin/community/groups/${encodeURIComponent(groupId)}/members?${q}`);
    setMembers(data.members || []);
    setMemberPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
  };

  const loadFeed = async () => {
    const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT }));
    const data = await api(`/admin/community/groups/${encodeURIComponent(groupId)}/messages?${q}`);
    setMessages(data.messages || []);
    setMessagePage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
  };

  const load = async () => {
    setLoading(true);
    setLoadError("");
    setErr("");
    setNotice("");
    try {
      await loadGroup();
      await Promise.all([loadRoster(), loadFeed()]);
    } catch (e) {
      if (e.status === 404) setLoadError("That group doesn't exist.");
      else setLoadError(e.message || "Couldn't load the group.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const loadMoreMembers = async () => {
    if (memberPaging || !memberPage.nextCursor) return;
    setMemberPaging(true);
    setErr("");
    try {
      const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT, before: memberPage.nextCursor }));
      const data = await api(`/admin/community/groups/${encodeURIComponent(groupId)}/members?${q}`);
      setMembers((prev) => [...prev, ...(data.members || [])]);
      setMemberPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setMemberPaging(false);
    }
  };

  const loadOlderMessages = async () => {
    if (messagePaging || !messagePage.nextCursor) return;
    setMessagePaging(true);
    setErr("");
    try {
      const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT, before: messagePage.nextCursor }));
      const data = await api(`/admin/community/groups/${encodeURIComponent(groupId)}/messages?${q}`);
      setMessages((prev) => [...prev, ...(data.messages || [])]);
      setMessagePage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setMessagePaging(false);
    }
  };

  const removeMember = async (member) => {
    setErr("");
    if (!confirm(
      `Remove ${member.user?.name || "this member"} from "${group.name}"?\n\nThe member can still join public groups. The owner cannot be removed this way.`
    )) return;
    setBusyId(`remove:${member.userId}`);
    try {
      await api(`/admin/community/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(member.userId)}`, {
        method: "DELETE",
      });
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      setGroup((prev) => (prev ? { ...prev, memberCount: Math.max(0, (prev.memberCount || 1) - 1) } : prev));
      setNotice(`${member.user?.name || "Member"} was removed from the group.`);
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setBusyId(null);
    }
  };

  const deleteMessage = async (message) => {
    setErr("");
    if (!confirm(
      `Delete the message by ${message.sender?.name || "a group member"}?\n\nThe message will be hidden from the group (soft delete).`
    )) return;
    setBusyId(`delete:${message.id}`);
    try {
      const result = await api(
        `/admin/community/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(message.id)}`,
        { method: "DELETE" },
      );
      setMessages((prev) => prev.map((m) => (m.id === result.message.id ? result.message : m)));
      setNotice("Message deleted. It's now hidden from the group.");
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setBusyId(null);
    }
  };

  const dissolveGroup = async () => {
    setErr("");
    if (!confirm(
      `Dissolve "${group.name}"?\n\nThe group will disappear for every member and can't be restored from the customer app. Members and messages are kept for admin review.`
    )) return;
    setBusyId("dissolve");
    try {
      await api(`/admin/community/groups/${encodeURIComponent(groupId)}/dissolve`, { method: "POST" });
      setNotice("Group dissolved. It's no longer visible to customers.");
      await loadGroup();
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setBusyId(null);
    }
  };

  const isDissolved = Boolean(group?.dissolvedAt);
  const shown = chronologicalGroupMessages(messages);

  return (
    <Shell links={links} sections={["Admin Portal"]}
      title={group ? group.name : "Group details"}
      subtitle="Inspect members and messages, and moderate this group.">
      <div className="mb-4">
        <Link href="/admin/community/groups" className="btn btn-outline btn-sm">
          <ArrowLeft size={14} /> Back to groups
        </Link>
      </div>

      {loading ? (
        <div className="empty-state">Loading group…</div>
      ) : loadError ? (
        <div className="empty-state">
          <p className="font-semibold text-ink">Couldn't load this group.</p>
          <p className="text-sm">{loadError}</p>
          <button className="btn btn-outline mt-3" onClick={load}>
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      ) : group ? (
        <>
          {err && <div className="form-error mb-6">{err}</div>}
          {notice && <div className="form-ok mb-6">{notice}</div>}

          {/* Group info */}
          <div className="card card-pad mb-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-xl font-extrabold tracking-tight text-ink">{group.name}</h2>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                    {groupTypeLabel(group.type)}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                    isDissolved ? "bg-warnbg text-amber-700 border-amber-200" : "bg-okbg text-clean-dark border-green-200"
                  }`}>
                    {adminGroupStatusLabel(group.status)}
                  </span>
                </div>
                {group.description && <p className="mt-2 text-sm text-muted">{group.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <UserRound size={13} /> Owner: {group.owner?.name || "Unknown owner"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UsersRound size={13} /> {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
                  </span>
                  <span>Created {fmtDate(group.createdAt)}</span>
                  {group.dissolvedAt && <span>Dissolved {fmtDate(group.dissolvedAt)}</span>}
                </div>
              </div>
              {!isDissolved && (
                <button className="btn btn-danger" onClick={dissolveGroup} disabled={busyId === "dissolve"}>
                  {busyId === "dissolve" ? "Dissolving…" : "Dissolve group"}
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            {/* Members */}
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h3 className="font-bold text-ink">Members</h3>
                <span className="text-xs font-semibold text-muted">{members.length} shown</span>
              </div>
              <div className="px-5 py-2">
                {members.length === 0 ? (
                  <p className="py-3 text-sm text-muted">No members yet.</p>
                ) : (
                  members.map((m) => {
                    const memberIsOwner = m.userId === group.owner?.id;
                    return (
                      <div key={m.userId} className="flex items-center gap-3 py-2.5">
                        {m.user?.avatarUrl ? (
                          <img src={m.user.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-clean-light text-clean">
                            <UserRound size={16} />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-ink">{m.user?.name || "Community member"}</span>
                            {memberIsOwner && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-clean-light px-2 py-0.5 text-[11px] font-semibold text-clean">
                                <Crown size={11} /> Owner
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted">Joined {fmtDate(m.joinedAt)}</div>
                        </div>
                        {!memberIsOwner && (
                          <button
                            className="btn btn-danger btn-sm ml-auto shrink-0"
                            title="Remove member"
                            disabled={busyId === `remove:${m.userId}`}
                            onClick={() => removeMember(m)}
                          >
                            <Trash2 size={13} /> {busyId === `remove:${m.userId}` ? "Removing…" : "Remove"}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
                {memberPage.hasMore && (
                  <div className="pt-2 pb-3 text-center">
                    <button className="btn btn-outline btn-sm" onClick={loadMoreMembers} disabled={memberPaging}>
                      {memberPaging ? "Loading…" : "Load more members"}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Messages */}
            <section className="card flex flex-col overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-clean-light text-clean">
                  <MessageCircle size={17} />
                </span>
                <div>
                  <div className="font-bold text-ink">Group messages</div>
                  <div className="text-xs text-muted">Newest first · deleted messages stay visible to admins</div>
                </div>
              </div>
              <div className="flex-1 space-y-3 bg-slate-50/60 p-5">
                {messagePage.hasMore && (
                  <div className="text-center">
                    <button className="btn btn-outline btn-sm" onClick={loadOlderMessages} disabled={messagePaging}>
                      <RefreshCw size={14} /> {messagePaging ? "Loading…" : "Load older messages"}
                    </button>
                  </div>
                )}
                {shown.length === 0 ? (
                  <div className="empty-state">
                    <Inbox size={36} className="mx-auto text-slate-300" />
                    <p className="mt-3 font-semibold text-ink">No messages yet.</p>
                    <p className="text-sm">Messages members send will appear here.</p>
                  </div>
                ) : (
                  shown.map((m) => {
                    const deleted = isDeletedMessage(m);
                    return (
                      <div key={m.id} className="rounded-xl border border-line bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                            <span className="font-semibold text-ink">{m.sender?.name || "Group member"}</span>
                            <span>{m.sender?.id}</span>
                            <span>· {fmtDateTime(m.createdAt)}</span>
                            {deleted && (
                              <span className="rounded-full bg-warnbg px-2 py-0.5 font-semibold text-amber-700">
                                Deleted {m.deletedAt ? fmtDateTime(m.deletedAt) : ""}
                              </span>
                            )}
                          </div>
                          {!deleted && (
                            <button
                              className="btn btn-danger btn-sm"
                              title="Delete message"
                              disabled={busyId === `delete:${m.id}`}
                              onClick={() => deleteMessage(m)}
                            >
                              <Trash2 size={13} /> {busyId === `delete:${m.id}` ? "Deleting…" : "Delete"}
                            </button>
                          )}
                        </div>
                        <p className={`mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700 ${deleted ? "italic text-muted" : ""}`}>
                          {messageDisplayText(m)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </Shell>
  );
}