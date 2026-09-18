// Pure validation + privacy helpers for Community profiles (V2 Phase 1).
// No DOM, no imports from React: kept unit-testable via node --test.

export const PROFILE_DISPLAY_NAME_MAX = 100;
export const PROFILE_BIO_MAX = 500;
export const PROFILE_CITY_MAX = 80;
export const ONLINE_TTL_MS = 5 * 60 * 1000;

// Keys a stranger may ever see on a public profile, plus the optional online
// flag. Anything else (account/role/admin fields) is unauthorized.
export const PUBLIC_PROFILE_KEYS = new Set([
  "userId",
  "displayName",
  "bio",
  "avatarUrl",
  "locationCity",
  "locationState",
  "online",
]);

// HTTPS-only avatar check (mirrors the API). Accepts bare https URLs without
// embedded credentials. Returns true/false; does not store anything.
export function isValidAvatarUrl(v) {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v !== "string") return false;
  let u;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return u.hostname.length > 0;
}

// displayName: required, trimmed to 1..100 chars.
export function normalizeDisplayName(v) {
  if (typeof v !== "string") return { error: "Display name is required" };
  const trimmed = v.trim();
  if (trimmed.length < 1) return { error: "Display name is required" };
  if (trimmed.length > PROFILE_DISPLAY_NAME_MAX) {
    return { error: `Display name must be ${PROFILE_DISPLAY_NAME_MAX} characters or fewer` };
  }
  return { value: trimmed };
}

// bio: optional, trimmed, 0..500 chars. Whitespace-only clears to null.
export function normalizeBio(v) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: "Bio must be text" };
  const trimmed = v.trim();
  if (trimmed.length > PROFILE_BIO_MAX) {
    return { error: `Bio must be ${PROFILE_BIO_MAX} characters or fewer` };
  }
  return { value: trimmed === "" ? null : trimmed };
}

// city: optional, trimmed, 1..80 chars; whitespace-only clears to null.
export function normalizeCity(v) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: "City must be text" };
  const trimmed = v.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > PROFILE_CITY_MAX) {
    return { error: `City must be ${PROFILE_CITY_MAX} characters or fewer` };
  }
  return { value: trimmed };
}

// state: optional, exactly two letters (case-insensitive), uppercased.
export function normalizeState(v) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: "State must be a two-letter code" };
  const trimmed = v.trim();
  if (trimmed === "") return { value: null };
  if (!/^[A-Za-z]{2}$/.test(trimmed)) return { error: "State must be a two-letter code" };
  return { value: trimmed.toUpperCase() };
}

// avatarUrl: optional https URL. null/undefined/empty/whitespace clears to
// null (no avatar); a valid https URL is trimmed; anything else errors.
// Never calls .trim() unless v is already a string.
export function normalizeAvatarUrl(v) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: "Avatar must be a valid https URL" };
  const trimmed = v.trim();
  if (trimmed === "") return { value: null };
  return isValidAvatarUrl(trimmed) ? { value: trimmed } : { error: "Avatar must be a valid https URL" };
}

export function isValidBoolean(v, label) {
  return typeof v === "boolean" ? { value: v } : { error: `${label} must be enabled or disabled` };
}

// Whole-form validation for the editor. body is the raw client object; returns
// { values } or { error }. Ignores unknown/immutable keys entirely.
export function validateProfileDraft(body = {}) {
  const values = {};
  const pairs = [
    ["displayName", normalizeDisplayName],
    ["bio", normalizeBio],
    ["avatarUrl", normalizeAvatarUrl],
    ["locationCity", normalizeCity],
    ["locationState", normalizeState],
    ["showOnline", (v) => isValidBoolean(v, "Show online")],
    ["profileVisible", (v) => isValidBoolean(v, "Profile visibility")],
  ];
  for (const [key, fn] of pairs) {
    if (body[key] === undefined) continue;
    const out = fn(body[key]);
    if (out.error) return { error: out.error };
    values[key] = out.value;
  }
  if (Object.keys(values).length === 0) return { error: "No editable profile fields provided" };
  return { values };
}

// Coarse online/offline from an epoch millis heartbeat. Never a timestamp.
export function isOnlineFromLastActive(lastActiveMs) {
  if (typeof lastActiveMs !== "number" || !Number.isFinite(lastActiveMs)) return false;
  return Date.now() - lastActiveMs < ONLINE_TTL_MS;
}

// Coarse online from a public profile row as served by the API (which already
// gates on showOnline + visibility + not-hidden server-side).
export function onlineOf(profile) {
  if (!profile || profile.online === undefined) return null;
  return profile.online === true;
}

// Snapshot a public profile into only the approved public keys, re-validated
// client-side. Drops anything else defensively (defense in depth).
export function toPublicShape(profile) {
  if (!profile || typeof profile !== "object") return null;
  const out = {};
  for (const key of PUBLIC_PROFILE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(profile, key)) out[key] = profile[key];
  }
  return out;
}

// Allowed editable keys for the own-profile editor PUT body.
export const OWN_EDITABLE_KEYS = [
  "displayName",
  "bio",
  "avatarUrl",
  "locationCity",
  "locationState",
  "showOnline",
  "profileVisible",
];

export function toOwnPayload(draft) {
  const payload = {};
  for (const key of OWN_EDITABLE_KEYS) {
    if (draft[key] !== undefined) payload[key] = draft[key];
  }
  return payload;
}