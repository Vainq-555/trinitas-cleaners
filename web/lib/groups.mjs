/**
 * Customer Groups pure UI logic (customer dashboard).
 *
 * Pure, browser-free module (no React, no fetch, no DOM, no timers) so the
 * Groups pages' data rules can be unit-tested with plain Node. It mirrors the
 * server's G1b–G1d contract: newest-first feeds, opaque cursor pagination,
 * public groups only, and soft-deleted group messages. Where a pure helper
 * already exists for Community V1, it is reused rather than duplicated.
 */

import { contentError, mergeNewest, appendOlder, chronological } from "./community.mjs";

export const GROUPS_LIMIT_DEFAULT = 50;
export const GROUPS_LIMIT_MAX = 100;
export const GROUP_NAME_MAX = 100;
export const GROUP_DESCRIPTION_MAX = 500;
export const GROUP_MESSAGE_MAX = 1000;

// ---------------------------------------------------------------------------
// Limits & query building
// ---------------------------------------------------------------------------

export function isValidGroupsLimit(n) {
  return Number.isInteger(n) && n >= 1 && n <= GROUPS_LIMIT_MAX;
}

export function groupsQuery(input = {}) {
  const { limit = GROUPS_LIMIT_DEFAULT, before } = input ?? {};
  if (!isValidGroupsLimit(limit)) return null;
  const q = { limit };
  if (before) q.before = before;
  return q;
}

// ---------------------------------------------------------------------------
// Field validation (client-side UX only — backend is always authoritative)
// ---------------------------------------------------------------------------

export function validateGroupName(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Group name is required.";
  }
  if (value.trim().length > GROUP_NAME_MAX) {
    return `Group names are limited to ${GROUP_NAME_MAX} characters.`;
  }
  return null;
}

export function validateGroupDescription(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "Group description must be text.";
  const clean = value.trim();
  if (clean.length > GROUP_DESCRIPTION_MAX) {
    return `Group descriptions are limited to ${GROUP_DESCRIPTION_MAX} characters.`;
  }
  return null;
}

// Re-use the identical 1000-character Community V1 rule for group messages.
export const validateGroupMessage = contentError;

// ---------------------------------------------------------------------------
// Group / message feed helpers — newest-first, dedup, append
// ---------------------------------------------------------------------------

export const mergeGroupMessages = mergeNewest;
export const appendOlderGroupMessages = appendOlder;
export const chronologicalGroupMessages = chronological;

// ---------------------------------------------------------------------------
// Member helpers — joinedAt DESC, userId DESC
// ---------------------------------------------------------------------------

export function memberNewestFirst(a, b) {
  const ta = new Date(a.joinedAt).getTime();
  const tb = new Date(b.joinedAt).getTime();
  if (ta !== tb) return tb - ta;
  return a.userId < b.userId ? 1 : a.userId > b.userId ? -1 : 0;
}

export function mergeGroupMembers(existing, incoming) {
  const byId = new Map();
  for (const m of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (m && typeof m.userId === "string") byId.set(m.userId, m);
  }
  return [...byId.values()].sort(memberNewestFirst);
}

export const appendOlderGroupMembers = mergeGroupMembers;

// ---------------------------------------------------------------------------
// Membership & ownership selectors
// ---------------------------------------------------------------------------

export function ownerControls(userId, ownerId) {
  return Boolean(userId && ownerId && userId === ownerId);
}

export function applyMembership(prevJoined, result) {
  if (result && result.joined === true) return true;
  if (result && result.left === true) return false;
  return Boolean(prevJoined);
}

// ---------------------------------------------------------------------------
// Error status mapping
// ---------------------------------------------------------------------------

export function isBlockedError(err) {
  return Boolean(err && err.status === 403 && /blocked/i.test(err.message || ""));
}

export function isRateLimitError(err) {
  return Boolean(err && err.status === 429);
}

export function isNotFoundError(err) {
  return Boolean(err && err.status === 404);
}

export function groupErrorText(status) {
  switch (status) {
    case 401: return "Your session has expired. Please sign in and try again.";
    case 403: return "You don\u2019t have permission to do that.";
    case 404: return "This group is no longer available.";
    case 429: return "You\u2019ve sent too many requests. Please wait a minute and try again.";
    default: return "Something went wrong. Please try again.";
  }
}

// ---------------------------------------------------------------------------
// Safe field accessors
// ---------------------------------------------------------------------------

export function isDeletedMessage(message) {
  return Boolean(message) && (message.deleted === true || message.content === null);
}

export function messageDisplayText(message) {
  if (!message) return "";
  if (isDeletedMessage(message)) return "(deleted)";
  return typeof message.content === "string" ? message.content : "";
}

export function memberName(member) {
  return member?.user?.name || "Community member";
}

export function memberAvatarUrl(member) {
  return member?.user?.avatarUrl ?? null;
}

export function isOnlineMember(member) {
  return member?.user?.online === true;
}
