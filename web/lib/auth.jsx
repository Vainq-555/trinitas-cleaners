"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  HEARTBEAT_INTERVAL_MS,
  heartbeatDelayAfter,
} from "./requestResilience.mjs";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const heartbeatTimerRef = useRef(null);
  const heartbeatInFlightRef = useRef(false);
  const heartbeatAttemptRef = useRef(0);
  const heartbeatUserRef = useRef(null);
  const mountedRef = useRef(true);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api("/auth/me");
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  const runHeartbeat = useCallback(async () => {
    heartbeatTimerRef.current = null;
    if (!mountedRef.current || !heartbeatUserRef.current || heartbeatInFlightRef.current) return;
    heartbeatInFlightRef.current = true;

    try {
      await api("/auth/heartbeat", { method: "POST" });
      heartbeatAttemptRef.current = 0;
      if (mountedRef.current && heartbeatUserRef.current) {
        heartbeatTimerRef.current = setTimeout(runHeartbeat, HEARTBEAT_INTERVAL_MS);
      }
    } catch (err) {
      if (!mountedRef.current || !heartbeatUserRef.current) return;

      const delay = heartbeatDelayAfter({
        ok: false,
        status: err?.status,
        retryAfterMs: err?.retryAfterMs,
        attempt: heartbeatAttemptRef.current,
      });
      if (delay === null) {
        setUser(null);
        return;
      }

      heartbeatAttemptRef.current = Math.min(heartbeatAttemptRef.current + 1, 10);
      heartbeatTimerRef.current = setTimeout(runHeartbeat, delay);
    } finally {
      heartbeatInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHeartbeat();
    };
  }, [clearHeartbeat]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    heartbeatUserRef.current = user;
    clearHeartbeat();
    heartbeatAttemptRef.current = 0;

    // Only authenticated sessions need presence heartbeats. A recursive timeout
    // (rather than setInterval) prevents a slow request from overlapping the next
    // one, and a retryable failure backs off instead of firing at a fixed rate.
    if (!user) return undefined;
    if (!heartbeatInFlightRef.current) {
      heartbeatTimerRef.current = setTimeout(runHeartbeat, HEARTBEAT_INTERVAL_MS);
    }
    return clearHeartbeat;
  }, [user, clearHeartbeat, runHeartbeat]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Role → home destination. The single source of truth for post-login routing.
// `customer` and `admin` keep their existing destinations EXACTLY as before; the
// new `employee` role gets its own destination, so an employee can never be
// routed into the customer or admin portal (which would bounce them back and
// risk a redirect loop).
export const ROLE_HOME = {
  customer: "/dashboard",
  admin: "/admin",
  employee: "/employee",
};

export function homeForRole(role) {
  return ROLE_HOME[role] || "/dashboard";
}

// Wrapper for customer-only pages. Redirects to /login.
export function RequireCustomer({ children }) {
  const { user, loading } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) window.location.href = "/login";
      // Wrong role → that role's own home. For admin this is still "/admin" and
      // for an unrecognized role "/dashboard", i.e. the previous behavior; only
      // the new employee role is routed differently (to "/employee").
      else if (user.role !== "customer") window.location.href = homeForRole(user.role);
      else setChecked(true);
    }
  }, [user, loading]);

  if (loading || !checked) return <PageLoader />;
  return children;
}

// Wrapper for admin-only pages. Redirects to /login.
export function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) window.location.href = "/login";
      else if (user.role !== "admin") window.location.href = homeForRole(user.role);
      else setChecked(true);
    }
  }, [user, loading]);

  if (loading || !checked) return <PageLoader />;
  return children;
}

// Wrapper for employee-only pages. Separate from RequireCustomer/RequireAdmin:
// a customer or admin landing here is sent to their own home, and an employee
// reaching a customer-only or admin-only page is denied by those guards. There is
// no role hierarchy — employee is never treated as a customer or an admin.
export function RequireEmployee({ children }) {
  const { user, loading } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) window.location.href = "/login";
      else if (user.role !== "employee") window.location.href = homeForRole(user.role);
      else setChecked(true);
    }
  }, [user, loading]);

  if (loading || !checked) return <PageLoader />;
  return children;
}

export function PageLoader() {
  return <div className="loader-wrap"><div className="loader" /></div>;
}