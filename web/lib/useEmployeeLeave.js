"use client";

// Loads and creates the employee's OWN leave requests.
//
// `GET /employee/leave` is already scoped server-side to the session employee, and
// `POST /employee/leave` always writes `req.user.id`. The payload below therefore
// carries only dates, an optional kind and an optional note — this hook has no way
// to express "file leave for somebody else", which is the point.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`), and
// the server additionally refuses a disabled employee, since `authenticate`
// rejects a disabled account before any role check.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useEmployeeLeave() {
  const [leave, setLeave] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return api("/employee/leave")
      .then((data) => {
        setLeave(Array.isArray(data?.leave) ? data.leave : []);
        return data;
      })
      .catch((err) => {
        setError(err);
        setLeave([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Create. The payload carries only the request itself; the owner is the session,
  // so no employee id is ever sent from the browser.
  const requestLeave = useCallback(async ({ startsOn, endsOn, kind, note }) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const data = await api("/employee/leave", {
        method: "POST",
        body: { startsOn, endsOn, kind: kind || "", note: note || "" },
      });
      setLeave((prev) => [data.leave, ...prev]);
      setSaved(true);
      return data.leave;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  // A 401/403 means this session is no longer an authorized employee (for example
  // the account was disabled). Shown as a sign-in prompt, never as "no leave".
  const unauthorized = error?.status === 401 || error?.status === 403;

  return {
    leave,
    loading,
    error,
    unauthorized,
    saving,
    saved,
    reload: load,
    requestLeave,
  };
}
