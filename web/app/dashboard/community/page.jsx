"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Home, CalendarCheck, Sparkles, ReceiptText, MessageSquare, Settings, Star,
  Users, Send, RefreshCw, UserRound,
} from "lucide-react";
import Shell from "@/components/Shell";
import { api, fmtDateTime } from "@/lib/api";
import {
  COMMUNITY_LIMIT_DEFAULT,
  contentError,
  feedQuery,
  mergeNewest,
  appendOlder,
  chronological,
} from "@/lib/community";

const links = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/dashboard/bookings", label: "My Bookings", icon: CalendarCheck },
  { href: "/dashboard/reviews", label: "My Reviews", icon: Star },
  { href: "/dashboard/services", label: "Book a Service", icon: Sparkles },
  { href: "/dashboard/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/dashboard/messages", label: "Message Admin", icon: MessageSquare },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const toQuery = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p.toString();
};

export default function CommunityPage() {
  // `messages` is kept newest-first (server order); rendered reversed below.
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextBefore: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [paging, setPaging] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [rateLimited, setRateLimited] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [sending, setSending] = useState(false);

  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const pollingRef = useRef(false);
  const [loadAnchor, setLoadAnchor] = useState(null);

  const scrollToBottom = (behavior = "auto") => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Initial load: newest 100. Only this call and Load Older touch pagination
  // state, so a poll can never re-open an already-fully-loaded older edge.
  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const q = toQuery(feedQuery({ limit: 100 }));
      const data = await api(`/community/messages?${q}`);
      setMessages(data.messages || []);
      setPage({ hasMore: data.hasMore, nextBefore: data.nextBefore });
      atBottomRef.current = true;
      scrollToBottom();
    } catch (err) {
      setLoadError(err.message || "Couldn't load the community. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Poll: newest 50 every 10s, merged in place. Never resets the conversation,
  // never touches pagination, and skips overlapping requests.
  const refreshNewest = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const q = toQuery(feedQuery({ limit: COMMUNITY_LIMIT_DEFAULT }));
      const data = await api(`/community/messages?${q}`);
      setMessages((prev) => mergeNewest(prev, data.messages));
    } catch {
      // Silent poll failures: the next tick (or a manual retry) recovers.
    } finally {
      pollingRef.current = false;
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refreshNewest();
    }, 10000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshNewest();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Keep the user's place when an older page is prepended. Runs before the
  // scroll-to-bottom effect so content doesn't jump while paging upward.
  useEffect(() => {
    if (loadAnchor && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = loadAnchor.scrollTop + (el.scrollHeight - loadAnchor.scrollHeight);
      setLoadAnchor(null);
    }
  }, [loadAnchor, messages]);

  // Auto-follow only when the reader is already at (or near) the bottom.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom("smooth");
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    if (paging || !page.nextBefore) return;
    setPaging(true);
    const el = scrollRef.current;
    setLoadAnchor(el ? { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop } : null);
    try {
      const q = toQuery(feedQuery({ limit: COMMUNITY_LIMIT_DEFAULT, before: page.nextBefore }));
      const data = await api(`/community/messages?${q}`);
      setMessages((prev) => appendOlder(prev, data.messages));
      setPage({ hasMore: data.hasMore, nextBefore: data.nextBefore });
    } catch (err) {
      setDraftError(err.message || "Couldn't load older messages. Please try again.");
    } finally {
      setPaging(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (sending || blocked) return;
    const problem = contentError(draft);
    if (problem) {
      setDraftError(problem);
      return;
    }
    setSending(true);
    setDraftError("");
    setRateLimited(false);
    try {
      await api("/community/messages", { method: "POST", body: { content: draft.trim() } });
      setDraft("");
      atBottomRef.current = true;
      refreshNewest();
    } catch (err) {
      if (err.status === 403 && /blocked from posting/i.test(err.message || "")) {
        setBlocked(true);
      } else if (err.status === 429) {
        setRateLimited(true); // keep the draft so the user can retry later
      } else if (err.status === 400) {
        setDraftError(err.message || "That message couldn't be sent.");
      } else {
        setDraftError("Something went wrong sending your message. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  const onDraftChange = (value) => {
    setDraft(value);
    if (draftError) setDraftError("");
    if (rateLimited) setRateLimited(false);
  };

  const shown = chronological(messages);

  return (
    <Shell links={links} sections={["Customer Portal"]} title="Community"
      subtitle="Talk with other Trinitas-Cleaners customers about life and home.">
      <div className="card overflow-hidden flex flex-col" style={{ height: "calc(100vh - 220px)", minHeight: 420 }}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-clean-light text-clean">
            <Users size={18} />
          </span>
          <div>
            <div className="font-bold text-ink">Customer Community</div>
            <div className="text-xs text-muted">A shared space for all Trinitas-Cleaners customers</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Link
              href="/dashboard/community/groups"
              className="inline-flex items-center gap-1.5 rounded-full bg-clean-light px-3 py-1.5 text-xs font-semibold text-clean hover:underline"
            >
              <Users size={14} /> Browse groups
            </Link>
            <Link
              href="/dashboard/profile"
              className="inline-flex items-center gap-1.5 rounded-full bg-clean-light px-3 py-1.5 text-xs font-semibold text-clean hover:underline"
            >
              <UserRound size={14} /> Your profile
            </Link>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto bg-slate-50/60 p-5 space-y-4">
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
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={loadOlder}
                    disabled={paging}
                  >
                    <RefreshCw size={14} /> {paging ? "Loading…" : "Load older messages"}
                  </button>
                </div>
              )}

              {shown.length === 0 ? (
                <div className="empty-state">
                  <p className="font-semibold text-ink">No messages yet.</p>
                  <p className="text-sm">Be the first to say hello below!</p>
                </div>
              ) : (
                shown.map((m) => (
                  <div key={m.id} className="flex">
                    <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-bl-sm bg-white border border-line px-4 py-2.5 text-sm text-ink">
                      <div className="text-[11px] text-muted">
                        {m.customer?.id ? (
                          <Link href={`/dashboard/profile/${encodeURIComponent(m.customer.id)}`} className="font-semibold text-ink hover:underline">
                            {m.customer?.name || "Community member"}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink">{m.customer?.name || "Community member"}</span>
                        )}
                        {" · "}
                        {fmtDateTime(m.createdAt)}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words">{m.content}</p>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* Blocked notice: local page state only — the reader keeps full access. */}
        {blocked && (
          <div role="status" className="border-b border-amber-200 bg-warnbg px-5 py-3 text-sm text-amber-700">
            You're currently blocked from posting to the community. You can still
            read messages from other customers.
          </div>
        )}

        {/* Composer */}
        <form className="border-t border-line p-3.5 bg-white" onSubmit={submit}>
          <label htmlFor="community-draft" className="sr-only">Message to the community</label>
          <textarea
            id="community-draft"
            className="textarea w-full"
            rows={2}
            maxLength={1000}
            placeholder="Share something with the community…"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            disabled={sending || blocked}
          />
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button className="btn btn-primary w-full sm:w-auto" disabled={sending || blocked || !draft.trim()}>
              <Send size={16} /> {sending ? "Sending…" : "Send"}
            </button>
            <div className="text-right" aria-live="polite">
              {rateLimited && <p className="form-error mb-1">You've sent too many messages. Please wait a minute and try again — your message is saved.</p>}
              {draftError && !rateLimited && <p className="form-error mb-1">{draftError}</p>}
              <p className="text-xs text-muted">{draft.length}/{1000} characters</p>
            </div>
          </div>
        </form>
      </div>
    </Shell>
  );
}