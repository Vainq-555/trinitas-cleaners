import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUPS_LIMIT_DEFAULT,
  GROUPS_LIMIT_MAX,
  GROUP_NAME_MAX,
  GROUP_DESCRIPTION_MAX,
  GROUP_MESSAGE_MAX,
  GROUP_TYPES,
  GROUP_TYPE_PUBLIC,
  GROUP_TYPE_PRIVATE,
  GROUP_TYPE_INVITE_ONLY,
  INVITE_CODE_MAX,
  isValidGroupsLimit,
  groupsQuery,
  validateGroupName,
  validateGroupDescription,
  validateGroupType,
  validateInviteCode,
  isNonPublicGroup,
  requiresInvite,
  groupTypeLabel,
  validateGroupMessage,
  mergeGroupMessages,
  appendOlderGroupMessages,
  chronologicalGroupMessages,
  memberNewestFirst,
  mergeGroupMembers,
  appendOlderGroupMembers,
  ownerControls,
  applyMembership,
  isBlockedError,
  isRateLimitError,
  isNotFoundError,
  groupErrorText,
  isDeletedMessage,
  messageDisplayText,
  memberName,
  memberAvatarUrl,
  isOnlineMember,
  joinWithCodeTarget,
  adminGroupStatusLabel,
  mergeAdminGroups,
} from "../lib/groups.mjs";

const msg = (id, iso, overrides = {}) => ({
  id,
  content: `msg ${id}`,
  createdAt: iso,
  sender: { id: `u-${id}`, name: `User ${id}` },
  ...overrides,
});

const grp = (id, iso, overrides = {}) => ({
  id,
  name: `Group ${id}`,
  description: null,
  type: "public",
  createdAt: iso,
  updatedAt: iso,
  memberCount: 1,
  joined: false,
  ...overrides,
});

const member = (userId, iso, overrides = {}) => ({
  userId,
  joinedAt: iso,
  user: { id: userId, name: `Member ${userId}` },
  ...overrides,
});

// --- 1. Group limit validation --------------------------------------------

test("default group limit is 50 and maximum is 100", () => {
  assert.equal(GROUPS_LIMIT_DEFAULT, 50);
  assert.equal(GROUPS_LIMIT_MAX, 100);
});

test("valid group limits are 1..100", () => {
  for (const n of [1, 50, 100]) assert.equal(isValidGroupsLimit(n), true, `limit ${n}`);
});

test("invalid group limits are rejected", () => {
  for (const n of [0, -1, 101, 1000, 1.5, "50", null, undefined, NaN]) {
    assert.equal(isValidGroupsLimit(n), false, `limit ${n}`);
  }
});

// --- 2. groupsQuery --------------------------------------------------------

test("groupsQuery defaults to 50 and omits before when absent", () => {
  assert.deepEqual(groupsQuery(), { limit: 50 });
  assert.deepEqual(groupsQuery({}), { limit: 50 });
  assert.deepEqual(groupsQuery(null), { limit: 50 });
});

test("groupsQuery passes the opaque cursor through exactly", () => {
  const cur = "abc.def_12~hI";
  assert.deepEqual(groupsQuery({ before: cur }), { limit: 50, before: cur });
  assert.equal(groupsQuery({ limit: 100, before: cur }).before, cur);
});

test("groupsQuery rejects an invalid limit", () => {
  assert.equal(groupsQuery({ limit: 101 }), null);
  assert.equal(groupsQuery({ limit: 0 }), null);
  assert.equal(groupsQuery({ limit: "50" }), null);
});

// --- 3. G1f group types & invite codes --------------------------------------

test("group type constants mirror the server's allowed types", () => {
  assert.equal(GROUP_TYPE_PUBLIC, "public");
  assert.equal(GROUP_TYPE_PRIVATE, "private");
  assert.equal(GROUP_TYPE_INVITE_ONLY, "invite_only");
  assert.deepEqual(GROUP_TYPES, ["public", "private", "invite_only"]);
});

test("validateGroupType accepts only the three server types", () => {
  assert.equal(validateGroupType("public"), null);
  assert.equal(validateGroupType("private"), null);
  assert.equal(validateGroupType("invite_only"), null);
  for (const bad of ["", "PUBLIC", "public ", "gossip", 12, null, undefined]) {
    assert.notEqual(validateGroupType(bad), null, `type=${JSON.stringify(bad)} must be rejected`);
  }
});

