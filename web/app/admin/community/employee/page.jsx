"use client";

// ADMIN — EMPLOYEE COMMUNITY MODERATION (Phase 2B-5).
//
// A separate page from /admin/community, which moderates the CUSTOMER community.
// The two are deliberately distinct surfaces: this one reads and moderates only
// the employee audience, so an admin can never moderate the customer community
// through it, and the customer page keeps exactly the meaning it always had.
//
// Admins MODERATE here and never AUTHOR: there is no composer and no create
// endpoint on this surface. Removing a post is a SOFT delete, and the confirm
// dialog says so plainly — it is reversible in principle and keeps the record.
//
// This page never offers an employee-to-customer message action. Employee and
// customer accounts are never allowed to message one another; the only
// employee conversation is with an admin, in /employee/messages.

import { useEffect, useRef, useState } from "react";
import {
  Users,
  Ban,
  UserCheck,
  RefreshCw,
  MessagesSquare,
  Inbox,
  UsersRound,
} from "lucide-react";
import Shell from "@/components/Shell";
import { adminNavLinks } from "@/lib/adminNav";
import { api } from "@/lib/api";
import { mergeNewest, removedCount } from "@/lib/employeeCommunity.mjs";

const links = [
  ...adminNavLinks(),
  { href: "/admin/community/employee", label: "Employee Community", icon: UsersRound },
];

const toQuery = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p.toString();
};

