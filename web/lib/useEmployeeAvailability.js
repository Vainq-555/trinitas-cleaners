"use client";

// Loads and mutates the employee's OWN availability.
//
// `GET /employee/availability` is already scoped server-side to the session
// employee, and every write here sends no employee id at all — the server always
// uses `req.user.id`. This hook therefore has no way to express "edit someone
// else's availability", which is the point.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useEmployeeAvailability() {
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return api("/employee/availability")
      .then((data) => {
        setAvailability(Array.isArray(data?.availability) ? data.availability : []);
        return data;
      })
      .catch((err) => {
        setError(err);
        setAvailability([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Create. The payload carries only the window; the owner is the session.
  const addWindow = useCallback(async (window) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const data = await api("/employee/availability", { method: "POST", body: window });
      setAvailability((prev) => [...prev, data.availability]);
      setSaved(true);
      return data.availability;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  // Edit. Only the row id and the changed fields are sent — never an employee id.
  const updateWindow = useCallback(async (id, patch) => {
    setSavingId(id);
    setError(null);
    setSaved(false);
    try {
      const data = await api(`/employee/availability/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
      });
      setAvailability((prev) => prev.map((a) => (a.id === id ? data.availability : a)));
      setSaved(true);
      return data.availability;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setSavingId(null);
    }
  }, []);

  const removeWindow = useCallback(async (id) => {
    setSavingId(id);
    setError(null);
    setSaved(false);
    try {
      await api(`/employee/availability/${encodeURIComponent(id)}`, { method: "DELETE" });
      setAvailability((prev) => prev.filter((a) => a.id !== id));
      setSaved(true);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setSavingId(null);
    }
  }, []);

  // A 401/403 means this session is no longer an authorized employee (e.g. the
  // account was disabled). Shown as a sign-in prompt, never as "no availability".
  const unauthorized = error?.status === 401 || error?.status === 403;

  return {
    availability,
    loading,
    error,
    unauthorized,
    saving,
    saved,
    savingId,
    reload: load,
    addWindow,
    updateWindow,
    removeWindow,
  };
}
