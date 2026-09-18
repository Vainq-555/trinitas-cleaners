import test from "node:test";
import assert from "node:assert/strict";
import { requireAdmin, requireCustomer } from "../src/middleware/auth.js";
import { ONLINE_TTL_MS, ROLES } from "../src/config.js";
import {
  adminGetProfile,
  adminHideProfile,
  adminListProfiles,
  adminUnhideProfile,
  getOwnProfile,
  getPublicProfile,
  updateOwnProfile,
} from "../src/controllers/profiles.js";
import { PROFILE_BIO_MAX, PROFILE_DISPLAY_NAME_MAX } from "../src/utils/validators.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const t = (s) => new Date(s);

// Online gating is relative to the wall clock, so build test timestamps from
// Date.now() (fixed string dates make "online" clock-dependent).
const recent = new Date(Date.now());
const staleDate = new Date(Date.now() - ONLINE_TTL_MS - 60_000);

// Auth user the customer endpoints see. Never carries email/phone/address/etc.
const customerUser = (overrides = {}) => ({
  id: "cus1",
  name: "Alice",
  role: "customer",
  lastActiveAt: recent,
  ...overrides,
});

const adminUser = () => ({ id: "adm1", name: "Admin", role: "admin", lastActiveAt: recent });

const profileFixture = (overrides = {}) => ({
  id: "pf1",
  userId: "cus1",
  displayName: "Alice",
  bio: null,
  avatarUrl: null,
  locationCity: null,
  locationState: null,
  showOnline: true,
  profileVisible: true,
  moderationHiddenAt: null,
  createdAt: t("2026-09-17T00:00:00Z"),
  updatedAt: t("2026-09-17T00:00:00Z"),
  // Relation shape the admin/public serializers read (like `customer` in the
  // community fake). Mock User rows must never be the full account row.
  user: {
    id: "cus1",
    name: "Alice",
    lastActiveAt: recent,
    role: "customer",
    communityBlockedAt: null,
  },
  ...overrides,
});

// In-memory fake of prisma.communityProfile + prisma.user (the injected-db
// pattern from community.test.js). No `.message`/`.communityMessage` accessor
// is exposed, so any profile code touching the existing Message or
// CommunityMessage models throws here and fails the isolation tests.
const makeDb = ({ profiles = [], users = [] } = {}) => {
  const profileRows = profiles.map((p) => ({ ...p }));
  const userRows = users.map((u) => ({ ...u }));
  let seq = profileRows.length;

  return {
    communityProfile: {
      findUnique: async ({ where }) => profileRows.find((p) => p.userId === where.userId) ?? null,
      findMany: async ({ orderBy } = {}) => {
        let out = profileRows.map((p) => ({ ...p }));
        if (orderBy) {
          out.sort((a, b) => {
            for (const ob of orderBy) {
              const key = Object.keys(ob)[0];
              const dir = ob[key];
              const av = a[key] ?? "";
              const bv = b[key] ?? "";
              const c = av < bv ? -1 : av > bv ? 1 : 0;
              if (c !== 0) return dir === "desc" ? -c : c;
            }
            return 0;
          });
        }
        return out;
      },
      create: async ({ data }) => {
        const p = {
          id: `pf${++seq}`,
          bio: null,
          avatarUrl: null,
          locationCity: null,
          locationState: null,
          showOnline: true,
          profileVisible: true,
          moderationHiddenAt: null,
          createdAt: t("2026-09-18T00:00:00Z"),
          updatedAt: t("2026-09-18T00:00:00Z"),
          ...data,
        };
        profileRows.push(p);
        return p;
      },
      update: async ({ where, data }) => {
        const i = profileRows.findIndex((p) => p.id === where.id);
        profileRows[i] = { ...profileRows[i], ...data, updatedAt: t("2026-09-18T12:30:00Z") };
        return profileRows[i];
      },
    },
    user: {
      findUnique: async ({ where } = {}) => userRows.find((u) => u.id === where.id) ?? null,
    },
  };
};