export default function AdminEmployeeCommunityPage() {
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextBefore: null });
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [paging, setPaging] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [userBusyId, setUserBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");

  const scrollRef = useRef(null);
  const pollingRef = useRef(false);
  const loadAnchor = useRef(null);

  const blockedAtOf = (employeeId) =>
    employees.find((u) => u.id === employeeId)?.communityBlockedAt ?? null;

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const q = toQuery({ limit: 100 });
      const [feed, staff] = await Promise.all([
        api(`/admin/community/employee/messages?${q}`),
        api("/admin/community/employee/users"),
      ]);
      setMessages(Array.isArray(feed.messages) ? feed.messages : []);
      setPage({ hasMore: Boolean(feed.hasMore), nextBefore: feed.nextBefore ?? null });
      setEmployees(Array.isArray(staff.users) ? staff.users : []);
    } catch (e) {
      setLoadError(e.message || "Couldn't load the employee community. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const refreshNewest = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const q = toQuery({ limit: 50 });
      const feed = await api(`/admin/community/employee/messages?${q}`);
      setMessages((prev) => mergeNewest(prev, feed.messages));
    } catch {
      /* silent poll failure; the next tick or a manual retry recovers */
    } finally {
      pollingRef.current = false;
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(refreshNewest, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (loadAnchor.current && el) {
      el.scrollTop = loadAnchor.current.scrollTop + (el.scrollHeight - loadAnchor.current.scrollHeight);
      loadAnchor.current = null;
    }
  }, [messages.length]);

  const loadOlder = async () => {
    if (paging || !page.nextBefore) return;
    setPaging(true);
    const el = scrollRef.current;
    if (el) loadAnchor.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    try {
      const q = toQuery({ limit: 50, before: page.nextBefore });
      const feed = await api(`/admin/community/employee/messages?${q}`);
      setMessages((prev) => mergeNewest(prev, feed.messages));
      setPage({ hasMore: Boolean(feed.hasMore), nextBefore: feed.nextBefore ?? null });
    } catch (e) {
      setErr(e.message || "Couldn't load older posts. Please try again.");
    } finally {
      setPaging(false);
    }
  };

  const moderationError = (e) => {
    if (e.status === 401 || e.status === 403) {
      return "Your session may have expired. Please refresh and try again.";
    }
    if (e.status === 404) return "That item could not be found.";
    if (e.status === 429) return "Too many requests. Please wait a moment and try again.";
    if (e.status === 400) return e.message;
    return "Something went wrong. Please try again.";
  };

  const removePost = async (message) => {
    setErr("");
    if (
      !confirm(
        `Remove this post from the employee community?\n\nThe post will stop appearing to employees, but it is not permanently deleted and the moderation record is kept. The employee's account, assignments and schedule are not affected.`
      )
    )
      return;
    setBusyId(message.id);
    try {
      await api(`/admin/community/employee/messages/${message.id}`, { method: "DELETE" });
      // Reflect the server's answer rather than guessing at local state.
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, deletedAt: message.deletedAt ?? new Date().toISOString() } : m)),
      );
      setNotice("The post was removed from the employee community.");
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setBusyId(null);
    }
  };

  const setBlocked = async (employee, blockedAt) => {
    setErr("");
    const blocking = blockedAt === null;
    if (
      !confirm(
        blocking
          ? `Block ${employee.name} from posting to the employee community?\n\nThey can still read the community and use the rest of their account. This does not delete the account, remove their assignments, or change any pay or schedule.`
          : `Allow ${employee.name} to post to the employee community again?`
      )
    )
      return;
    setUserBusyId(employee.id);
    try {
      const result = await api(
        `/admin/community/employee/users/${employee.id}/${blocking ? "block" : "unblock"}`,
        { method: "POST" },
      );
      setEmployees((prev) =>
        prev.map((u) => (u.id === employee.id ? { ...u, communityBlockedAt: result.user.communityBlockedAt } : u)),
      );
      setNotice(
        blocking
          ? `${employee.name} is blocked from posting to the employee community.`
          : `${employee.name} can post to the employee community again.`,
      );
    } catch (e) {
      setErr(moderationError(e));
    } finally {
      setUserBusyId(null);
    }
  };

  const removed = removedCount(messages);

  return (
    <Shell
      links={links}
      sections={["Admin Portal"]}
      title="Employee Community"
      subtitle="Monitor the shared employee community and moderate its posts."
    >
      {err && <div className="form-error mb-6">{err}</div>}
      {notice && <div className="form-ok mb-6">{notice}</div>}

      <p className="mb-4 max-w-2xl text-sm text-muted">
        This is the single shared community where employees talk with each other. It is separate
        from the customer community, which you moderate on its own page. Removing a post only
        withdraws it from employees — it is not permanently deleted. Blocking stops an employee
        from posting but never removes their account, assignments or schedule.
      </p>

      <div className="card overflow-hidden flex flex-col" style={{ height: "calc(100vh - 320px)", minHeight: 420 }}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-clean-light text-clean">
            <MessagesSquare size={18} />
          </span>
          <div>
            <div className="font-bold text-ink">Employee Community</div>
            <div className="text-xs text-muted">
              Newest posts first · refreshes automatically
              {removed > 0 ? ` · ${removed} removed` : ""}
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-50/60 p-5 space-y-3">
          {loading ? (
            <div className="empty-state">Loading the employee community…</div>
          ) : loadError ? (
            <div className="empty-state">
              <p className="font-semibold text-ink">Couldn&apos;t load the employee community.</p>
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
                    <RefreshCw size={14} /> {paging ? "Loading…" : "Load older posts"}
                  </button>
                </div>
              )}

              {messages.length === 0 ? (
                <div className="empty-state">
                  <Inbox size={36} className="mx-auto text-slate-300" />
                  <p className="mt-3 font-semibold text-ink">No employee community posts yet.</p>
                  <p className="text-sm">Posts employees write will appear here.</p>
                </div>
              ) : (
                messages.map((m) => {
                  const authorId = m.author?.id;
                  const isRemoved = m.deletedAt != null;
                  const isBlocked = Boolean(authorId && blockedAtOf(authorId));
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col gap-3 rounded-xl border bg-white p-4 lg:flex-row lg:items-start ${
                        isRemoved ? "border-amber-200 opacity-70" : "border-line"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-bold text-ink">{m.author?.name || "Employee"}</span>
                          {authorId && <span className="text-[11px] text-muted">{authorId}</span>}
                          <span className="text-[11px] text-muted">
                            · {new Date(m.createdAt).toLocaleString("en-US")}
                          </span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700">
                          {m.content}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                        {isRemoved ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-warnbg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                            Removed
                          </span>
                        ) : (
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busyId === m.id}
                            onClick={() => removePost(m)}
                          >
                            <Ban size={13} /> {busyId === m.id ? "Removing…" : "Remove post"}
                          </button>
                        )}
                        {authorId && (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                              isBlocked
                                ? "border-amber-200 bg-warnbg text-amber-700"
                                : "border-green-200 bg-okbg text-clean-dark"
                            }`}
                          >
                            {isBlocked ? "Blocked from posting" : "Allowed to post"}
                          </span>
                        )}
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
            <Users size={18} />
          </span>
          <div>
            <div className="font-bold text-ink">Employees</div>
            <div className="text-xs text-muted">Block or unblock an employee from posting</div>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading employees…</div>
        ) : employees.length === 0 ? (
          <div className="empty-state">
            <p className="font-semibold text-ink">No employee accounts yet.</p>
            <p className="text-sm">Employee accounts are created from the Employees page.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {employees.map((u) => {
              const blocked = Boolean(u.communityBlockedAt);
              return (
                <li
                  key={u.id}
                  className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-ink">{u.name}</span>
                      <span className="text-[11px] text-muted">{u.id}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                        blocked
                          ? "border-amber-200 bg-warnbg text-amber-700"
                          : "border-green-200 bg-okbg text-clean-dark"
                      }`}
                    >
                      {blocked ? "Blocked" : "Allowed"}
                    </span>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={userBusyId === u.id}
                      onClick={() => setBlocked(u, blocked ? new Date(0) : null)}
                    >
                      {blocked ? <UserCheck size={13} /> : <Ban size={13} />}
                      {userBusyId === u.id ? "Working…" : blocked ? "Allow posting" : "Block posting"}
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