test("isNonPublicGroup and requiresInvite classify groups correctly", () => {
  assert.equal(isNonPublicGroup({ type: "private" }), true);
  assert.equal(isNonPublicGroup({ type: "invite_only" }), true);
  assert.equal(isNonPublicGroup({ type: "public" }), false);
  assert.equal(isNonPublicGroup({}), false);
  assert.equal(isNonPublicGroup(null), false);
  assert.equal(requiresInvite({ type: "invite_only" }), true);
  assert.equal(requiresInvite({ type: "private" }), false);
  assert.equal(requiresInvite({ type: "public" }), false);
  assert.equal(requiresInvite({}), false);
});

test("groupTypeLabel renders friendly labels for each type", () => {
  assert.equal(groupTypeLabel("public"), "Public");
  assert.equal(groupTypeLabel("private"), "Private");
  assert.equal(groupTypeLabel("invite_only"), "By invitation only");
  assert.equal(groupTypeLabel("unknown"), "Public");
  assert.equal(groupTypeLabel(undefined), "Public");
});

test("validateInviteCode requires a non-blank code and caps its length", () => {
  assert.equal(validateInviteCode("secretcode123"), null);
  assert.equal(validateInviteCode("  secretcode123  "), null);
  assert.equal(validateInviteCode("x".repeat(INVITE_CODE_MAX)), null);
  assert.match(validateInviteCode(""), /invite code/i);
  assert.match(validateInviteCode("   \t "), /invite code/i);
  assert.match(validateInviteCode(null), /invite code/i);
  assert.match(validateInviteCode(undefined), /invite code/i);
  assert.match(validateInviteCode(42), /invite code/i);
  assert.match(validateInviteCode("x".repeat(INVITE_CODE_MAX + 1)), /invalid/i);
});

// --- 4. Name validation ----------------------------------------------------

test("group name validation", () => {
  assert.match(validateGroupName(""), /required/i);
  assert.match(validateGroupName("   \t "), /required/i);
  assert.match(validateGroupName(null), /required/i);
  assert.match(validateGroupName(undefined), /required/i);
  assert.match(validateGroupName(12), /required/i);
  assert.equal(validateGroupName("My Cleaning Club"), null);
  assert.equal(validateGroupName("x".repeat(GROUP_NAME_MAX)), null);
  assert.match(validateGroupName("x".repeat(GROUP_NAME_MAX + 1)), /100/);
});

// --- 4. Description validation ---------------------------------------------

test("group description is optional and unlimited up to 500", () => {
  assert.equal(validateGroupDescription(undefined), null);
  assert.equal(validateGroupDescription(null), null);
  assert.equal(validateGroupDescription(""), null);
  assert.equal(validateGroupDescription("   "), null);
  assert.equal(validateGroupDescription("A tidy group for window fans"), null);
  assert.equal(validateGroupDescription("x".repeat(GROUP_DESCRIPTION_MAX)), null);
  assert.match(validateGroupDescription("x".repeat(GROUP_DESCRIPTION_MAX + 1)), /500/);
  assert.match(validateGroupDescription(123), /text/i);
});

// --- 5. Message validation -------------------------------------------------

test("group message validation reuses the 1000-character community rule", () => {
  assert.equal(GROUP_MESSAGE_MAX, 1000);
  assert.equal(validateGroupMessage("x".repeat(1000)), null);
  assert.match(validateGroupMessage("x".repeat(1001)), /1000/);
  assert.match(validateGroupMessage(""), /empty/i);
  assert.match(validateGroupMessage("   \t "), /empty/i);
  assert.match(validateGroupMessage(null), /empty/i);
  assert.match(validateGroupMessage(undefined), /empty/i);
});

// --- 6. Pagination / feed helpers ------------------------------------------

test("mergeGroupMessages folds new items in newest-first and dedups by id", () => {
  const existing = [msg("b", "2026-09-02T00:00:00Z"), msg("a", "2026-09-01T00:00:00Z")];
  const incoming = [msg("c", "2026-09-03T00:00:00Z"), msg("b", "2026-09-02T00:00:00Z")];
  const merged = mergeGroupMessages(existing, incoming);
  assert.deepEqual(merged.map((x) => x.id), ["c", "b", "a"]);
  assert.equal(merged.filter((x) => x.id === "b").length, 1);
});

