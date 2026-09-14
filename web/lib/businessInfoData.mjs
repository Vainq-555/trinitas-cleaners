// Exact current public business facts. These are the safe fallbacks used until
// an admin-controlled BusinessInfo / ServiceArea record exists (or whenever the
// API is unavailable). They reproduce the pre-Phase-3 hardcoded values exactly.
export const FALLBACK_BUSINESS = {
  businessName: "Trinitas-Cleaners",
  phone: "1 763-620-4955",
  email: "trinitascleaner@gmail.com",
  addressLine1: null,
  city: "Anoka",
  state: "MN",
  postalCode: "55303",
  hoursWeek: "Monday – Saturday · 8:00 AM – 6:00 PM",
  hoursWeekend: "Sunday · Closed",
  responseTime: "Replies within one business day",
};

export const FALLBACK_AREA = {
  name: "Anoka",
  city: "Anoka",
  state: "MN",
  postalCode: "55303",
  order: 0,
  isActive: true,
  description:
    "Proudly serving Anoka, MN 55303 and surrounding communities. Coverage can vary by location.",
};

export const FALLBACK_AREAS = [FALLBACK_AREA];

const STATE_NAMES = { MN: "Minnesota" };

export function stateName(code) {
  return typeof code === "string" ? STATE_NAMES[code] || code : "";
}

// tel:17636204955 from "1 763-620-4955"; null when no digits are available.
export function telHref(phone) {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  return digits ? `tel:${digits}` : null;
}

// Resolve an API business record against the exact fallbacks so optional or
// missing values never produce blank customer-facing sections.
export function resolveBusiness(biz) {
  if (!biz || typeof biz !== "object" || Array.isArray(biz)) return { ...FALLBACK_BUSINESS };
  const out = {};
  for (const key of Object.keys(FALLBACK_BUSINESS)) {
    const value = biz[key];
    out[key] = value === undefined || value === null ? FALLBACK_BUSINESS[key] : value;
  }
  return out;
}

// Active areas sorted by order ASC then name ASC. Empty / inactive / missing
// lists fall back to the exact Anoka area so content is never blank.
export function resolveAreas(areas) {
  if (!Array.isArray(areas) || areas.length === 0) return FALLBACK_AREAS.map((a) => ({ ...a }));
  const active = areas.filter((a) => a && a.isActive !== false);
  if (active.length === 0) return FALLBACK_AREAS.map((a) => ({ ...a }));
  return active
    .map((a) => ({ ...a }))
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        String(a.name || "").localeCompare(String(b.name || "")),
    );
}

// "Anoka, MN 55303"
export function formatAddress(b) {
  const { city = "", state = "", postalCode = "" } = b || {};
  const location = [state, postalCode].filter(Boolean).join(" ");
  return [city, location].filter(Boolean).join(", ").trim();
}

// "Anoka, Minnesota 55303"
export function formatAddressLong(b) {
  const { city = "", state = "", postalCode = "" } = b || {};
  const location = [stateName(state), postalCode].filter(Boolean).join(" ");
  return [city, location].filter(Boolean).join(", ").trim();
}

const DAY_ABBR = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

// "Monday – Saturday · 8:00 AM – 6:00 PM" -> "Mon–Sat · 8 AM – 6 PM"
export function compactHours(hoursWeek) {
  if (typeof hoursWeek !== "string" || !hoursWeek.trim()) return "";
  const parts = hoursWeek.split("·");
  if (parts.length < 2) return hoursWeek;
  let days = parts[0].trim();
  for (const [full, abbr] of Object.entries(DAY_ABBR)) days = days.split(full).join(abbr);
  days = days.replace(/\s*–\s*/g, "–");
  const times = parts
    .slice(1)
    .join("·")
    .trim()
    .replace(/:00/g, "");
  return [days, times].filter(Boolean).join(" · ");
}

// "Monday – Saturday · 8:00 AM – 6:00 PM" -> { days, time }; null if not splittable.
export function splitHoursRow(str) {
  if (typeof str !== "string") return null;
  const parts = str.split("·").map((p) => p.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { days: parts[0], time: parts.slice(1).join(" · ").trim() };
}