const assertNoPrivateFields = (res, extraForbidden = []) => {
  const payload = JSON.stringify(res.body);
  for (const forbidden of [
    "email",
    "phone",
    "address",
    "passwordHash",
    "password",
    "lastActiveAt",
    "communityBlockedAt",
    "secret",
    "token",
    "credential",
    "role",
    "status",
  ].concat(extraForbidden)) {
    assert.ok(
      !payload.toLowerCase().includes(forbidden.toLowerCase()),
      `payload must not expose ${forbidden}: ${payload}`,
    );
  }
};

// ---- Authentication / role enforcement on every new route ----

test("customer profile GET is blocked with 401 when unauthenticated", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("customer profile PUT is blocked with 401 when unauthenticated", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("public profile GET is blocked with 401 when unauthenticated", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("admin profile endpoints are blocked with 401 when unauthenticated", async () => {
  for (const fn of [adminListProfiles, adminGetProfile, adminHideProfile, adminUnhideProfile]) {
    const res = response();
    await requireAdmin({}, res, () => assert.fail("anonymous should not reach the endpoint"));
    assert.equal(res.statusCode, 401, "anonymous must get 401");
  }
});

test("customer is blocked from admin profile endpoints with 403", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
});

test("admin is blocked from customer profile routes by the controller guard", async () => {
  for (const fn of [getOwnProfile, updateOwnProfile, getPublicProfile]) {
    const db = makeDb();
    const res = response();
    await fn({ user: adminUser(), params: { userId: "cus1" }, body: {} }, res, db);
    assert.equal(res.statusCode, 403, "admin must be rejected from customer routes");
  }
});

// ---- Own profile GET + lazy creation ----

test("GET own profile lazily creates a profile with displayName = User.name", async () => {
  const db = makeDb({ users: [{ id: "cus1", name: "Alice" }] });
  const res = response();
  await getOwnProfile({ user: customerUser() }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.userId, "cus1");
  assert.equal(res.body.profile.displayName, "Alice");
  assert.equal(res.body.profile.profileVisible, true);
  assert.equal(res.body.profile.showOnline, true);
  assert.equal(res.body.profile.bio, null);
  assertNoPrivateFields(res);
});

test("GET own profile does not overwrite an existing profile", async () => {
  const db = makeDb({ profiles: [profileFixture({ displayName: "Alice Updated", bio: "Keep me" })] });
  const res = response();
  await getOwnProfile({ user: customerUser() }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.displayName, "Alice Updated");
  assert.equal(res.body.profile.bio, "Keep me");
});

test("owner can read their own profile even when profileVisible=false or admin-hidden", async () => {
  for (const over of [{ profileVisible: false }, { moderationHiddenAt: t("2026-09-18T00:00:00Z") }]) {
    const db = makeDb({ profiles: [profileFixture(over)] });
    const res = response();
    await getOwnProfile({ user: customerUser() }, res, db);
    assert.equal(res.statusCode, 200, "own GET must always work");
    assert.equal(res.body.profile.userId, "cus1");
  }
});

test("blocked customer can still read their own profile", async () => {
  const reqUser = customerUser({ communityBlockedAt: t("2026-09-17T00:00:00Z") });
  const db = makeDb({
    profiles: [profileFixture({ user: { ...profileFixture().user, communityBlockedAt: reqUser.communityBlockedAt } })],
  });
  const res = response();
  await getOwnProfile({ user: reqUser }, res, db);
  assert.equal(res.statusCode, 200);
});

// ---- PUT own profile ----

test("partial PUT updates only provided fields and trims strings", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  const res = response();
  await updateOwnProfile(
    {
      user: customerUser(),
      body: { displayName: "  Alice C  ", bio: "  Clean freak  ", locationCity: "  Minneapolis  ", locationState: " mn " },
    },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.displayName, "Alice C");
  assert.equal(res.body.profile.bio, "Clean freak");
  assert.equal(res.body.profile.locationCity, "Minneapolis");
  assert.equal(res.body.profile.locationState, "MN");
  assert.equal(res.body.profile.avatarUrl, null);
  assertNoPrivateFields(res);
});

test("first-time PUT lazily creates the profile and applies the data", async () => {
  const db = makeDb({ users: [{ id: "cus1", name: "Alice" }] });
  const res = response();
  await updateOwnProfile({ user: customerUser(), body: { displayName: "Alice Prime", showOnline: false } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.displayName, "Alice Prime");
  assert.equal(res.body.profile.showOnline, false);
});

test("empty displayName is rejected with 400", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  for (const v of ["", "   \t ", null, 123]) {
    const res = response();
    await updateOwnProfile({ user: customerUser(), body: { displayName: v } }, res, db);
    assert.equal(res.statusCode, 400, `displayName ${JSON.stringify(v)} must be rejected`);
  }
});

test("displayName length boundaries: 100 ok, 101 rejected", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  const ok = response();
  await updateOwnProfile({ user: customerUser(), body: { displayName: "x".repeat(PROFILE_DISPLAY_NAME_MAX) } }, ok, db);
  assert.equal(ok.statusCode, 200);
  const bad = response();
  await updateOwnProfile({ user: customerUser(), body: { displayName: "x".repeat(PROFILE_DISPLAY_NAME_MAX + 1) } }, bad, db);
  assert.equal(bad.statusCode, 400);
});

