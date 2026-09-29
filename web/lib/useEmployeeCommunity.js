"use client";

// Employee community data hook (Phase 2B-5).
//
// Talks ONLY to the employee endpoints. `GET/POST /employee/community/messages`
// are already scoped server-side to the employee audience, so this hook is a
// plain fetch wrapper: it never filters, widens or re-authorizes anything, and
// never fabricates a list.
//
// There is deliberately no client-side audience parameter anywhere in this file.
// A UI filter is not authorization, and sending one would only give a false
// sense of protection — the server pins the audience and this hook trusts it.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  COMMUNITY_LIMIT_DEFAULT,
  appendOlder,
  contentError,
  feedQuery,
  mergeNewest,
} from "@/lib/employeeCommunity.mjs";

const toQuery = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p.toString();
};

export function useEmployeeCommunity() {
  // `messages` stays newest-first (server order); the page renders it reversed.
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextBefore: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paging, setPaging] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [rateLimited, setRateLimited] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const pollingRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const q = toQuery(feedQuery({ limit: COMMUNITY_LIMIT_DEFAULT }));
    return api(`/employee/community/messages?${q}`)
      .then((data) => {
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
        setPage({ hasMore: Boolean(data?.hasMore), nextBefore: data?.nextBefore ?? null });
      })
      .catch((err) => {
        setError(err);
        setMessages([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll the newest page and merge it in place. Never resets the conversation
  // and never touches pagination state, so a poll can never re-open an
  // already-fully-loaded older edge. Skips overlapping requests, and failures
  // are silent: the next tick (or the manual retry) recovers.
  const refreshNewest = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const q = toQuery(feedQuery({ limit: COMMUNITY_LIMIT_DEFAULT }));
      const data = await api(`/employee/community/messages?${q}`);
      setMessages((prev) => mergeNewest(prev, data.messages));
    } catch {
      /* silent poll failure */
    } finally {
      pollingRef.current = false;
    }
  }, []);

  useEffect(() => {
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
  }, [refreshNewest]);

  const loadOlder = useCallback(async () => {
    if (paging || !page.nextBefore) return;
    setPaging(true);
    try {
      const q = toQuery(feedQuery({ limit: COMMUNITY_LIMIT_DEFAULT, before: page.nextBefore }));
      const data = await api(`/employee/community/messages?${q}`);
      setMessages((prev) => appendOlder(prev, data.messages));
      setPage({ hasMore: Boolean(data?.hasMore), nextBefore: data?.nextBefore ?? null });
    } catch (err) {
      setSendError(err?.message || "Couldn't load older posts. Please try again.");
    } finally {
      setPaging(false);
    }
  }, [page.nextBefore, paging]);

  const submit = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      if (sending || blocked) return;
      const problem = contentError(draft);
      if (problem) {
        setSendError(problem);
        return;
      }
      setSending(true);
      setSendError("");
      setRateLimited(false);
      try {
        // No author id, no employee id, no audience: the server takes the author
        // from the session. Anything sent here would be ignored regardless.
        await api("/employee/community/messages", { method: "POST", body: { content: draft.trim() } });
        setDraft("");
        await refreshNewest();
      } catch (err) {
        if (err?.status === 403 && /blocked from posting/i.test(err?.message || "")) {
          setBlocked(true);
        } else if (err?.status === 429) {
          // Keep the draft so the employee can retry after the window slides.
          setRateLimited(true);
        } else if (err?.status === 400) {
          setSendError(err.message || "That message couldn't be sent.");
        } else {
          setSendError("Something went wrong sending your message. Please try again.");
        }
      } finally {
        setSending(false);
      }
    },
    [blocked, draft, refreshNewest, sending],
  );

  // A 401/403 means this session is no longer authorized as an employee (e.g.
  // the account was disabled). Shown as a sign-in prompt, never as an empty
  // community, so a revoked session never looks like "nothing has been posted".
  const unauthorized = error?.status === 401 || error?.status === 403;

  return {
    messages,
    page,
    loading,
    error,
    unauthorized,
    paging,
    loadOlder,
    reload: load,
    draft,
    setDraft,
    sendError,
    setSendError,
    sending,
    submit,
    rateLimited,
    blocked,
  };
}
