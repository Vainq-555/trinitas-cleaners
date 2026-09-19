"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings, Star,
  Users, Send, RefreshCw, ArrowLeft, Pencil, Trash2, Crown, ArrowRightLeft,
  Check, MessageCircle, UserRound,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDate, fmtDateTime } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  GROUPS_LIMIT_DEFAULT,
  GROUP_NAME_MAX,
  GROUP_DESCRIPTION_MAX,
  groupsQuery,
  appendOlderGroupMembers,
  mergeGroupMessages,
  appendOlderGroupMessages,
  chronologicalGroupMessages,
  validateGroupName,
  validateGroupDescription,
  validateGroupMessage,
  validateInviteCode,
  ownerControls,
  isNonPublicGroup,
  requiresInvite,
  groupTypeLabel,
  memberName,
  memberAvatarUrl,
  isOnlineMember,
  messageDisplayText,
  isDeletedMessage,
  applyMembership,
  isBlockedError,
  isRateLimitError,
  groupErrorText,
} from "@/lib/groups";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/reviews", label: "My Reviews", icon: Star },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/community", label: "Community", icon: MessageCircle },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const toQuery = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p.toString();
};

export default function GroupDetailPage({ params }) {
  const { groupId } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);

  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextCursor: null });
  const [paging, setPaging] = useState(false);
  const [messagesError, setMessagesError] = useState("");

  const [members, setMembers] = useState([]);
  const [memberPage, setMemberPage] = useState({ hasMore: false, nextCursor: null });
  const [memberPaging, setMemberPaging] = useState(false);
  const [membersError, setMembersError] = useState("");

  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [sending, setSending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const [inviteCode, setInviteCode] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");

  const bottomRef = useRef(null);

  const fetchRoster = async ({ silent } = {}) => {
    if (!silent) setMembersError("");
    const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT }));
    const data = await api(`/community/groups/${encodeURIComponent(groupId)}/members?${q}`);
    setMembers(data.members || []);
    setMemberPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
  };

  const fetchFeed = async ({ silent } = {}) => {
    if (!silent) setMessagesError("");
    const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT }));
    const data = await api(`/community/groups/${encodeURIComponent(groupId)}/messages?${q}`);
    setMessages(data.messages || []);
    setPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
  };

  // Loads member-only resources; failures surface as section-level retries.
  const loadExtra = async () => {
    await Promise.all([
      fetchRoster().catch((err) => setMembersError(err.message || groupErrorText(err.status))),
      fetchFeed().catch((err) => setMessagesError(err.message || groupErrorText(err.status))),
    ]);
  };

  const load = async () => {
    setLoading(true);
    setLoadError("");
    setNotFound(false);
    try {
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}`);
      setGroup(data.group);
      if (data.group.joined) await loadExtra();
    } catch (err) {
      if (err.status === 404) setNotFound(true);
      else setLoadError(err.message || "Couldn't load this group. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [groupId]);

  useEffect(() => {
    if (!loading && group && ownerControls(user?.id, group.owner?.id) && isNonPublicGroup(group)) {
      loadInviteCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, loading, group?.owner?.id, group?.type]);

  const join = async () => {
    if (busy || !group) return;
    setBusy("join");
    setActionError("");
    try {
      const result = await api(`/community/groups/${encodeURIComponent(groupId)}/join`, { method: "POST" });
      setGroup((prev) => (prev ? { ...prev, joined: applyMembership(prev.joined, result) } : prev));
      await loadExtra();
    } catch (err) {
      if (isBlockedError(err)) setBlocked(true);
      else if (isRateLimitError(err)) setActionError("You've changed your group memberships too quickly. Please wait a minute and try again.");
      else if (err.status === 404) setNotFound(true);
      else if (err.status === 401) setActionError("Your session has expired. Please sign in again.");
      else setActionError(err.message || "Couldn't join the group. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    if (busy || !group) return;
    setBusy("leave");
    setActionError("");
    try {
      const result = await api(`/community/groups/${encodeURIComponent(groupId)}/leave`, { method: "POST" });
      setGroup((prev) => (prev ? { ...prev, joined: applyMembership(prev.joined, result) } : prev));
      setMembers([]);
      setMessages([]);
      setPage({ hasMore: false, nextCursor: null });
      setMemberPage({ hasMore: false, nextCursor: null });
      setBlocked(false);
    } catch (err) {
      if (isRateLimitError(err)) setActionError("You've changed your group memberships too quickly. Please wait a minute and try again.");
      else if (err.status === 400) setActionError(err.message || "You can't leave this group.");
      else if (err.status === 404) setNotFound(true);
      else if (err.status === 401) setActionError("Your session has expired. Please sign in again.");
      else setActionError(err.message || "Couldn't leave the group. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const joinWithCode = async (e) => {
    e.preventDefault();
    if (busy || !group) return;
    const codeProblem = validateInviteCode(joinCode);
    if (codeProblem) {
      setJoinError(codeProblem);
      return;
    }
    setBusy("join-code");
    setActionError("");
    setJoinError("");
    try {
      await api("/community/groups/join-with-code", { method: "POST", body: { code: joinCode.trim() } });
      setJoinCode("");
      setGroup((prev) => (prev ? { ...prev, joined: true } : prev));
      await loadExtra();
    } catch (err) {
      if (isBlockedError(err)) setBlocked(true);
      else if (isRateLimitError(err)) setActionError("You've changed your group memberships too quickly. Please wait a minute and try again.");
      else if (err.status === 404) setJoinError("That invite code didn't match an open group. Double-check it and try again.");
      else if (err.status === 401) setActionError("Your session has expired. Please sign in again.");
      else setJoinError(err.message || "Couldn't join with that code. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const loadInviteCode = async () => {
    if (inviteLoading) return;
    setInviteLoading(true);
    setInviteError("");
    setInviteNotice("");
    try {
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}/invite-code`);
      setInviteCode(data.inviteCode ?? null);
    } catch (err) {
      if (err.status === 404) setNotFound(true);
      else setInviteError(err.message || "Couldn't load the invite code.");
    } finally {
      setInviteLoading(false);
    }
  };

  const generateInviteCode = async () => {
    if (inviteBusy) return;
    setInviteBusy(true);
    setInviteError("");
    setInviteNotice("");
    try {
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}/invite-code`, { method: "POST" });
      setInviteCode(data.inviteCode ?? null);
      setInviteNotice("A new code was issued — the previous code no longer works.");
    } catch (err) {
      if (err.status === 404) setNotFound(true);
      else setInviteError(err.message || "Couldn't update the invite code.");
    } finally {
      setInviteBusy(false);
    }
  };

  const disableInviteCode = async () => {
    if (inviteBusy) return;
    setInviteBusy(true);
    setInviteError("");
    setInviteNotice("");
    try {
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}/invite-code`, { method: "DELETE" });
      setInviteCode(data.inviteCode ?? null);
      setInviteNotice("Invite code disabled. New joins stay closed until you generate a new code.");
    } catch (err) {
      if (err.status === 404) setNotFound(true);
      else setInviteError(err.message || "Couldn't disable the invite code.");
    } finally {
      setInviteBusy(false);
    }
  };

  const loadOlderMessages = async () => {
    if (paging || !page.nextCursor) return;
    setPaging(true);
    setMessagesError("");
    try {
      const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT, before: page.nextCursor }));
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}/messages?${q}`);
      setMessages((prev) => appendOlderGroupMessages(prev, data.messages || []));
      setPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
    } catch (err) {
      if (err.status === 404) setNotFound(true);
      else setMessagesError(err.message || "Couldn't load older messages.");
    } finally {
      setPaging(false);
    }
  };

  const loadMoreMembers = async () => {
    if (memberPaging || !memberPage.nextCursor) return;
    setMemberPaging(true);
    setMembersError("");
    try {
      const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT, before: memberPage.nextCursor }));
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}/members?${q}`);
      setMembers((prev) => appendOlderGroupMembers(prev, data.members || []));
      setMemberPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
    } catch (err) {
      if (err.status === 404) setNotFound(true);
      else setMembersError(err.message || "Couldn't load more members.");
    } finally {
      setMemberPaging(false);
    }
  };

  const refreshNewest = async () => {
    try {
      await fetchFeed({ silent: true });
    } catch {
      // Non-fatal: the next load or send refresh recovers.
    }
  };

  const onDraftChange = (value) => {
    setDraft(value);
    if (draftError) setDraftError("");
    if (rateLimited) setRateLimited(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (sending || blocked || !group?.joined) return;
    const problem = validateGroupMessage(draft);
    if (problem) {
      setDraftError(problem);
      return;
    }
    setSending(true);
    setDraftError("");
    setRateLimited(false);
    try {
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}/messages`, {
        method: "POST",
        body: { content: draft.trim() },
      });
      setMessages((prev) => mergeGroupMessages(prev, [data.message]));
      setDraft("");
      refreshNewest();
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch (err) {
      if (isBlockedError(err)) {
        setBlocked(true);
      } else if (isRateLimitError(err)) {
        setRateLimited(true);
      } else if (err.status === 400) {
        setDraftError(err.message || "That message couldn't be sent.");
      } else if (err.status === 404) {
        setNotFound(true);
      } else if (err.status === 401) {
        setDraftError("Your session has expired. Please sign in again.");
      } else {
        setDraftError("Something went wrong sending your message. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  const askDeleteMessage = (message) => {
    setConfirm({
      title: "Delete message",
      body: "Your message will be removed from this group. This can't be undone from your account.",
      confirmLabel: "Delete message",
      danger: true,
      run: runDeleteMessage,
      target: message,
    });
  };

  const runDeleteMessage = async () => {
    const message = confirm.target;
    setBusy("delete-message");
    try {
      const data = await api(
        `/community/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(message.id)}`,
        { method: "DELETE" },
      );
      setMessages((prev) => mergeGroupMessages(prev, [data.message]));
      setConfirm(null);
    } catch (err) {
      if (err.status === 403) setMessagesError("You can only delete your own messages.");
      else if (err.status === 404) setNotFound(true);
      else setMessagesError(err.message || "Couldn't delete the message.");
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  };

  const saveGroup = async (e) => {
    e.preventDefault();
    if (saving) return;
    const nameProblem = validateGroupName(editName);
    if (nameProblem) {
      setEditError(nameProblem);
      return;
    }
    const descProblem = validateGroupDescription(editDescription);
    if (descProblem) {
      setEditError(descProblem);
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}`, {
        method: "PATCH",
        body: { name: editName.trim(), description: editDescription.trim() || null },
      });
      setGroup(data.group);
      setEditing(false);
    } catch (err) {
      if (err.status === 403) setEditError("Only the group owner can edit this group.");
      else if (err.status === 400) setEditError(err.message || "That change couldn't be saved.");
      else if (err.status === 404) setNotFound(true);
      else if (err.status === 401) setEditError("Your session has expired. Please sign in again.");
      else setEditError("Something went wrong saving your changes.");
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setEditName(group.name || "");
    setEditDescription(group.description || "");
    setEditError("");
    setEditing(true);
  };

  const askRemove = (member) => {
    setConfirm({
      title: "Remove member",
      body: `${memberName(member)} will be removed from this group. They can rejoin anytime.`,
      confirmLabel: "Remove member",
      danger: true,
      run: runRemove,
      target: member,
    });
  };

  const runRemove = async () => {
    const member = confirm.target;
    setBusy("remove");
    try {
      await api(`/community/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(member.userId)}`, {
        method: "DELETE",
      });
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      setGroup((prev) => (prev ? { ...prev, memberCount: Math.max(0, (prev.memberCount || 1) - 1) } : prev));
      setConfirm(null);
    } catch (err) {
      if (err.status === 400) setMembersError(err.message || "That member can't be removed.");
      else if (err.status === 404) setNotFound(true);
      else setMembersError(err.message || "Couldn't remove that member.");
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  };

  const askTransfer = (member) => {
    setConfirm({
      title: "Transfer ownership",
      body: `Ownership of "${group.name}" will transfer to ${memberName(member)}. You will stay a member of the group.`,
      confirmLabel: "Transfer ownership",
      danger: false,
      run: runTransfer,
      target: member,
    });
  };

  const runTransfer = async () => {
    const target = confirm.target;
    setBusy("transfer");
    try {
      const data = await api(`/community/groups/${encodeURIComponent(groupId)}/transfer`, {
        method: "POST",
        body: { userId: target.userId },
      });
      // Owner identity comes from the server response; controls recompute below.
      setGroup(data.group);
      setConfirm(null);
    } catch (err) {
      if (err.status === 400) setMembersError(err.message || "Ownership can't be transferred to that member.");
      else if (err.status === 404) setNotFound(true);
      else setMembersError(err.message || "Couldn't transfer ownership.");
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  };

  const askDissolve = () => {
    setConfirm({
      title: "Dissolve group",
      body: `"${group.name}" will disappear for everyone and can't be restored from the customer app. This is permanent.`,
      confirmLabel: "Dissolve group",
      danger: true,
      run: runDissolve,
    });
  };

  const runDissolve = async () => {
    setBusy("dissolve");
    try {
      await api(`/community/groups/${encodeURIComponent(groupId)}/dissolve`, { method: "POST" });
      setConfirm(null);
      router.replace("/dashboard/community/groups");
    } catch (err) {
      if (err.status === 404) {
        setNotFound(true);
      } else {
        setActionError(err.message || "Couldn't dissolve the group.");
      }
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  };

  const isOwner = ownerControls(user?.id, group?.owner?.id);
  const isJoined = Boolean(group?.joined);
  const shown = chronologicalGroupMessages(messages);

  const renderMessage = (m) => {
    const mine = user && m.sender?.id === user.id;
    const deleted = isDeletedMessage(m);
    return (
      <div key={m.id} className="flex">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-bl-sm border border-line bg-white px-4 py-2.5 text-sm text-ink">
          <div className="text-[11px] text-muted">
            {m.sender?.id ? (
              <Link href={`/dashboard/profile/${encodeURIComponent(m.sender.id)}`} className="font-semibold text-ink hover:underline">
                {m.sender?.name || "Group member"}
              </Link>
            ) : (
              <span className="font-semibold text-ink">{m.sender?.name || "Group member"}</span>
            )}
            {" · "}
            {fmtDateTime(m.createdAt)}
            {mine && !deleted && (
              <button
                className="ml-2 inline-flex items-center gap-1 text-danger hover:underline"
                onClick={() => askDeleteMessage(m)}
                disabled={Boolean(busy)}
              >
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
          <p className={`mt-1 whitespace-pre-wrap break-words ${deleted ? "italic text-muted" : ""}`}>
            {messageDisplayText(m)}
          </p>
        </div>
      </div>
    );
  };

  const renderMember = (m) => {
    const memberIsOwner = m.userId === group.owner?.id;
    const isYou = user && m.userId === user.id;
    return (
      <div key={m.userId} className="flex items-center gap-3 py-2.5">
        {memberAvatarUrl(m) ? (
          <img src={memberAvatarUrl(m)} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-clean-light text-clean">
            <UserRound size={16} />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {isYou ? (
              <span className="font-semibold text-ink">You</span>
            ) : (
              <Link href={`/dashboard/profile/${encodeURIComponent(m.userId)}`} className="font-semibold text-ink hover:underline">
                {memberName(m)}
              </Link>
            )}
            {memberIsOwner && (
              <span className="inline-flex items-center gap-1 rounded-full bg-clean-light px-2 py-0.5 text-[11px] font-semibold text-clean">
                <Crown size={11} /> Owner
              </span>
            )}
            {isOnlineMember(m) && <span className="text-[11px] font-semibold text-clean">Online</span>}
          </div>
          <div className="text-xs text-muted">Joined {fmtDate(m.joinedAt)}</div>
        </div>
        {isOwner && !isYou && !memberIsOwner && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              className="btn btn-outline btn-sm"
              title="Transfer ownership"
              onClick={() => askTransfer(m)}
              disabled={Boolean(busy)}
            >
              <ArrowRightLeft size={13} /> <span className="hidden sm:inline">Transfer</span>
            </button>
            <button
              className="btn btn-danger btn-sm"
              title="Remove member"
              onClick={() => askRemove(m)}
              disabled={Boolean(busy)}
            >
              <Trash2 size={13} /> <span className="hidden sm:inline">Remove</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Groups"
      subtitle={group ? group.name : "Group details"}>
      <div className="mb-4">
        <Link href="/dashboard/community/groups" className="btn btn-outline btn-sm">
          <ArrowLeft size={14} /> Back to groups
        </Link>
      </div>

      {loading ? (
        <div className="empty-state">Loading group…</div>
      ) : notFound ? (
        <div className="empty-state">
          <p className="font-semibold text-ink">This group is no longer available.</p>
          <p className="text-sm">It may have been dissolved or it may no longer exist.</p>
          <Link href="/dashboard/community/groups" className="btn btn-outline mt-4">
            <ArrowLeft size={15} /> Back to groups
          </Link>
        </div>
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
          {/* Group info */}
          <div className="card card-pad mb-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-xl font-extrabold tracking-tight text-ink">{group.name}</h2>
                  {requiresInvite(group) && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      By invitation only
                    </span>
                  )}
                  {isJoined && (
                    <span className="rounded-full bg-clean-light px-2.5 py-0.5 text-xs font-semibold text-clean">
                      Joined
                    </span>
                  )}
                  {isOwner && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-clean-light px-2.5 py-0.5 text-xs font-semibold text-clean">
                      <Crown size={12} /> Owner
                    </span>
                  )}
                </div>
                {group.description && <p className="mt-2 text-sm text-muted">{group.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Users size={13} /> {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Crown size={13} /> Owner:{" "}
                    {group.owner?.id ? (
                      <Link href={`/dashboard/profile/${encodeURIComponent(group.owner.id)}`} className="font-semibold text-ink hover:underline">
                        {group.owner.name || "Group owner"}
                      </Link>
                    ) : (
                      <span className="font-semibold text-ink">{group.owner?.name || "Group owner"}</span>
                    )}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {!isJoined && isNonPublicGroup(group) && (
                  <form className="flex items-center gap-2" onSubmit={joinWithCode}>
                    <label htmlFor="join-code" className="sr-only">Invite code</label>
                    <input
                      id="join-code"
                      className="input w-44"
                      placeholder="Enter invite code"
                      value={joinCode}
                      onChange={(e) => { setJoinCode(e.target.value); if (joinError) setJoinError(""); }}
                      disabled={Boolean(busy)}
                      autoComplete="off"
                    />
                    <button className="btn btn-primary" disabled={Boolean(busy) || blocked || !joinCode.trim()}>
                      {busy === "join-code" ? "Joining…" : "Join with code"}
                    </button>
                  </form>
                )}
                {!isJoined && !isNonPublicGroup(group) && (
                  <button className="btn btn-primary" onClick={join} disabled={Boolean(busy) || blocked}>
                    {busy === "join" ? "Joining…" : "Join group"}
                  </button>
                )}
                {isJoined && !isOwner && (
                  <button className="btn btn-outline" onClick={leave} disabled={Boolean(busy)}>
                    {busy === "leave" ? "Leaving…" : "Leave group"}
                  </button>
                )}
                {isOwner && (
                  <button className="btn btn-outline" onClick={startEditing} disabled={editing}>
                    <Pencil size={14} /> Edit group
                  </button>
                )}
                {isOwner && (
                  <button className="btn btn-danger" onClick={askDissolve} disabled={Boolean(busy)}>
                    Dissolve group
                  </button>
                )}
              </div>
            </div>
            {actionError && <p className="form-error mt-3" aria-live="polite">{actionError}</p>}
            {joinError && <p className="form-error mt-3" aria-live="polite">{joinError}</p>}
          </div>

          {/* Owner-only invite code panel (private & invite_only groups) */}
          {isOwner && isNonPublicGroup(group) && (
            <div className="card card-pad mb-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-ink">Invite code</h3>
                  <p className="mt-1 text-sm text-muted">
                    Share this code with the customers you want to invite. It opens {groupTypeLabel(group.type)} joins.
                  </p>
                  {inviteLoading ? (
                    <p className="mt-2 text-sm text-muted">Loading code…</p>
                  ) : inviteCode ? (
                    <div className="mt-3">
                      <code className="rounded-lg border border-line bg-slate-50 px-3 py-1.5 font-mono text-base font-semibold tracking-wide text-ink">
                        {inviteCode}
                      </code>
                      <p className="mt-2 text-xs text-muted">
                        Anyone with this code can join. Rotate it to revoke access, or disable it to close new joins.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted">
                      No invite code yet — generate one to start inviting customers.
                    </p>
                  )}
                  {inviteNotice && <p className="mt-2 text-xs font-semibold text-clean" role="status">{inviteNotice}</p>}
                  {inviteError && <p className="form-error mt-2">{inviteError}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!inviteCode && !inviteLoading && (
                    <button className="btn btn-primary btn-sm" onClick={generateInviteCode} disabled={inviteBusy}>
                      {inviteBusy ? "Generating…" : "Generate code"}
                    </button>
                  )}
                  {inviteCode && !inviteLoading && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={generateInviteCode} disabled={inviteBusy}>
                        {inviteBusy ? "Rotating…" : "Rotate code"}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={disableInviteCode} disabled={inviteBusy}>
                        Disable
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {blocked && (
            <div role="status" className="mb-6 border-b border-amber-200 bg-warnbg px-5 py-3 text-sm text-amber-700">
              You're currently blocked from posting to groups. You can still read messages and manage your groups.
            </div>
          )}

          {/* Owner edit form */}
          {editing && (
            <div className="card card-pad mb-6">
              <form className="grid gap-3" onSubmit={saveGroup}>
                <h2 className="font-bold text-ink">Edit group</h2>
                <div>
                  <label htmlFor="edit-group-name" className="sr-only">Group name</label>
                  <input
                    id="edit-group-name"
                    className="input w-full"
                    maxLength={GROUP_NAME_MAX}
                    placeholder="Group name (required)"
                    value={editName}
                    onChange={(e) => { setEditName(e.target.value); if (editError) setEditError(""); }}
                    disabled={saving}
                  />
                  <p className="mt-1 text-right text-xs text-muted">{editName.length}/{GROUP_NAME_MAX}</p>
                </div>
                <div>
                  <label htmlFor="edit-group-description" className="sr-only">Group description</label>
                  <textarea
                    id="edit-group-description"
                    className="textarea w-full"
                    rows={3}
                    maxLength={GROUP_DESCRIPTION_MAX}
                    placeholder="What's this group about? (optional)"
                    value={editDescription}
                    onChange={(e) => { setEditDescription(e.target.value); if (editError) setEditError(""); }}
                    disabled={saving}
                  />
                  <p className="mt-1 text-right text-xs text-muted">{editDescription.length}/{GROUP_DESCRIPTION_MAX}</p>
                </div>
                <div className="text-right" aria-live="polite">
                  {editError && <p className="form-error mb-1">{editError}</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(false)} disabled={saving}>
                      Cancel
                    </button>
                    <button className="btn btn-primary btn-sm" disabled={saving}>
                      <Check size={14} /> {saving ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* Members + messages (members only) */}
          {isJoined && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
              {/* Members */}
              <section className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <h3 className="font-bold text-ink">Members</h3>
                  <span className="text-xs font-semibold text-muted">{members.length} shown</span>
                </div>
                <div className="px-5 py-2">
                  {membersError ? (
                    <>
                      <p className="form-error">{membersError}</p>
                      <button className="btn btn-outline btn-sm mt-2" onClick={() => fetchRoster().catch((err) => setMembersError(err.message))}>
                        <RefreshCw size={13} /> Retry
                      </button>
                    </>
                  ) : members.length === 0 ? (
                    <p className="py-3 text-sm text-muted">No members yet.</p>
                  ) : (
                    members.map(renderMember)
                  )}
                  {!membersError && memberPage.hasMore && (
                    <div className="pt-2 pb-3 text-center">
                      <button className="btn btn-outline btn-sm" onClick={loadMoreMembers} disabled={memberPaging}>
                        {memberPaging ? "Loading…" : "Load more members"}
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {/* Messages + composer */}
              <section className="card flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-clean-light text-clean">
                    <MessageCircle size={17} />
                  </span>
                  <div>
                    <div className="font-bold text-ink">Group messages</div>
                    <div className="text-xs text-muted">Members can read and reply here</div>
                  </div>
                </div>

                <div className="flex-1 space-y-4 bg-slate-50/60 p-5">
                  {messagesError ? (
                    <div className="empty-state">
                      <p className="font-semibold text-ink">Couldn't load messages.</p>
                      <p className="text-sm">{messagesError}</p>
                      <button className="btn btn-outline btn-sm mt-3" onClick={() => fetchFeed().catch((err) => setMessagesError(err.message))}>
                        <RefreshCw size={13} /> Retry
                      </button>
                    </div>
                  ) : (
                    <>
                      {page.hasMore && (
                        <div className="text-center">
                          <button className="btn btn-outline btn-sm" onClick={loadOlderMessages} disabled={paging}>
                            <RefreshCw size={13} /> {paging ? "Loading…" : "Load older messages"}
                          </button>
                        </div>
                      )}
                      {shown.length === 0 ? (
                        <div className="empty-state">
                          <p className="font-semibold text-ink">No messages yet.</p>
                          <p className="text-sm">Say hello below!</p>
                        </div>
                      ) : (
                        shown.map(renderMessage)
                      )}
                      <div ref={bottomRef} />
                    </>
                  )}
                </div>

                {/* Composer */}
                <form className="border-t border-line bg-white p-3.5" onSubmit={submit}>
                  <label htmlFor="group-draft" className="sr-only">Message this group</label>
                  <textarea
                    id="group-draft"
                    className="textarea w-full"
                    rows={2}
                    maxLength={1000}
                    placeholder="Share something with the group…"
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    disabled={sending || blocked}
                  />
                  <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button className="btn btn-primary w-full sm:w-auto" disabled={sending || blocked || !draft.trim()}>
                      <Send size={16} /> {sending ? "Sending…" : "Send"}
                    </button>
                    <div className="text-right" aria-live="polite">
                      {rateLimited && (
                        <p className="form-error mb-1">
                          You've sent too many messages. Please wait a minute and try again — your message is saved.
                        </p>
                      )}
                      {draftError && !rateLimited && <p className="form-error mb-1">{draftError}</p>}
                      <p className="text-xs text-muted">{draft.length}/1000 characters</p>
                    </div>
                  </div>
                </form>
              </section>
            </div>
          )}
        </>
      ) : null}

      {/* Confirmation dialog (admin/bookings modal precedent) */}
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 px-4" role="dialog" aria-modal="true">
          <div className="card card-pad w-full max-w-md">
            <h2 className="font-bold text-ink">{confirm.title}</h2>
            <p className="mt-2 text-sm text-muted">{confirm.body}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => setConfirm(null)} disabled={Boolean(busy)}>
                Cancel
              </button>
              <button
                className={`btn btn-sm ${confirm.danger ? "btn-danger" : "btn-primary"}`}
                onClick={confirm.run}
                disabled={Boolean(busy)}
              >
                {busy ? "Working…" : confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}