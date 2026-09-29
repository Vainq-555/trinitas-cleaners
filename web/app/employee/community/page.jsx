"use client";

// EMPLOYEE COMMUNITY — Phase 2B-5.
//
// One shared employee-only community. This page shows exactly what
// `GET /employee/community/messages` returned, which the server has already
// scoped to this employee AND to the employee audience.
//
// There is no client-side filter and no client-side audience logic here by
// design: a frontend filter is not authorization, and duplicating the rule would
// only give a false sense of protection. There is also NO link to a profile —
// this phase builds no employee profiles, and the customer profile route is
// requireCustomer, so linking to it would 403 for every employee.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).

import { useEffect, useRef } from "react";
import Link from "next/link";
import { MessagesSquare, RefreshCw, RotateCcw, Send, Users } from "lucide-react";
import Shell from "@/components/Shell";
import { useAuth } from "@/lib/auth";
import { employeeNavLinks } from "@/lib/employeeNav";
import { useEmployeeCommunity } from "@/lib/useEmployeeCommunity";
import {
  COMMUNITY_MESSAGE_MAX_LENGTH,
  EMPTY_BODY,
  EMPTY_TITLE,
  ERROR_TITLE,
  authorLabel,
  chronological,
  isOwnPost,
} from "@/lib/employeeCommunity.mjs";

export default function EmployeeCommunityPage() {
  const { user } = useAuth();
  const {
    messages,
    page,
    loading,
    error,
    unauthorized,
    paging,
    loadOlder,
    reload,
    draft,
    setDraft,
    sendError,
    setSendError,
    sending,
    submit,
    rateLimited,
    blocked,
  } = useEmployeeCommunity();

  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const loadAnchor = useRef(null);

  // Auto-follow only when the reader is already at (or near) the bottom, so
  // scrolling back through history is never yanked away by a poll.
  const shown = chronological(messages);
  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  // Keep the reader's place when an older page is prepended.
  useEffect(() => {
    const el = scrollRef.current;
    if (loadAnchor.current && el) {
      el.scrollTop = loadAnchor.current.scrollTop + (el.scrollHeight - loadAnchor.current.scrollHeight);
      loadAnchor.current = null;
    }
  }, [shown.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const onLoadOlder = () => {
    const el = scrollRef.current;
    if (el) loadAnchor.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    loadOlder();
  };

  return (
    <Shell
      links={employeeNavLinks(0)}
      sections={["Employee Portal"]}
      title="Employee Community"
      subtitle="A shared space for Trinitas-Cleaners employees."
    >
      <div
        className="card overflow-hidden flex flex-col"
        style={{ height: "calc(100vh - 220px)", minHeight: 420 }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-clean-light text-clean">
            <Users size={18} />
          </span>
          <div>
            <div className="font-bold text-ink">Employee Community</div>
            <div className="text-xs text-muted">For Trinitas-Cleaners employees only</div>
          </div>
        </div>

        {/* Posts */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto bg-slate-50/60 p-5 space-y-4"
        >
          {loading ? (
            <div className="empty-state">Loading the community…</div>
          ) : unauthorized ? (
            <div className="empty-state">
              <p className="font-semibold text-ink">Your employee session is no longer active.</p>
              <p className="mt-1 text-sm text-muted">Please sign in again to see the community.</p>
              <Link href="/login" className="btn btn-primary mt-4">
                Go to sign in
              </Link>
            </div>
          ) : error ? (
            <div className="empty-state" role="alert">
              <p className="font-semibold text-ink">{ERROR_TITLE}</p>
              <p className="mt-1 text-sm text-muted">
                This is a temporary problem, not an empty community. Please try again.
              </p>
              <button className="btn btn-outline mt-3" onClick={reload}>
                <RotateCcw size={15} /> Retry
              </button>
            </div>
          ) : (
            <>
              {page.hasMore && (
                <div className="text-center">
                  <button className="btn btn-outline btn-sm" onClick={onLoadOlder} disabled={paging}>
                    <RefreshCw size={14} /> {paging ? "Loading…" : "Load older posts"}
                  </button>
                </div>
              )}

              {shown.length === 0 ? (
                <div className="empty-state">
                  <MessagesSquare size={36} className="mx-auto text-slate-300" />
                  <p className="mt-3 font-semibold text-ink">{EMPTY_TITLE}</p>
                  <p className="mt-1 text-sm text-muted">{EMPTY_BODY}</p>
                </div>
              ) : (
                shown.map((m) => (
                  <div key={m.id} className="flex">
                    <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-bl-sm border border-line bg-white px-4 py-2.5 text-sm text-ink">
                      <div className="text-[11px] text-muted">
                        {/* Plain text, never a profile link: this phase builds no
                            employee profiles. */}
                        <span className="font-semibold text-ink">
                          {isOwnPost(m, user?.id) ? "You" : authorLabel(m)}
                        </span>
                        {" · "}
                        {new Date(m.createdAt).toLocaleString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words">{m.content}</p>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* Blocked notice: local page state only — the reader keeps full read access. */}
        {blocked && (
          <div
            role="status"
            className="border-b border-amber-200 bg-warnbg px-5 py-3 text-sm text-amber-700"
          >
            You&apos;re currently blocked from posting to the employee community. You can still
            read everything the team has posted.
          </div>
        )}

        {/* Composer */}
        <form className="border-t border-line p-3.5 bg-white" onSubmit={submit}>
          <label htmlFor="employee-community-draft" className="sr-only">
            Message to the employee community
          </label>
          <textarea
            id="employee-community-draft"
            className="textarea w-full"
            rows={2}
            maxLength={COMMUNITY_MESSAGE_MAX_LENGTH}
            placeholder="Share something with the team…"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (sendError) setSendError("");
              if (rateLimited) setRateLimited(false);
            }}
            disabled={sending || blocked}
          />
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              className="btn btn-primary w-full sm:w-auto"
              disabled={sending || blocked || !draft.trim()}
            >
              <Send size={16} /> {sending ? "Sending…" : "Send"}
            </button>
            <div className="text-right" aria-live="polite">
              {rateLimited ? (
                <p className="form-error mb-1">
                  You&apos;ve sent too many messages. Please wait a minute and try again — your
                  message is saved.
                </p>
              ) : (
                sendError && <p className="form-error mb-1">{sendError}</p>
              )}
              <p className="text-xs text-muted">
                {draft.length}/{COMMUNITY_MESSAGE_MAX_LENGTH} characters
              </p>
            </div>
          </div>
        </form>
      </div>
    </Shell>
  );
}
