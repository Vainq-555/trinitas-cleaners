"use client";

// Loads the employee's own announcements from the existing employee endpoint.
//
// `GET /employee/broadcasts` is already scoped server-side to the session
// employee AND to the employee audience, so this hook is a plain fetch wrapper:
// it never filters, widens or re-authorizes anything, and never fabricates a
// list. Its only jobs are to report the request state honestly and to let the
// employee mark their OWN read state.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isUnread } from "@/lib/employeeBroadcasts.mjs";

export function useEmployeeBroadcasts() {
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [markingId, setMarkingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return api("/employee/broadcasts")
      .then((data) => {
        setBroadcasts(Array.isArray(data?.broadcasts) ? data.broadcasts : []);
        return data;
      })
      .catch((err) => {
        setError(err);
        setBroadcasts([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Mark one announcement read.
  //
  // The id is the server's own broadcast id and the user is always the session
  // user — there is no user id in this request, so an employee cannot mark
  // another user's read state even by editing the call. The server independently
  // re-checks that this announcement is visible to this employee and 404s
  // otherwise, so this is convenience, not the security boundary.
  const markRead = useCallback(async (id) => {
    setMarkingId(id);
    try {
      await api(`/employee/broadcasts/${id}/read`, { method: "POST" });
      setBroadcasts((prev) => prev.map((b) => (b.id === id ? { ...b, read: true } : b)));
    } catch (err) {
      // Leave the item unread rather than pretending it was marked, and surface
      // nothing misleading.
      setError(err);
    } finally {
      setMarkingId(null);
    }
  }, []);

  // A 401/403 means this session is no longer authorized as an employee (e.g. the
  // account was disabled). Shown as a sign-in prompt, never as "no
  // announcements", so a revoked session never looks like an empty inbox.
  const unauthorized = error?.status === 401 || error?.status === 403;

  return {
    broadcasts,
    loading,
    error,
    unauthorized,
    reload: load,
    markRead,
    markingId,
    hasUnread: broadcasts.some(isUnread),
  };
}
