"use client";

// Loads the shifts the admin has published for the employee pool, and submits
// this employee's own request for one.
//
// `GET /employee/shifts` is already scoped server-side: it returns only
// published, unexpired, accepted, unassigned-or-own shifts, and it attaches
// `myRequest` so the page needs no second lookup to show a request status.
//
// This hook never filters, widens or re-authorizes anything. It sends no
// employee id, so there is no client-side way to request on someone else's
// behalf, and `canRequest` is taken from the server rather than recomputed here.
//
// Authorization is inherited from app/employee/layout.jsx (`RequireEmployee`).

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { canRequestShift } from "@/lib/employeeShifts.mjs";

export function useEmployeeShifts() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requestingId, setRequestingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return api("/employee/shifts")
      .then((data) => {
        setShifts(Array.isArray(data?.shifts) ? data.shifts : []);
        return data;
      })
      .catch((err) => {
        setError(err);
        setShifts([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Ask for a shift. This is a REQUEST: the server records it as "requested" and
  // assigns nobody. The employee is not told, and never told, that requesting
  // means they will get the work.
  const requestShift = useCallback(
    async (shiftId, note) => {
      setRequestingId(shiftId);
      setError(null);
      try {
        const data = await api(`/employee/shifts/${encodeURIComponent(shiftId)}/request`, {
          method: "POST",
          body: note ? { note } : {},
        });
        // Reflect the server's own answer: the row's myRequest/canRequest are
        // replaced by a reload so the page can never show a state the server
        // did not actually return.
        await load();
        return data.request;
      } catch (err) {
        setError(err);
        return null;
      } finally {
        setRequestingId(null);
      }
    },
    [load],
  );

  const unauthorized = error?.status === 401 || error?.status === 403;

  return {
    shifts,
    loading,
    error,
    unauthorized,
    requestingId,
    reload: load,
    requestShift,
    requestableCount: shifts.filter(canRequestShift).length,
    hasOpenRequest: shifts.some((s) => Boolean(s.myRequest)),
  };
}
