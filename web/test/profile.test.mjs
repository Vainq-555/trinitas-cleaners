import test from "node:test";
import assert from "node:assert/strict";
import {
  ONLINE_TTL_MS,
  PROFILE_BIO_MAX,
  PROFILE_CITY_MAX,
  PROFILE_DISPLAY_NAME_MAX,
  PUBLIC_PROFILE_KEYS,
  isOnlineFromLastActive,
  isValidAvatarUrl,
  normalizeAvatarUrl,
  normalizeBio,
  normalizeCity,
  normalizeDisplayName,
  normalizeState,
  onlineOf,
  toOwnPayload,
  toPublicShape,
  validateProfileDraft,
} from "../lib/profile.mjs";

test("displayName normalization: trimming, required, boundaries", () => {
  assert.equal(normalizeDisplayName("  Alice C  ").value, "Alice C");
  assert.equal(normalizeDisplayName(undefined).error, "Display name is required");
  assert.equal(normalizeDisplayName("   ").error, "Display name is required");
  assert.equal(normalizeDisplayName(123).error, "Display name is required");
  assert.equal(normalizeDisplayName("x".repeat(PROFILE_DISPLAY_NAME_MAX)).value.length, PROFILE_DISPLAY_NAME_MAX);
  assert.ok(normalizeDisplayName("x".repeat(PROFILE_DISPLAY_NAME_MAX + 1)).error);
});

test("bio normalization: boundaries, trim, clear-to-null", () => {
  assert.equal(normalizeBio("  hi  ").value, "hi");
  assert.equal(normalizeBio("   ").value, null);
  assert.equal(normalizeBio(null).value, null);
  assert.equal(normalizeBio(undefined).value, null);
  assert.equal(normalizeBio(42).error, "Bio must be text");
  assert.equal(normalizeBio("x".repeat(PROFILE_BIO_MAX)).value.length, PROFILE_BIO_MAX);
  assert.ok(normalizeBio("x".repeat(PROFILE_BIO_MAX + 1)).error);
});

test("city normalization: trim, clear-to-null, boundary", () => {
  assert.equal(normalizeCity("  Minneapolis  ").value, "Minneapolis");
  assert.equal(normalizeCity("  ").value, null);
  assert.equal(normalizeCity(null).value, null);
  assert.equal(normalizeCity("x".repeat(PROFILE_CITY_MAX)).value.length, PROFILE_CITY_MAX);
  assert.ok(normalizeCity("x".repeat(PROFILE_CITY_MAX + 1)).error);
});

test("state normalization: exactly two letters, uppercased, clear-to-null", () => {
  assert.equal(normalizeState(" mn ").value, "MN");
  assert.equal(normalizeState("MI").value, "MI");
  assert.equal(normalizeState("  ").value, null);
  assert.equal(normalizeState(null).value, null);
  for (const bad of ["MNX", "m", "12", "min", 5]) assert.ok(normalizeState(bad).error);
});

test("avatarUrl validation: https only, no credentials", () => {
  for (const good of ["https://cdn.example.com/a.jpg", "https://example.com/path/a.png?x=1"]) assert.ok(isValidAvatarUrl(good));
  for (const bad of ["http://example.com/a.png", "ftp://example.com/a.png", "not-a-url", "https://", "https://u:p@example.com/a.png", 42]) {
    assert.ok(!isValidAvatarUrl(bad));
  }
  assert.equal(isValidAvatarUrl(null), true);
  assert.equal(isValidAvatarUrl(""), true);
});

test("normalizeAvatarUrl: null/empty/whitespace clears to null, never trims null", () => {
  assert.equal(normalizeAvatarUrl(null).value, null);
  assert.equal(normalizeAvatarUrl(undefined).value, null);
  assert.equal(normalizeAvatarUrl("").value, null);
  assert.equal(normalizeAvatarUrl("   ").value, null);
  assert.equal(normalizeAvatarUrl("  https://cdn.example.com/a.jpg  ").value, "https://cdn.example.com/a.jpg");
  for (const bad of ["http://example.com/a.png", "https://u:p@example.com/a.png", 42, false]) {
    assert.equal(normalizeAvatarUrl(bad).error, "Avatar must be a valid https URL");
  }
});