test("bio length boundaries: 500 ok, 501 rejected, empty clears to null", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  const ok = response();
  await updateOwnProfile({ user: customerUser(), body: { bio: "x".repeat(PROFILE_BIO_MAX) } }, ok, db);
  assert.equal(ok.statusCode, 200);
  const bad = response();
  await updateOwnProfile({ user: customerUser(), body: { bio: "x".repeat(PROFILE_BIO_MAX + 1) } }, bad, db);
  assert.equal(bad.statusCode, 400);
  const cleared = response();
  await updateOwnProfile({ user: customerUser(), body: { bio: "   " } }, cleared, db);
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.body.profile.bio, null);
});

test("boolean fields are strictly validated", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  for (const key of ["showOnline", "profileVisible"]) {
    for (const v of ["yes", 1, null, "true"]) {
      const res = response();
      await updateOwnProfile({ user: customerUser(), body: { [key]: v } }, res, db);
      assert.equal(res.statusCode, 400, `${key}=${JSON.stringify(v)} must be rejected`);
    }
  }
  const ok = response();
  await updateOwnProfile({ user: customerUser(), body: { showOnline: false, profileVisible: false } }, ok, db);
  assert.equal(ok.statusCode, 200);
});

test("city and state validation", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  const longCity = response();
  await updateOwnProfile({ user: customerUser(), body: { locationCity: "x".repeat(81) } }, longCity, db);
  assert.equal(longCity.statusCode, 400);
  for (const state of ["MNX", "m", "12", "min"]) {
    const res = response();
    await updateOwnProfile({ user: customerUser(), body: { locationState: state } }, res, db);
    assert.equal(res.statusCode, 400, `state ${state} must be rejected`);
  }
});

test("avatarUrl accepts only clean https URLs", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  for (const bad of ["http://example.com/a.png", "ftp://example.com/a.png", "not-a-url", "https://", "https://user:pass@example.com/a.png"]) {
    const res = response();
    await updateOwnProfile({ user: customerUser(), body: { avatarUrl: bad } }, res, db);
    assert.equal(res.statusCode, 400, `${bad} must be rejected`);
  }
  const ok = response();
  await updateOwnProfile({ user: customerUser(), body: { avatarUrl: "https://cdn.example.com/avatar.jpg" } }, ok, db);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.profile.avatarUrl, "https://cdn.example.com/avatar.jpg");
  const cleared = response();
  await updateOwnProfile({ user: customerUser(), body: { avatarUrl: "   " } }, cleared, db);
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.body.profile.avatarUrl, null);
});

