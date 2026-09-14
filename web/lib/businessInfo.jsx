"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  FALLBACK_BUSINESS,
  FALLBACK_AREAS,
  resolveBusiness,
  resolveAreas,
} from "@/lib/businessInfoData";

const BusinessInfoContext = createContext(null);

// Shared client-side source of truth for admin-controlled Business Information
// and Service Areas. Initial state is the exact fallback content so pages never
// render blank; successful responses hydrate over it and failures keep it.
export function BusinessInfoProvider({ children }) {
  const [state, setState] = useState({
    business: FALLBACK_BUSINESS,
    areas: FALLBACK_AREAS,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [bizRes, areasRes] = await Promise.allSettled([
        api("/business-information"),
        api("/service-areas"),
      ]);
      if (cancelled) return;
      const business =
        bizRes.status === "fulfilled" && bizRes.value
          ? resolveBusiness(bizRes.value.business)
          : FALLBACK_BUSINESS;
      const areas =
        areasRes.status === "fulfilled" && areasRes.value
          ? resolveAreas(areasRes.value.areas)
          : FALLBACK_AREAS;
      setState({ business, areas, loading: false });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BusinessInfoContext.Provider value={{ ...state }}>
      {children}
    </BusinessInfoContext.Provider>
  );
}

export function useBusinessInfo() {
  const ctx = useContext(BusinessInfoContext);
  if (!ctx) throw new Error("useBusinessInfo must be used within BusinessInfoProvider");
  return ctx;
}