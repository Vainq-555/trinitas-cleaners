/**
 * Community chat pure logic (customer dashboard).
 *
 * Pure, browser-free module (no React, no fetch, no DOM, no timers) so the
 * page's data rules can be unit-tested with plain Node. It mirrors the
 * server's V1 contract: newest-first feeds, createdAt + id cursor pagination,
 * and a 1000-character content cap. The page is still the source of truth for
 * UI state; these helpers only decide ordering/dedup, never perform IO.
 */

export const COMMUNITY_LIMIT_DEFAULT = 50;
export const COMMUNITY_LIMIT_MAX = 100;
export const COMMUNITY_MESSAGE_MAX_LENGTH = 1000;

export function isValidCommunityLimit(n) {
  return Number.isInteger(n) && n >= 1 && n <= COMMUNITY_LIMIT_MAX;
}

// Returns a human-readable validation message for the composer draft, or null
// when the draft is submit-ready. Whitespace-only and over-length content are
// rejected; the message is never silently truncated.
export function contentError(content) {
  if (typeof content !== "string" || content.trim().length === 0) {
    return "Message can't be empty.";
  }
  if (content.trim().length > COMMUNITY_MESSAGE_MAX_LENGTH) {
    return `Messages are limited to ${COMMUNITY_MESSAGE_MAX_LENGTH} characters.`;
  }
  return null;
}

// Builds the query string object for GET /community/messages. Returns null for
// an invalid limit; `before` is optional (omitted when falsy).
export function feedQuery({ limit = COMMUNITY_LIMIT_DEFAULT, before } = {}) {
  if (!isValidCommunityLimit(limit)) return null;
  const q = { limit };
  if (before) q.before = before;
  return q;
}

// Newest first: createdAt desc, then id desc (id breaks ties for identical
// timestamps exactly like the server's cursor ordering).
export function newestFirst(a, b) {
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function mergeLists(existingList, incomingList) {
  const byId = new Map();
  for (const m of [...existingList, ...incomingList]) {
    if (m && typeof m.id === "string") byId.set(m.id, m);
  }
  return [...byId.values()].sort(newestFirst);
}

// Merges a fresh newest-first feed (poll result) into the existing messages.
// New items are folded in, duplicates removed by id, older loaded messages are
// preserved, and the result stays newest-first.
export function mergeNewest(existing, incoming) {
  return mergeLists(Array.isArray(existing) ? existing : [], Array.isArray(incoming) ? incoming : []);
}

// Appends an older page (fetched with ?before=) to the existing messages.
// Same dedup + sort semantics as mergeNewest, so repeatedly paging older pages
// can never duplicate or reorder already-visible messages.
export function appendOlder(existing, older) {
  return mergeLists(Array.isArray(existing) ? existing : [], Array.isArray(older) ? older : []);
}

// Oldest-first display order (oldest visible at the top, newest at the bottom).
// Returns a new array; does not mutate the caller's newest-first list.
export function chronological(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return [...list].sort((a, b) => -newestFirst(a, b));
}