/**
 * Employee community pure view helpers (Phase 2B-5).
 *
 * Pure, browser-free module (no React, no fetch, no DOM, no timers) so the
 * page's data rules can be unit-tested with plain Node, matching the convention
 * of every other `web/lib/*.mjs` helper.
 *
 * REUSE, NOT DUPLICATION: the feed contract (limits, composer validation,
 * newest-first ordering, cursor pagination, dedup) is byte-identical to the
 * customer community's, so those helpers are re-exported from ./community.mjs
 * rather than copied. Copying them would create two definitions that could
 * silently disagree.
 *
 * These helpers are DISPLAY ONLY. They never authorize anything and never decide
 * what an employee may see — `GET /employee/community/messages` is already
 * scoped server-side to the employee audience, so every function here operates
 * only on rows the server has already approved.
 */

import {
  COMMUNITY_LIMIT_DEFAULT,
  COMMUNITY_LIMIT_MAX,
  COMMUNITY_MESSAGE_MAX_LENGTH,
  appendOlder,
  chronological,
  contentError,
  feedQuery,
  isValidCommunityLimit,
  mergeNewest,
  newestFirst,
} from "./community.mjs";

// The feed contract is shared with the customer community. Re-exported so a
// page imports them from one obvious place and a test can prove the employee
// surface did not invent its own limits or ordering rules.
export {
  COMMUNITY_LIMIT_DEFAULT,
  COMMUNITY_LIMIT_MAX,
  COMMUNITY_MESSAGE_MAX_LENGTH,
  appendOlder,
  chronological,
  contentError,
  feedQuery,
  isValidCommunityLimit,
  mergeNewest,
  newestFirst,
};

// Empty-state copy. Deliberately employee-specific: no "customer", "booking",
// "payment", "receipt" or "discount" wording, because none of those concepts
// apply to an employee account and their use would misrepresent the page.
export const EMPTY_TITLE = "No posts yet.";
export const EMPTY_BODY =
  "The employee community is empty. Post the first message to start a conversation with the team.";

// Shown in place of a failed load, so a transient error is never mistaken for an
// empty community.
export const ERROR_TITLE = "We could not load the employee community.";

// The composer's submit-disabled reason, or null when the draft is sendable.
// Kept separate from contentError so the button's tooltip and the form's error
// text can never disagree about why a draft was rejected.
export function draftDisabledReason(draft, { sending, blocked }) {
  if (blocked) return "You are blocked from posting to the employee community.";
  if (sending) return "Sending your message…";
  if (contentError(draft)) return contentError(draft);
  return null;
}

// The author label for one post. NEVER derived from anything other than the
// server-provided author name/id — no email, no role, no customer link target.
// An employee community has no profiles in this phase, so the author is text.
export function authorLabel(post) {
  const name = post?.author?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return "Employee";
}

// True only when the server itself marked the post as removed. A missing field
// is treated as NOT removed, because showing a live post is recoverable and
// hiding a real one silently would be a lie about what the team can see.
export function isRemoved(post) {
  return post?.deletedAt != null;
}

// True only for a post this employee wrote, so the UI can label "You".
// Comparison is against the SESSION user's id passed in by the page — never a
// value taken from the post, which would let a post claim authorship.
export function isOwnPost(post, sessionUserId) {
  if (!post?.author?.id || !sessionUserId) return false;
  return post.author.id === sessionUserId;
}

// The live count of removed posts the server returned, for the admin view's
// summary line. Never invents a number and never counts a malformed list.
export function removedCount(posts) {
  if (!Array.isArray(posts)) return 0;
  return posts.filter(isRemoved).length;
}