test("appendOlderGroupMessages prepends an older page without duplication", () => {
  const existing = [msg("d", "2026-09-04T00:00:00Z"), msg("c", "2026-09-03T00:00:00Z")];
  const older = [msg("b", "2026-09-02T00:00:00Z"), msg("a", "2026-09-01T00:00:00Z")];
  const first = appendOlderGroupMessages(existing, older);
  const again = appendOlderGroupMessages(first, older);
  assert.deepEqual(again.map((x) => x.id), ["d", "c", "b", "a"]);
});

test("chronologicalGroupMessages reverses newest-first for display", () => {
  const list = mergeGroupMessages([msg("a", "2026-09-01T00:00:00Z")], [msg("c", "2026-09-03T00:00:00Z"), msg("b", "2026-09-02T00:00:00Z")]);
  const display = chronologicalGroupMessages(list);
  assert.deepEqual(display.map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(display.map((x) => x.id).reverse(), list.map((x) => x.id));
});

test("group feed merge works for discovery items too (createdAt/id)", () => {
  const merged = mergeGroupMessages([grp("a", "2026-09-01T00:00:00Z")], [grp("c", "2026-09-03T00:00:00Z"), grp("b", "2026-09-02T00:00:00Z")]);
  assert.deepEqual(merged.map((x) => x.id), ["c", "b", "a"]);
});

// --- 7. Member helpers -----------------------------------------------------

test("memberNewestFirst orders by joinedAt desc with userId desc tie-break", () => {
  const a = member("a", "2026-09-02T00:00:00Z");
  const b = member("b", "2026-09-01T00:00:00Z");
  const tieA = member("tie1", "2026-09-01T00:00:00Z");
  const tieB = member("tie2", "2026-09-01T00:00:00Z");
  assert.equal(memberNewestFirst(a, b) < 0, true);
  assert.equal(memberNewestFirst(tieB, tieA) < 0, true);
});

test("mergeGroupMembers dedups by userId and stays newest-first", () => {
  const existing = [member("a", "2026-09-02T00:00:00Z"), member("b", "2026-09-01T00:00:00Z")];
  const incoming = [member("c", "2026-09-03T00:00:00Z"), member("b", "2026-09-01T00:00:00Z")];
  const merged = mergeGroupMembers(existing, incoming);
  assert.deepEqual(merged.map((x) => x.userId), ["c", "a", "b"]);
  assert.equal(merged.filter((x) => x.userId === "b").length, 1);
});

test("appendOlderGroupMembers is idempotent across repeated pages", () => {
  const existing = [member("d", "2026-09-04T00:00:00Z"), member("c", "2026-09-03T00:00:00Z")];
  const older = [member("b", "2026-09-02T00:00:00Z"), member("a", "2026-09-01T00:00:00Z")];
  const first = appendOlderGroupMembers(existing, older);
  const again = appendOlderGroupMembers(first, older);
  assert.deepEqual(again.map((x) => x.userId), ["d", "c", "b", "a"]);
  assert.equal(again.length, 4);
});

// --- 8. Owner selectors ----------------------------------------------------

test("ownerControls only returns true for the matching owner", () => {
  assert.equal(ownerControls("u1", "u1"), true);
  assert.equal(ownerControls("u1", "u2"), false);
  assert.equal(ownerControls("", "u1"), false);
  assert.equal(ownerControls(null, "u1"), false);
  assert.equal(ownerControls("u1", null), false);
  assert.equal(ownerControls(undefined, undefined), false);
});

// --- 9. Membership state transitions ---------------------------------------

test("applyMembership follows the join/leave server response", () => {
  assert.equal(applyMembership(false, { joined: true }), true);
  assert.equal(applyMembership(true, { left: true }), false);
  assert.equal(applyMembership(true, { ok: true }), true);
  assert.equal(applyMembership(false, { left: true }), false);
  assert.equal(applyMembership(null, { joined: true }), true);
  assert.equal(applyMembership(true, null), true);
});

// --- 10. Action/status mapping ----------------------------------------------

test("groupErrorText maps known statuses and falls back generically", () => {
  assert.match(groupErrorText(401), /session/i);
  assert.match(groupErrorText(403), /permission/i);
  assert.match(groupErrorText(404), /no longer available/i);
  assert.match(groupErrorText(429), /wait/i);
  assert.match(groupErrorText(500), /something went wrong/i);
  assert.match(groupErrorText(undefined), /something went wrong/i);
});

test("isBlockedError only matches a 403 with a blocked message", () => {
  assert.equal(isBlockedError({ status: 403, message: "You are blocked from community groups" }), true);
  assert.equal(isBlockedError({ status: 403, message: "Only the group owner can update this group" }), false);
  assert.equal(isBlockedError({ status: 403 }), false);
  assert.equal(isBlockedError({ status: 429, message: "blocked" }), false);
  assert.equal(isBlockedError(null), false);
});

test("isRateLimitError and isNotFoundError match status codes", () => {
  assert.equal(isRateLimitError({ status: 429 }), true);
  assert.equal(isRateLimitError({ status: 403 }), false);
  assert.equal(isRateLimitError(null), false);
  assert.equal(isNotFoundError({ status: 404 }), true);
  assert.equal(isNotFoundError({ status: 403 }), false);
});

// --- 11. Safe/optional field handling ---------------------------------------

test("deleted group messages hide content and render as (deleted)", () => {
  assert.equal(isDeletedMessage({ deleted: true, content: null }), true);
  assert.equal(isDeletedMessage({ content: "hello" }), false);
  assert.equal(isDeletedMessage({ deleted: false, content: null }), true);
  assert.equal(isDeletedMessage(null), false);
  assert.equal(messageDisplayText({ deleted: true, content: null }), "(deleted)");
  assert.equal(messageDisplayText({ content: "hello" }), "hello");
  assert.equal(messageDisplayText(null), "");
});

test("member identity fields stay safe when optional values are absent", () => {
  assert.equal(memberName({ user: { name: "Al" } }), "Al");
  assert.equal(memberName({ user: {} }), "Community member");
  assert.equal(memberName({}), "Community member");
  assert.equal(memberName(null), "Community member");
  assert.equal(memberAvatarUrl({ user: { avatarUrl: "https://ex/av.png" } }), "https://ex/av.png");
  assert.equal(memberAvatarUrl({ user: {} }), null);
  assert.equal(memberAvatarUrl(null), null);
});

test("online indicator appears only when explicitly true", () => {
  assert.equal(isOnlineMember({ user: { online: true } }), true);
  assert.equal(isOnlineMember({ user: { online: false } }), false);
  assert.equal(isOnlineMember({ user: {} }), false);
  assert.equal(isOnlineMember({}), false);
  assert.equal(isOnlineMember(null), false);
});

// --- Admin Groups helpers -------------------------------------------------

test("joinWithCodeTarget returns the resolved group id for navigation", () => {
  assert.equal(joinWithCodeTarget({ groupId: "grp9", joined: true, group: { id: "grp9", name: "G", type: "private" } }), "grp9");
  assert.equal(joinWithCodeTarget({ joined: true }), null);
  assert.equal(joinWithCodeTarget({ groupId: "" }), null);
  assert.equal(joinWithCodeTarget(null), null);
  assert.equal(joinWithCodeTarget(undefined), null);
});

test("adminGroupStatusLabel maps the derived active/dissolved status", () => {
  assert.equal(adminGroupStatusLabel("active"), "Active");
  assert.equal(adminGroupStatusLabel("dissolved"), "Dissolved");
  assert.equal(adminGroupStatusLabel(undefined), "Active");
  assert.equal(adminGroupStatusLabel(null), "Active");
});

test("mergeAdminGroups dedupes paginated admin groups newest-first", () => {
  const page1 = [grp("g3", "2026-09-10T00:00:00Z", { name: "Three" }), grp("g2", "2026-09-09T00:00:00Z", { name: "Two" })];
  const page2 = [grp("g3", "2026-09-10T00:00:00Z", { name: "Three-updated" }), grp("g1", "2026-09-08T00:00:00Z", { name: "One" })];
  const merged = mergeAdminGroups(page1, page2);
  assert.deepEqual(merged.map((g) => g.id), ["g3", "g2", "g1"]);
  assert.equal(merged[0].name, "Three-updated");
});