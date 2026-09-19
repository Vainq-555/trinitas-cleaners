"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings, Star,
  Users, Send, Plus, X, RefreshCw, MessageCircle, KeyRound,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";
import {
  GROUPS_LIMIT_DEFAULT,
  GROUP_NAME_MAX,
  GROUP_DESCRIPTION_MAX,
  GROUP_TYPES,
  GROUP_TYPE_PUBLIC,
  groupsQuery,
  mergeGroupMessages,
  validateGroupName,
  validateGroupDescription,
  validateGroupType,
  validateInviteCode,
  requiresInvite,
  groupTypeLabel,
  joinWithCodeTarget,
  isBlockedError,
  isRateLimitError,
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

export default function GroupsListPage() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupType, setGroupType] = useState(GROUP_TYPE_PUBLIC);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createNotice, setCreateNotice] = useState("");

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joinNotice, setJoinNotice] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const q = toQuery(groupsQuery({ limit: GROUPS_LIMIT_DEFAULT }));
      const data = await api(`/community/groups?${q}`);
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
      const data = await api(`/community/groups?${q}`);
      setItems((prev) => mergeGroupMessages(prev, data.items || []));
      setPage({ hasMore: Boolean(data.hasMore), nextCursor: data.nextCursor ?? null });
    } catch (err) {
      setPageError(err.message || "Couldn't load more groups. Please try again.");
    } finally {
      setPaging(false);
    }
  };

  const onNameChange = (value) => {
    setName(value);
    if (createError) setCreateError("");
    if (createNotice) setCreateNotice("");
  };

  const onDescriptionChange = (value) => {
    setDescription(value);
    if (createError) setCreateError("");
  };

  const onTypeChange = (value) => {
    setGroupType(value);
    if (createError) setCreateError("");
  };

  const create = async (e) => {
    e.preventDefault();
    if (creating) return;
    const nameProblem = validateGroupName(name);
    if (nameProblem) {
      setCreateError(nameProblem);
      setCreateNotice("");
      return;
    }
    const descProblem = validateGroupDescription(description);
    if (descProblem) {
      setCreateError(descProblem);
      setCreateNotice("");
      return;
    }
    const typeProblem = validateGroupType(groupType);
    if (typeProblem) {
      setCreateError(typeProblem);
      setCreateNotice("");
      return;
    }
    setCreating(true);
    setCreateError("");
    setCreateNotice("");
    try {
      const trimmedName = name.trim();
      const trimmedDesc = description.trim() || null;
      const data = await api("/community/groups", {
        method: "POST",
        body: { name: trimmedName, description: trimmedDesc, type: groupType },
      });
      router.push(`/dashboard/community/groups/${encodeURIComponent(data.group.id)}`);
    } catch (err) {
      // Draft values are preserved on every failure.
      if (isBlockedError(err)) {
        setCreateNotice("You're currently blocked from creating groups. You can still view and join others.");
      } else if (isRateLimitError(err)) {
        setCreateNotice("You've created too many groups recently. Please wait a while and try again — your draft is saved.");
      } else if (err.status === 400) {
        setCreateError(err.message || "That group couldn't be created. Check the fields and try again.");
      } else if (err.status === 401) {
        setCreateNotice("Your session has expired. Please sign in again.");
      } else {
        setCreateError(err.message || "Something went wrong creating the group. Please try again.");
      }
    } finally {
      setCreating(false);
    }
  };

  // Join a private or invitation-only group from the owner's shareable code.
  // The backend resolves the group from the code alone (no group id needed).
  const joinWithCode = async (e) => {
    e.preventDefault();
    if (joining) return;
    const problem = validateInviteCode(joinCode);
    if (problem) {
      setJoinError(problem);
      setJoinNotice("");
      return;
    }
    setJoining(true);
    setJoinError("");
    setJoinNotice("");
    try {
      const data = await api("/community/groups/join-with-code", {
        method: "POST",
        body: { code: joinCode.trim() },
      });
      const target = joinWithCodeTarget(data);
      if (target) {
        router.push(`/dashboard/community/groups/${encodeURIComponent(target)}`);
        return;
      }
      setJoinNotice("You've joined the group.");
      setJoinCode("");
      load();
    } catch (err) {
      if (isBlockedError(err)) {
        setJoinNotice("You're currently blocked from joining groups.");
      } else if (isRateLimitError(err)) {
        setJoinError("You've changed your group memberships too quickly. Please wait a minute and try again.");
      } else if (err.status === 404) {
        setJoinError("That invite code didn't match an open group. Double-check it and try again.");
      } else if (err.status === 401) {
        setJoinNotice("Your session has expired. Please sign in again.");
      } else {
        setJoinError(err.message || "Couldn't join with that code. Please try again.");
      }
    } finally {
      setJoining(false);
    }
  };

  const closeJoin = () => {
    setJoinOpen(false);
    setJoinError("");
    setJoinNotice("");
    setJoinCode("");
  };

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Groups"
      subtitle="Join customer groups around life, home, and cleaning.">
      {/* Create group */}
      <div className="card card-pad mb-6">
        {createOpen ? (
          <form className="grid gap-3" onSubmit={create}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-ink">Create a group</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreateOpen(false)} aria-label="Close create group form">
                <X size={15} /> Close
              </button>
            </div>
            <div>
              <label htmlFor="group-name" className="sr-only">Group name</label>
              <input
                id="group-name"
                className="input w-full"
                placeholder="Group name (required)"
                maxLength={GROUP_NAME_MAX}
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                disabled={creating}
              />
              <p className="mt-1 text-right text-xs text-muted">{name.length}/{GROUP_NAME_MAX}</p>
            </div>
            <div>
              <label htmlFor="group-description" className="sr-only">Group description</label>
              <textarea
                id="group-description"
                className="textarea w-full"
                rows={3}
                maxLength={GROUP_DESCRIPTION_MAX}
                placeholder="What's this group about? (optional)"
                value={description}
                onChange={(e) => onDescriptionChange(e.target.value)}
                disabled={creating}
              />
              <p className="mt-1 text-right text-xs text-muted">{description.length}/{GROUP_DESCRIPTION_MAX}</p>
            </div>
            <div>
              <label htmlFor="group-type" className="mb-1 block text-xs font-semibold text-ink">Who can join?</label>
              <select
                id="group-type"
                className="input w-full"
                value={groupType}
                onChange={(e) => onTypeChange(e.target.value)}
                disabled={creating}
              >
                {GROUP_TYPES.map((value) => (
                  <option key={value} value={value}>{groupTypeLabel(value)}</option>
                ))}
              </select>
              {groupType !== GROUP_TYPE_PUBLIC && (
                <p className="mt-1 text-xs text-muted">
                  {groupType === "private"
                    ? "Hidden from public discovery — only customers you share an invite code with can join."
                    : "Shown in discovery with an invitation badge — joining still requires the invite code you share."}
                </p>
              )}
            </div>
            <div className="text-right" aria-live="polite">
              {createNotice && <p className="form-error mb-1">{createNotice}</p>}
              {createError && !createNotice && <p className="form-error mb-1">{createError}</p>}
              <button className="btn btn-primary" disabled={creating}>
                <Send size={16} /> {creating ? "Creating…" : "Create group"}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">Start a group — public, private, or by invitation only.</p>
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> Create a group
            </button>
          </div>
        )}
      </div>

      {/* Join by invite code */}
      <div className="card card-pad mb-6">
        {joinOpen ? (
          <form className="grid gap-3" onSubmit={joinWithCode}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-ink">Join with invite code</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeJoin} aria-label="Close join with invite code form">
                <X size={15} /> Close
              </button>
            </div>
            <p className="text-sm text-muted">
              Have an invite code? Enter it here to join a private or invitation-only group.
            </p>
            <div>
              <label htmlFor="join-code" className="sr-only">Invite code</label>
              <input
                id="join-code"
                className="input w-full"
                placeholder="Enter the invite code you were given"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  if (joinError) setJoinError("");
                  if (joinNotice) setJoinNotice("");
                }}
                disabled={joining}
                autoComplete="off"
              />
            </div>
            <div className="text-right" aria-live="polite">
              {joinNotice && <p className="form-ok mb-1">{joinNotice}</p>}
              {joinError && <p className="form-error mb-1">{joinError}</p>}
              <button className="btn btn-primary" disabled={joining || !joinCode.trim()}>
                <KeyRound size={16} /> {joining ? "Joining…" : "Join group"}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">Got an invite to a private group?</p>
              <p className="text-sm text-muted">Enter your invite code to join a private or invitation-only group.</p>
            </div>
            <button className="btn btn-outline" onClick={() => setJoinOpen(true)}>
              <KeyRound size={16} /> Join with invite code
            </button>
          </div>
        )}
      </div>

      {/* Group list */}
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
          <p className="font-semibold text-ink">No groups yet.</p>
          <p className="text-sm">Be the first — create a group above!</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((g) => (
            <Link
              key={g.id}
              href={`/dashboard/community/groups/${encodeURIComponent(g.id)}`}
              className="card card-pad block transition-colors hover:border-brand"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-ink">{g.name}</div>
                  {requiresInvite(g) && (
                    <span className="mt-1 mr-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      By invitation only
                    </span>
                  )}
                  {g.joined && (
                    <span className="mt-1 inline-block rounded-full bg-clean-light px-2 py-0.5 text-[11px] font-semibold text-clean">
                      Joined
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs font-semibold text-muted">
                  <Users size={13} className="mr-1 inline" />
                  {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                </span>
              </div>
              {g.description && <p className="mt-2 text-sm text-muted line-clamp-2">{g.description}</p>}
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
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