"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  APPEARANCE_KEY,
  effectiveFor,
  parseStored,
  readStored,
  systemPrefersDark,
  applyDark,
} from "@/lib/appearanceMode.mjs";

const AppearanceContext = createContext(null);

export function AppearanceProvider({ children }) {
  const pathname = usePathname();

  const [mode, setMode] = useState(() =>
    typeof window === "undefined" ? "system" : readStored()
  );
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === "undefined" ? false : systemPrefersDark()
  );

  useEffect(() => {
    applyDark(effectiveFor(pathname, mode, systemDark) === "dark");
  }, [pathname, mode, systemDark]);

  useEffect(() => {
    if (mode !== "system") return;
    const mq =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    if (!mq || typeof mq.addEventListener !== "function") return;
    const onChange = () => setSystemDark(systemPrefersDark());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setAppearance = useCallback((next) => {
    const normalized = parseStored(next);
    try {
      localStorage.setItem(APPEARANCE_KEY, normalized);
    } catch {
      // storage unavailable; still apply the mode for this session
    }
    setMode(normalized);
  }, []);

  return (
    <AppearanceContext.Provider value={{ mode, setAppearance }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error("useAppearance must be used within an AppearanceProvider");
  }
  return ctx;
}