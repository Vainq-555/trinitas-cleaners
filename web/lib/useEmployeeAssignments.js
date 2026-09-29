"use client";

// Loads the employee's own assignments from the existing endpoint.
//
// `GET /employee/assignments` is already server-scoped to the session employee
// and filtered to `visibleToEmployee = true`, so this hook is a plain fetch
// wrapper: it never filters, widens or re-authorizes anything, and it never
// fabricates a list. Its only job is to report the three states honestly —
// loading, failed, loaded — so a page can never show "no services assigned"
// while a request is still in flight or after one has failed.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useEmployeeAssignments() {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return api("/employee/assignments")
      .then((data) => {
        setAssignments(Array.isArray(data?.assignments) ? data.assignments : []);
        return data;
      })
      .catch((err) => {
        setError(err);
        setAssignments([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A 401/403 means this session is no longer authorized as an employee (e.g. the
  // account was disabled). The page shows a sign-in prompt instead of an empty
  // list, so a revoked session never looks like "no work".
  const unauthorized = error?.status === 401 || error?.status === 403;

  return { assignments, loading, error, unauthorized, reload: load };
}