test("profile with all-optional-null fields renders a safe editor form (no null.trim)", () => {
  const profile = {
    userId: "cus-ada",
    displayName: "Ada",
    bio: null,
    avatarUrl: null,
    locationCity: null,
    locationState: null,
    showOnline: true,
    profileVisible: true,
    moderationHiddenAt: null,
  };
  const formOf = (p) => ({
    displayName: p.displayName ?? "",
    bio: p.bio ?? "",
    avatarUrl: p.avatarUrl ?? "",
    locationCity: p.locationCity ?? "",
    locationState: p.locationState ?? "",
    showOnline: p.showOnline ?? true,
    profileVisible: p.profileVisible ?? true,
  });
  const avatarPreviewOf = (v) => normalizeAvatarUrl(v).value ?? null;

  assert.doesNotThrow(() => {
    const form = formOf(profile);
    assert.equal(form.displayName, "Ada");
    assert.equal(form.bio, "");
    assert.equal(form.avatarUrl, "");
    assert.equal(form.locationCity, "");
    assert.equal(form.locationState, "");
    assert.equal(form.showOnline, true);
    assert.equal(form.profileVisible, true);
    assert.equal(avatarPreviewOf(form.avatarUrl), null);
    const payload = toOwnPayload({ ...form, avatarUrl: avatarPreviewOf(form.avatarUrl) });
    assert.equal(payload.avatarUrl, null);
  });
});

// Mirrors the page's Save handler: validate each editable field, collect the
// normalized values, and build the PUT payload from those values (never by
// re-trimming raw form.* inputs). This pins the null-saving regression class.
const buildSavePayload = (f) => {
  const checks = [
    ["displayName", normalizeDisplayName(f.displayName)],
    ["bio", normalizeBio(f.bio)],
    ["avatarUrl", normalizeAvatarUrl(f.avatarUrl)],
    ["locationCity", normalizeCity(f.locationCity)],
    ["locationState", normalizeState(f.locationState)],
  ];
  const values = {};
  for (const [key, out] of checks) {
    if (out.error) return { error: out.error };
    values[key] = out.value;
  }
  return {
    payload: toOwnPayload({
      ...f,
      displayName: values.displayName,
      avatarUrl: values.avatarUrl ?? null,
      bio: values.bio ?? null,
      locationCity: values.locationCity ?? null,
      locationState: values.locationState ?? null,
    }),
  };
};

test("profile Save payload: built from normalized values, null-optionals never trimmed", () => {
  const nullForm = {
    displayName: "Ada",
    bio: null,
    avatarUrl: null,
    locationCity: null,
    locationState: null,
    showOnline: true,
    profileVisible: true,
  };
  assert.doesNotThrow(() => {
    const { payload } = buildSavePayload(nullForm);
    assert.equal(payload.displayName, "Ada");
    assert.equal(payload.bio, null);
    assert.equal(payload.avatarUrl, null);
    assert.equal(payload.locationCity, null);
    assert.equal(payload.locationState, null);
    assert.equal(payload.showOnline, true);
    assert.equal(payload.profileVisible, true);
  });
});

test("profile Save payload: normalizes strings, clears empties/whitespace, rejects invalid", () => {
  const base = { displayName: "Ada", bio: null, avatarUrl: null, locationCity: null, locationState: null, showOnline: true, profileVisible: true };
  const { payload } = buildSavePayload({
    ...base,
    displayName: "  Ada Lovelace  ",
    bio: "  hello world  ",
    avatarUrl: "  https://cdn.example.com/a.jpg  ",
    locationCity: "  Minneapolis  ",
    locationState: " mn ",
  });
  assert.equal(payload.displayName, "Ada Lovelace");
  assert.equal(payload.bio, "hello world");
  assert.equal(payload.avatarUrl, "https://cdn.example.com/a.jpg");
  assert.equal(payload.locationCity, "Minneapolis");
  assert.equal(payload.locationState, "MN");

  const blank = buildSavePayload({ ...base, bio: "   ", locationCity: "", locationState: "  " });
  assert.equal(blank.payload.bio, null);
  assert.equal(blank.payload.locationCity, null);
  assert.equal(blank.payload.locationState, null);

  assert.equal(buildSavePayload({ ...base, avatarUrl: "http://x" }).error, "Avatar must be a valid https URL");
  assert.equal(buildSavePayload({ ...base, avatarUrl: 42 }).error, "Avatar must be a valid https URL");
  assert.equal(buildSavePayload({ ...base, displayName: " " }).error, "Display name is required");
  assert.equal(buildSavePayload({ ...base, bio: 42 }).error, "Bio must be text");
  assert.equal(buildSavePayload({ ...base, locationState: "MNX" }).error, "State must be a two-letter code");
});

