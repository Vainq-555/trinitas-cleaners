import prisma from "../utils/prisma.js";
import {
  badRequest,
  PROFILE_DISPLAY_NAME_MAX,
  isValidAvatarUrl,
  isValidProfileBio,
  isValidProfileBoolean,
  isValidProfileCity,
  isValidProfileDisplayName,
  isValidProfileState,
} from "../utils/validators.js";
import { ONLINE_TTL_MS, ROLES } from "../config.js";

// Express 4 does not catch rejected promises from async handlers. Same `wrap`
// convention as community.js/reviews.js: Express passes `next` third; tests
// inject a fake db in that third slot.
const wrap = (fn) => (req, res, next, db = prisma) => {
  if (typeof next !== "function") [db, next] = [next, undefined];
  return Promise.resolve(fn(req, res, next, db)).catch(next);
};

// Coarse online/offline from the existing auth heartbeat. Never exposes the
// raw lastActiveAt timestamp.
const isOnline = (user) =>
  Boolean(user?.lastActiveAt) && Date.now() - user.lastActiveAt.getTime() < ONLINE_TTL_MS;

// Owner shape: every profile field + online + the admin hide state, so the
// owner always knows their own moderation status.
const ownerShape = (p, user) => ({
  id: p.id,
  userId: p.userId,
  displayName: p.displayName,
  bio: p.bio,
  avatarUrl: p.avatarUrl,
  locationCity: p.locationCity,
  locationState: p.locationState,
  showOnline: p.showOnline,
  profileVisible: p.profileVisible,
  moderationHiddenAt: p.moderationHiddenAt,
  online: isOnline(user),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

// Public shape: only what strangers may see. `online` is present ONLY when the
// owner opted in (showOnline) — which the caller restricts by visibility.
const publicShape = (p, user) => ({
  userId: p.userId,
  displayName: p.displayName,
  bio: p.bio,
  avatarUrl: p.avatarUrl,
  locationCity: p.locationCity,
  locationState: p.locationState,
  ...(p.showOnline ? { online: isOnline(user) } : {}),
});

// Admin moderation shape. Deliberately mirrors the owner shape minus nothing
// profile-specific, but never any account field (email/phone/address/role/
// status/communityBlockedAt).
const adminShape = (p, user) => ({
  id: p.id,
  userId: p.userId,
  displayName: p.displayName,
  bio: p.bio,
  avatarUrl: p.avatarUrl,
  locationCity: p.locationCity,
  locationState: p.locationState,
  showOnline: p.showOnline,
  profileVisible: p.profileVisible,
  moderationHiddenAt: p.moderationHiddenAt,
  online: isOnline(user),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

// Fields the owner may set through PUT /api/profile. Immutable/derived keys
// (id, userId, createdAt, updatedAt, moderationHiddenAt) are never accepted.
const EDITABLE = [
  "displayName",
  "bio",
  "avatarUrl",
  "locationCity",
  "locationState",
  "showOnline",
  "profileVisible",
];

function profileInclude() {
  return { user: { select: { id: true, name: true, lastActiveAt: true, role: true, communityBlockedAt: true } } };
}

// Lazy 1:1 creation on first access. displayName defaults to the account's
// current User.name. No backfill migration is performed.
async function ensureProfile(db, userId) {
  const existing = await db.communityProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  try {
    return await db.communityProfile.create({
      data: { userId, displayName: user.name, bio: null },
    });
  } catch (err) {
    // Unique race: another request created it between find and create.
    if (err?.code === "P2002") {
      return db.communityProfile.findUnique({ where: { userId } });
    }
    throw err;
  }
}

// Refuses site admins as moderation targets (mirrors community moderation).
async function findCustomerProfile(db, userId) {
  const profile = await db.communityProfile.findUnique({
    where: { userId },
    include: profileInclude(),
  });
  if (!profile) return { error: "Profile not found", status: 404 };
  if (profile.user?.role === ROLES.ADMIN) {
    return { error: "Community profile moderation applies to customers only", status: 400 };
  }
  return { profile };
}

// ---- Customer ---- //

// Defense in depth: requireCustomer normally keeps admins out, but never embed
// a role assumption in the handler (same parity guard as community.js).
const guardCustomer = (req, res) => {
  if (!req.user || req.user.role !== ROLES.CUSTOMER) {
    res.status(403).json({ error: "Only customers can manage community profiles" });
    return false;
  }
  return true;
};

// GET /api/profile — the caller's own profile, always available (hidden or not).
export const getOwnProfile = wrap(async function getOwnProfile(req, res, next, db = prisma) {
  if (!guardCustomer(req, res)) return;
  const profile = await ensureProfile(db, req.user.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  res.json({ profile: ownerShape(profile, req.user) });
});

// PUT /api/profile — partial update of editable fields only. Ownership is
// always req.user.id; a body-supplied userId/immutable key is never applied.
export const updateOwnProfile = wrap(async function updateOwnProfile(req, res, next, db = prisma) {
  if (!guardCustomer(req, res)) return;
  const body = req.body || {};
  const data = {};

  if (body.displayName !== undefined) {
    if (!isValidProfileDisplayName(body.displayName)) {
      return badRequest(res, `displayName must be 1 to ${PROFILE_DISPLAY_NAME_MAX} characters`);
    }
    data.displayName = body.displayName.trim();
  }
  if (body.bio !== undefined) {
    if (!isValidProfileBio(body.bio)) return badRequest(res, "bio must be 500 characters or fewer");
    data.bio = typeof body.bio === "string" && body.bio.trim() ? body.bio.trim() : null;
  }
  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl === null || (typeof body.avatarUrl === "string" && !body.avatarUrl.trim())) {
      data.avatarUrl = null;
    } else if (!isValidAvatarUrl(body.avatarUrl)) {
      return badRequest(res, "avatarUrl must be a valid https URL");
    } else {
      data.avatarUrl = body.avatarUrl.trim();
    }
  }
  if (body.locationCity !== undefined) {
    if (!isValidProfileCity(body.locationCity)) return badRequest(res, "locationCity is too long");
    data.locationCity = typeof body.locationCity === "string" && body.locationCity.trim() ? body.locationCity.trim() : null;
  }
  if (body.locationState !== undefined) {
    if (!isValidProfileState(body.locationState)) return badRequest(res, "locationState must be a two-letter code");
    data.locationState = typeof body.locationState === "string" && body.locationState.trim() ? body.locationState.trim().toUpperCase() : null;
  }
  if (body.showOnline !== undefined) {
    if (!isValidProfileBoolean(body.showOnline)) return badRequest(res, "showOnline must be a boolean");
    data.showOnline = body.showOnline;
  }
  if (body.profileVisible !== undefined) {
    if (!isValidProfileBoolean(body.profileVisible)) return badRequest(res, "profileVisible must be a boolean");
    data.profileVisible = body.profileVisible;
  }

  // No editable keys provided -> 400 so a client knows nothing changed.
  if (Object.keys(data).length === 0) return badRequest(res, "No editable profile fields provided");

  const profile = await ensureProfile(db, req.user.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  const updated = await db.communityProfile.update({
    where: { id: profile.id },
    data,
  });
  res.json({ profile: ownerShape(updated, req.user) });
});

// GET /api/profile/:userId — public profile. Uniform 404 for: unknown user,
// no profile yet, profileVisible=false, or admin-hidden. No existence oracle.
export const getPublicProfile = wrap(async function getPublicProfile(req, res, next, db = prisma) {
  if (!guardCustomer(req, res)) return;
  const { userId } = req.params;
  if (typeof userId !== "string" || !userId) return badRequest(res, "User id is required");

  const profile = await db.communityProfile.findUnique({
    where: { userId },
    include: profileInclude(),
  });
  if (!profile || profile.profileVisible === false || profile.moderationHiddenAt) {
    return res.status(404).json({ error: "Profile not found" });
  }
  res.json({ profile: publicShape(profile, profile.user) });
});

// ---- Admin ---- //

// GET /api/admin/community/profiles — moderation grid of customer profiles.
export const adminListProfiles = wrap(async function adminListProfiles(req, res, next, db = prisma) {
  const rows = await db.communityProfile.findMany({
    include: profileInclude(),
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
  });
  res.json({ profiles: rows.map((p) => adminShape(p, p.user)) });
});

// GET /api/admin/community/profiles/:userId — single moderation view.
export const adminGetProfile = wrap(async function adminGetProfile(req, res, next, db = prisma) {
  const { userId } = req.params;
  if (typeof userId !== "string" || !userId) return badRequest(res, "User id is required");

  const result = await findCustomerProfile(db, userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ profile: adminShape(result.profile, result.profile.user) });
});

// POST /api/admin/community/profiles/:userId/hide — explicit, auditable
// moderation. Never edits customer profile content.
export const adminHideProfile = wrap(async function adminHideProfile(req, res, next, db = prisma) {
  const { userId } = req.params;
  if (typeof userId !== "string" || !userId) return badRequest(res, "User id is required");

  const result = await findCustomerProfile(db, userId);
  if (result.error) return res.status(result.status).json({ error: result.error });

  const updated = await db.communityProfile.update({
    where: { id: result.profile.id },
    data: { moderationHiddenAt: result.profile.moderationHiddenAt ?? new Date() },
  });
  res.json({ ok: true, profile: adminShape(updated, result.profile.user) });
});

// POST /api/admin/community/profiles/:userId/unhide — clears the hide timestamp.
export const adminUnhideProfile = wrap(async function adminUnhideProfile(req, res, next, db = prisma) {
  const { userId } = req.params;
  if (typeof userId !== "string" || !userId) return badRequest(res, "User id is required");

  const result = await findCustomerProfile(db, userId);
  if (result.error) return res.status(result.status).json({ error: result.error });

  const updated = await db.communityProfile.update({
    where: { id: result.profile.id },
    data: { moderationHiddenAt: null },
  });
  res.json({ ok: true, profile: adminShape(updated, result.profile.user) });
});