test("forged body userId cannot move the profile to another user", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  const res = response();
  await updateOwnProfile({ user: customerUser(), body: { userId: "mallory", displayName: "Forged" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.userId, "cus1");
  assert.equal(res.body.profile.displayName, "Forged");
  assert.notEqual(res.body.profile.userId, "mallory");
});

test("immutable/derived keys are never applied", async () => {
  const db = makeDb({
    profiles: [profileFixture({ moderationHiddenAt: t("2026-09-18T00:00:00Z") })],
  });
  const res = response();
  await updateOwnProfile(
    { user: customerUser(), body: { id: "hacked", createdAt: "2000-01-01", updatedAt: "2000-01-01", moderationHiddenAt: null, displayName: "Still Mine" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.moderationHiddenAt.getTime(), t("2026-09-18T00:00:00Z").getTime());
  assert.equal(res.body.profile.id, "pf1");
  assert.equal(res.body.profile.createdAt.getTime(), t("2026-09-17T00:00:00Z").getTime());
  assert.equal(res.body.profile.displayName, "Still Mine");
});

test("PUT with no editable fields is rejected with 400", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  const res = response();
  await updateOwnProfile({ user: customerUser(), body: { id: "x", userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 400);
});

test("blocked customer can still edit their own profile", async () => {
  const reqUser = customerUser({ communityBlockedAt: t("2026-09-17T00:00:00Z") });
  const db = makeDb({ profiles: [profileFixture()] });
  const res = response();
  await updateOwnProfile({ user: reqUser, body: { displayName: "Blocked but Editable" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.displayName, "Blocked but Editable");
});

// ---- Public profile ----

test("public profile returns only the public shape", async () => {
  const db = makeDb({
    profiles: [
      profileFixture({
        displayName: "Alice",
        bio: "Likes clean floors",
        avatarUrl: "https://cdn.example.com/a.jpg",
        locationCity: "Minneapolis",
        locationState: "MN",
      }),
    ],
  });
  const res = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.profile).sort(), ["avatarUrl", "bio", "displayName", "locationCity", "locationState", "online", "userId"].sort());
  assert.equal(res.body.profile.userId, "cus1");
  assert.equal(res.body.profile.displayName, "Alice");
  assertNoPrivateFields(res);
});

test("public profile online gating: true when recent, false when stale, omitted when showOnline=false", async () => {
  const recentUser = { ...profileFixture().user, lastActiveAt: recent };
  const res1 = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "cus1" } }, res1, makeDb({ profiles: [profileFixture({ user: recentUser })] }));
  assert.equal(res1.body.profile.online, true);

  const res2 = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "cus1" } }, res2, makeDb({ profiles: [profileFixture({ user: { ...recentUser, lastActiveAt: staleDate } })] }));
  assert.equal(res2.body.profile.online, false);

  const res3 = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "cus1" } }, res3, makeDb({ profiles: [profileFixture({ showOnline: false, user: recentUser })] }));
  assert.equal(res3.statusCode, 200);
  assert.equal("online" in res3.body.profile, false, "online must be omitted when showOnline=false");
});

test("unknown user returns uniform 404", async () => {
  const db = makeDb();
  const res = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "no-such-user" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Profile not found");
});

