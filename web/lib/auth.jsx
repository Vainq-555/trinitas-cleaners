"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const heartbeatRef = useRef(null);

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

  useEffect(() => {
    refresh().finally(() => setLoading(false));

    // Keeps the user marked "online" for the admin monitoring dashboard.
    heartbeatRef.current = setInterval(async () => {
      try {
        await api("/auth/heartbeat", { method: "POST" });
      } catch {
        /* ignore */
      }
    }, 60_000);

    return () => clearInterval(heartbeatRef.current);
  }, [refresh]);

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

// Wrapper for customer-only pages. Redirects to /login.
export function RequireCustomer({ children }) {
  const { user, loading } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) window.location.href = "/login";
      else if (user.role !== "customer") window.location.href = "/admin";
      else setChecked(true);
    }
  }, [user, loading]);

  if (loading || !checked) return <PageLoader />;
  return children;
}

// Wrapper for admin-only pages. Redirects to /admin/login.
export function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) window.location.href = "/login";
      else if (user.role !== "admin") window.location.href = "/dashboard";
      else setChecked(true);
    }
  }, [user, loading]);

  if (loading || !checked) return <PageLoader />;
  return children;
}

export function PageLoader() {
  return <div className="loader-wrap"><div className="loader" /></div>;
}