test("validateProfileDraft: trims, preserves partials, rejects empties and bad types", () => {
  const r = validateProfileDraft({ displayName: "  Alice  ", bio: " hi ", locationState: "mn" });
  assert.deepEqual(r.values, { displayName: "Alice", bio: "hi", locationState: "MN" });
  assert.equal(validateProfileDraft({ displayName: " " }).error, "Display name is required");
  assert.equal(validateProfileDraft({ showOnline: "yes" }).error, "Show online must be enabled or disabled");
  assert.equal(validateProfileDraft({ profileVisible: 1 }).error, "Profile visibility must be enabled or disabled");
  assert.equal(validateProfileDraft({ avatarUrl: "http://x" }).error, "Avatar must be a valid https URL");
  assert.equal(validateProfileDraft({ userId: "forged", id: "x" }).error, "No editable profile fields provided");
  assert.equal(validateProfileDraft({}).error, "No editable profile fields provided");
  assert.equal(validateProfileDraft({ maintenance: true }).error, "No editable profile fields provided");
});

test("toOwnPayload: only editable keys, never immutable/unknown", () => {
  const draft = { displayName: "A", userId: "mallory", id: "x", moderationHiddenAt: null, avatarUrl: "https://x/a.png" };
  const payload = toOwnPayload(draft);
  assert.deepEqual(Object.keys(payload).sort(), ["avatarUrl", "displayName"].sort());
  assert.equal(payload.userId, undefined);
  assert.equal(payload.id, undefined);
  assert.equal(payload.moderationHiddenAt, undefined);
});

test("online gating: recent true, stale false, non-numeric false", () => {
  const recent = Date.now() - 1000;
  const stale = Date.now() - ONLINE_TTL_MS - 60_000;
  assert.equal(isOnlineFromLastActive(recent), true);
  assert.equal(isOnlineFromLastActive(stale), false);
  assert.equal(isOnlineFromLastActive(null), false);
  assert.equal(isOnlineFromLastActive("x"), false);
  assert.equal(isOnlineFromLastActive(Date.now() - ONLINE_TTL_MS), false);
});

test("onlineOf: undefined when profile opted out, boolean otherwise", () => {
  assert.equal(onlineOf({ online: true }), true);
  assert.equal(onlineOf({ online: false }), false);
  assert.equal(onlineOf({}), null);
  assert.equal(onlineOf({ online: "yes" }), false);
  assert.equal(onlineOf(null), null);
});

test("toPublicShape: only the approved public keys survive", () => {
  const fake = {
    userId: "cus1",
    displayName: "Alice",
    bio: "b",
    avatarUrl: "https://x/a.png",
    locationCity: "Minneapolis",
    locationState: "MN",
    online: true,
    email: "alice@x.com",
    phone: "555",
    address: "1 Main St",
    passwordHash: "hash",
    role: "customer",
    status: "online",
    lastActiveAt: 123,
    communityBlockedAt: null,
    secret: "s",
    token: "t",
  };
  const out = toPublicShape(fake);
  assert.deepEqual(Object.keys(out).sort(), [...PUBLIC_PROFILE_KEYS].sort());
  const payload = JSON.stringify(out);
  for (const forbidden of ["email", "phone", "address", "password", "role", "status", "lastActiveAt", "communityBlockedAt", "secret", "token"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `must not include ${forbidden}`);
  }
  assert.equal(out.userId, "cus1");
});

test("toPublicShape tolerates null and non-objects", () => {
  assert.equal(toPublicShape(null), null);
  assert.equal(toPublicShape(undefined), null);
});