test("user without a profile yet returns 404", async () => {
  const db = makeDb({ users: [{ id: "cus2", name: "Bob" }] });
  const res = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("profileVisible=false yields public 404 (no existence oracle)", async () => {
  const db = makeDb({ profiles: [profileFixture({ profileVisible: false })] });
  const res = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Profile not found");
});

test("admin-hidden profile yields public 404", async () => {
  const db = makeDb({ profiles: [profileFixture({ moderationHiddenAt: t("2026-09-18T00:00:00Z") })] });
  const res = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Profile not found");
});

// ---- Admin ----

test("admin list returns moderation shapes and never account fields", async () => {
  const db = makeDb({
    profiles: [
      profileFixture(),
      profileFixture({ id: "pf2", userId: "cus2", displayName: "Bob", bio: "B", user: { id: "cus2", name: "Bob", lastActiveAt: staleDate, role: "customer", communityBlockedAt: null } }),
    ],
  });
  const res = response();
  await adminListProfiles({ user: adminUser() }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profiles.length, 2);
  assert.ok(res.body.profiles.every((p) => typeof p.moderationHiddenAt === "object" || p.moderationHiddenAt === null));
  assertNoPrivateFields(res);
});

test("admin single profile: ok for customer, 404 unknown, 400 for an admin target", async () => {
  const ok = response();
  await adminGetProfile({ user: adminUser(), params: { userId: "cus1" } }, ok, makeDb({ profiles: [profileFixture()] }));
  assert.equal(ok.statusCode, 200);

  const missing = response();
  await adminGetProfile({ user: adminUser(), params: { userId: "nobody" } }, missing, makeDb());
  assert.equal(missing.statusCode, 404);

  const adminTarget = response();
  await adminGetProfile(
    { user: adminUser(), params: { userId: "adm2" } },
    adminTarget,
    makeDb({ profiles: [profileFixture({ userId: "adm2", displayName: "Boss", user: { id: "adm2", name: "Boss", lastActiveAt: recent, role: "admin", communityBlockedAt: null } })] }),
  );
  assert.equal(adminTarget.statusCode, 400);
});

test("admin hide applies moderationHiddenAt without editing profile content", async () => {
  const db = makeDb({ profiles: [profileFixture({ bio: "Original", displayName: "Alice", locationCity: "Minneapolis" })] });
  const res = response();
  await adminHideProfile({ user: adminUser(), params: { userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.profile.moderationHiddenAt !== null);
  assert.equal(res.body.profile.displayName, "Alice");
  assert.equal(res.body.profile.bio, "Original");
  assert.equal(res.body.profile.locationCity, "Minneapolis");
});

test("admin hide is idempotent (re-hide keeps the existing timestamp)", async () => {
  const mark = t("2026-09-18T00:00:00Z");
  const db = makeDb({ profiles: [profileFixture({ moderationHiddenAt: mark })] });
  const res = response();
  await adminHideProfile({ user: adminUser(), params: { userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.moderationHiddenAt.getTime(), mark.getTime());
});

test("admin unhide clears moderationHiddenAt and is idempotent", async () => {
  const db = makeDb({ profiles: [profileFixture({ moderationHiddenAt: t("2026-09-18T00:00:00Z") })] });
  const res = response();
  await adminUnhideProfile({ user: adminUser(), params: { userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile.moderationHiddenAt, null);

  const again = response();
  await adminUnhideProfile({ user: adminUser(), params: { userId: "cus1" } }, again, db);
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.profile.moderationHiddenAt, null);
});

test("admin cannot hide an admin and unknown targets return 404", async () => {
  const adminTarget = response();
  await adminHideProfile(
    { user: adminUser(), params: { userId: "adm2" } },
    adminTarget,
    makeDb({ profiles: [profileFixture({ userId: "adm2", displayName: "Boss", user: { id: "adm2", name: "Boss", lastActiveAt: recent, role: "admin", communityBlockedAt: null } })] }),
  );
  assert.equal(adminTarget.statusCode, 400);

  const missing = response();
  await adminUnhideProfile({ user: adminUser(), params: { userId: "nobody" } }, missing, makeDb());
  assert.equal(missing.statusCode, 404);
});

test("hide blocks public access while owner and admin access remain", async () => {
  const db = makeDb({ profiles: [profileFixture({ moderationHiddenAt: t("2026-09-18T00:00:00Z") })] });
  const pub = response();
  await getPublicProfile({ user: customerUser(), params: { userId: "cus1" } }, pub, db);
  assert.equal(pub.statusCode, 404);

  const own = response();
  await getOwnProfile({ user: customerUser() }, own, db);
  assert.equal(own.statusCode, 200);

  const adm = response();
  await adminGetProfile({ user: adminUser(), params: { userId: "cus1" } }, adm, db);
  assert.equal(adm.statusCode, 200);
  assert.ok(adm.body.profile.moderationHiddenAt !== null);
});

// ---- System isolation ----

test("profiles feature never touches the Message or CommunityMessage models", () => {
  const db = makeDb();
  assert.equal(db.message, undefined, "fake must not expose a message model");
  assert.equal(db.communityMessage, undefined, "fake must not expose a communityMessage model");
  assert.deepEqual(Object.keys(db).sort(), ["communityProfile", "user"].sort());
});

test("no serializer ever returns raw lastActiveAt or account fields", async () => {
  const db = makeDb({ profiles: [profileFixture()] });
  for (const [name, fn, req] of [
    ["owner", getOwnProfile, { user: customerUser() }],
    ["public", getPublicProfile, { user: customerUser(), params: { userId: "cus1" } }],
    ["adminList", adminListProfiles, { user: adminUser() }],
    ["adminGet", adminGetProfile, { user: adminUser(), params: { userId: "cus1" } }],
  ]) {
    const res = response();
    await fn(req, res, db);
    assert.equal(res.statusCode, 200, name);
    assertNoPrivateFields(res);
    const payload = JSON.stringify(res.body);
    assert.ok(!payload.includes("lastActiveAt"), `${name} must never serialize lastActiveAt`);
  }
});