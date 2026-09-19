import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requireCustomer } from "../src/middleware/auth.js";
import { ROLES } from "../src/config.js";
import {
  createGroup,
  getGroup,
  groupCreateLimiter,
  groupMembershipLimiter,
  groupMessagePerGroupLimiter,
  groupMessagePerCustomerLimiter,
  joinGroup,
  leaveGroup,
  listGroups,
  listGroupMembers,
  listGroupMessages,
  sendGroupMessage,
  deleteGroupMessage,
  updateGroup,
  removeGroupMember,
  transferGroupOwner,
  dissolveGroup,
  getInviteCode,
  generateInviteCode,
  disableInviteCode,
  joinGroupWithCode,
  GROUP_DESC_MAX,
  GROUP_MESSAGE_MAX,
  GROUP_NAME_MAX,
  GROUP_TYPES,
  GROUP_TYPE_PUBLIC,
  GROUP_TYPE_PRIVATE,
  GROUP_TYPE_INVITE_ONLY,
} from "../src/controllers/groups.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const t = (s) => new Date(s);

const P2002 = () => { const e = new Error("Unique constraint failed"); e.code = "P2002"; return e; };
const P2025 = () => { const e = new Error("Record not found"); e.code = "P2025"; return e; };

const userFixture = (overrides = {}) => ({
  id: "cus1",
  name: "Alice",
  role: ROLES.CUSTOMER,
  communityBlockedAt: null,
  ...overrides,
});

const groupFixture = (overrides = {}) => ({
  id: "grp1",
  ownerId: "cus1",
  name: "Cleaning Hacks",
  description: "Share cleaning tips",
  type: "public",
  createdAt: t("2026-09-01T00:00:00Z"),
  updatedAt: t("2026-09-01T00:00:00Z"),
  dissolvedAt: null,
  owner: { id: "cus1", name: "Alice" },
  ...overrides,
});

const memberFixture = (overrides = {}) => ({
  groupId: "grp1",
  userId: "cus1",
  joinedAt: t("2026-09-02T00:00:00Z"),
  ...overrides,
});

const clone = (o) => structuredClone(o);

// In-memory fake of prisma.group + prisma.groupMember + prisma.groupMessage for
// the injected-db test pattern (same as makeDb in community.test.js). Honors
// scalar where-filters (including Date equality, {lt} ranges, {in} lists and OR
// groups), multi-key orderBy and take. groupMember.create throws a real P2002 on
// the composite key (groupId, userId); delete throws P2025 when absent.
// groupMessage embeds the sender row (and groupMember the user row) from the
// `users` pool when an include requests it, so the controller-owned sender/member
// shapes can be exercised. $transaction runs the callback against the live store
// and rolls the store back if it throws — the same all-or-nothing guarantee
// Prisma gives in production.
const makeDb = ({ users = [], groups = [], members = [], messages = [], failMemberCreate = false } = {}) => {
  const state = {
    users: users.map(clone),
    groups: groups.map(clone),
    members: members.map(clone),
    messages: messages.map(clone),
  };
  let seq = 0;
  let msgSeq = 0;
  const snapshot = () => ({
    users: state.users.map(clone),
    groups: state.groups.map(clone),
    members: state.members.map(clone),
    messages: state.messages.map(clone),
  });
  const restore = (s) => {
    state.users = s.users;
    state.groups = s.groups;
    state.members = s.members;
    state.messages = s.messages;
  };

  function leafMatch(row, k, v) {
    if (v instanceof Date) return row[k] instanceof Date ? row[k].getTime() === v.getTime() : row[k] === v;
    if (v !== null && typeof v === "object" && Array.isArray(v.in)) return v.in.includes(row[k]);
    if (v !== null && typeof v === "object" && v.lt !== undefined) return row[k] < v.lt;
    return row[k] === v;
  }
  function condMatch(row, cond) {
    return Object.entries(cond).every(([k, v]) => leafMatch(row, k, v));
  }
  function rowMatch(row, where) {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === "OR") return v.some((sub) => condMatch(row, sub));
      return leafMatch(row, k, v);
    });
  }
  function sortRows(rows, orderBy) {
    function cmp(a, b) {
      if (typeof a === "string") return a < b ? -1 : a > b ? 1 : 0;
      return a - b;
    }
    return [...rows].sort((a, b) => {
      for (const ob of orderBy || []) {
        const key = Object.keys(ob)[0];
        const dir = ob[key];
        const c = cmp(a[key], b[key]);
        if (c !== 0) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  const embedUser = (m) => {
    const u = state.users.find((x) => x.id === m.userId);
    if (u) m.user = clone(u);
    return m;
  };
  const embedSender = (m) => {
    const u = state.users.find((x) => x.id === m.senderId);
    if (u) m.sender = clone(u);
    return m;
  };

  const db = {
    user: {
      findUnique: async ({ where }) => {
        const row = state.users.find((r) => r.id === where.id);
        return row ? clone(row) : null;
      },
    },
    group: {
      findMany: async ({ where, orderBy, take } = {}) => {
        let out = state.groups.filter((r) => rowMatch(r, where));
        out = sortRows(out, orderBy);
        if (take !== undefined) out = out.slice(0, take);
        return out.map(clone);
      },
      findFirst: async ({ where } = {}) => {
        const row = state.groups.find((r) => rowMatch(r, where));
        return row ? clone(row) : null;
      },
      create: async ({ data }) => {
        const g = {
          id: `g${++seq}`,
          createdAt: t("2026-09-30T00:00:00Z"),
          updatedAt: t("2026-09-30T00:00:00Z"),
          ...data,
        };
        state.groups.push(g);
        return clone(g);
      },
      update: async ({ where, data }) => {
        const i = state.groups.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        const updated = {
          ...state.groups[i],
          ...data,
          updatedAt: t("2026-09-30T00:03:00Z"),
        };
        state.groups[i] = updated;
        return clone(updated);
      },
    },
    groupMember: {
      findMany: async ({ where, orderBy, take, include } = {}) => {
        let out = state.members.filter((r) => rowMatch(r, where));
        out = sortRows(out, orderBy);
        if (take !== undefined) out = out.slice(0, take);
        const rows = out.map(clone);
        if (include?.user) rows.forEach(embedUser);
        return rows;
      },
      create: async ({ data }) => {
        if (failMemberCreate) throw new Error("injected member-create failure");
        if (state.members.some((r) => r.groupId === data.groupId && r.userId === data.userId)) throw P2002();
        const m = { groupId: data.groupId, userId: data.userId, joinedAt: t("2026-09-30T00:01:00Z") };
        state.members.push(m);
        return clone(m);
      },
      delete: async ({ where }) => {
        const { groupId, userId } = where.groupId_userId;
        const i = state.members.findIndex((r) => r.groupId === groupId && r.userId === userId);
        if (i < 0) throw P2025();
        const [row] = state.members.splice(i, 1);
        return clone(row);
      },
    },
    groupMessage: {
      findMany: async ({ where, orderBy, take } = {}) => {
        let out = state.messages.filter((r) => rowMatch(r, where));
        out = sortRows(out, orderBy);
        if (take !== undefined) out = out.slice(0, take);
        return out.map((r) => embedSender(clone(r)));
      },
      findFirst: async ({ where } = {}) => {
        const row = state.messages.find((r) => rowMatch(r, where));
        return row ? embedSender(clone(row)) : null;
      },
      create: async ({ data }) => {
        const gm = {
          id: `m${++msgSeq}`,
          createdAt: t("2026-09-30T00:02:00Z"),
          deletedAt: null,
          deletedById: null,
          ...data,
        };
        state.messages.push(gm);
        return embedSender(clone(gm));
      },
      update: async ({ where, data }) => {
        const i = state.messages.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        const updated = { ...state.messages[i], ...data };
        state.messages[i] = updated;
        return embedSender(clone(updated));
      },
    },
    $transaction: async (fn) => {
      const before = snapshot();
      try {
        return await fn(db);
      } catch (error) {
        restore(before);
        throw error;
      }
    },
  };
  return db;
};

// CommunityProfile embed for a user row in the fake's `users` pool. Everything
// the group shapes read lives here: displayName, avatarUrl, showOnline.
const profileEmbed = (overrides = {}) => ({
  id: "pro1",
  userId: "cus1",
  displayName: "Alice",
  bio: "Hi from a cleaner",
  avatarUrl: "https://cdn.example.com/alice.png",
  locationCity: null,
  locationState: null,
  showOnline: true,
  profileVisible: true,
  createdAt: t("2026-08-01T00:00:00Z"),
  updatedAt: t("2026-08-01T00:00:00Z"),
  ...overrides,
});

// A full User row for the fake's `users` pool (what user.findUnique returns).
// communityProfile is optional; when null the identity falls back to name.
const userRow = (overrides = {}) => ({
  id: "cus1",
  name: "Alice",
  role: ROLES.CUSTOMER,
  communityBlockedAt: null,
  lastActiveAt: null,
  communityProfile: null,
  ...overrides,
});

const messageFixture = (overrides = {}) => ({
  id: "msg1",
  groupId: "grp1",
  senderId: "cus1",
  content: "Hello group!",
  createdAt: t("2026-09-02T00:00:00Z"),
  deletedAt: null,
  deletedById: null,
  ...overrides,
});

// Convenience: build a membership row and the matching user row. The caller
// spreads `member` into the members pool and `user` into the users pool.
const memberWithUser = (memberOverrides = {}, userOverrides = {}) => {
  const m = memberFixture(memberOverrides);
  return { member: m, user: userRow({ id: m.userId, name: m.userId === "cus1" ? "Alice" : "Bob", ...userOverrides }) };
};

const nowMinus = (ms) => new Date(Date.now() - ms);

const genGroups = (n, overrides = {}) =>
  Array.from({ length: n }, (_, idx) =>
    groupFixture({
      id: `g${String(idx).padStart(3, "0")}`,
      name: `Group ${idx}`,
      createdAt: t(`2026-09-01T00:00:${String(idx).padStart(2, "0")}Z`),
      owner: { id: "cus1", name: "Alice" },
      ...overrides,
    }),
  );

// -------------------- Auth (401) --------------------

test("groups: unauthenticated list is blocked with 401", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("groups: unauthenticated create is blocked with 401", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("groups: unauthenticated detail is blocked with 401", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("groups: unauthenticated join is blocked with 401", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("groups: unauthenticated leave is blocked with 401", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("groups: an admin cannot use the customer group endpoints (403)", async () => {
  const db = makeDb();
  const admin = { id: "adm1", role: "admin" };
  const cases = [
    ['createGroup', { user: admin, body: { name: "X", type: "public" } }],
    ['listGroups', { user: admin, query: {} }],
    ['getGroup', { user: admin, params: { groupId: "grp1" } }],
    ['joinGroup', { user: admin, params: { groupId: "grp1" } }],
    ['leaveGroup', { user: admin, params: { groupId: "grp1" } }],
  ];
  for (const [fn, req] of cases) {
    const res = response();
    const handler = { createGroup, listGroups, getGroup, joinGroup, leaveGroup }[fn];
    await handler(req, res, db);
    assert.equal(res.statusCode, 403, `${fn} should reject admins`);
  }
});

// -------------------- Create --------------------

test("create: valid public group succeeds and creator is owner + first member", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup(
    { user: userFixture(), body: { name: "  Cleaning Hacks  ", description: "  Share tips  ", type: "public" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.group.name, "Cleaning Hacks");
  assert.equal(res.body.group.description, "Share tips");
  assert.equal(res.body.group.type, "public");
  assert.equal(res.body.group.joined, true);
  assert.equal(res.body.group.memberCount, 1);
  assert.equal(res.body.group.owner.id, "cus1");

  const [group] = await db.group.findMany({});
  assert.equal(group.ownerId, "cus1");
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1);
  assert.equal(members[0].groupId, group.id);
  assert.equal(members[0].userId, "cus1");
});

test("create: ownerId in the body cannot override the authenticated owner", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup(
    { user: userFixture(), body: { name: "Mine", type: "public", ownerId: "mallory" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.group.owner.id, "cus1");
  const [group] = await db.group.findMany({});
  assert.equal(group.ownerId, "cus1");
});

test("create: description null and empty/whitespace clear to null", async () => {
  groupCreateLimiter._reset();
  for (const description of [null, "", "   "]) {
    const db = makeDb();
    const res = response();
    await createGroup({ user: userFixture(), body: { name: "No Desc", type: "public", description } }, res, db);
    assert.equal(res.statusCode, 201, `description=${JSON.stringify(description)} should be accepted`);
    assert.equal(res.body.group.description, null);
    const [group] = await db.group.findMany({});
    assert.equal(group.description, null);
  }
});

test("create: non-string description is rejected with 400", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup({ user: userFixture(), body: { name: "X", type: "public", description: 123 } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /description must be a string/);
});

test("create: missing and whitespace-only name are rejected with 400", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  for (const name of [undefined, "", "   \t  "]) {
    const res = response();
    await createGroup({ user: userFixture(), body: { name, type: "public" } }, res, db);
    assert.equal(res.statusCode, 400, "empty name should be rejected");
    assert.equal(res.body.error, "name is required");
  }
});

test("create: name over 100 characters is rejected with 400", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup({ user: userFixture(), body: { name: "x".repeat(101), type: "public" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, `name must be ${GROUP_NAME_MAX} characters or fewer`);
});

test("create: exactly 100-character name succeeds", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup({ user: userFixture(), body: { name: "x".repeat(100), type: "public" } }, res, db);
  assert.equal(res.statusCode, 201);
});

test("create: description over 500 characters is rejected with 400", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup({ user: userFixture(), body: { name: "X", type: "public", description: "x".repeat(501) } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, `description must be ${GROUP_DESC_MAX} characters or fewer`);
});

test("create: invalid type values are rejected with 400", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  for (const type of ["gossip", "PUBLIC", "public ", "", 123, null, undefined]) {
    const res = response();
    await createGroup({ user: userFixture(), body: { name: "X", type } }, res, db);
    assert.equal(res.statusCode, 400, `type=${JSON.stringify(type)} should be rejected`);
    assert.equal(res.body.error, 'type must be "public", "private" or "invite_only"');
  }
  assert.equal((await db.group.findMany({})).length, 0);
});

test("create: the accepted type constants are public, private and invite_only", () => {
  assert.equal(GROUP_TYPE_PUBLIC, "public");
  assert.equal(GROUP_TYPE_PRIVATE, "private");
  assert.equal(GROUP_TYPE_INVITE_ONLY, "invite_only");
  assert.deepEqual(GROUP_TYPES, ["public", "private", "invite_only"]);
});

test("create: a private group succeeds and the creator is owner + first member", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup({ user: userFixture(), body: { name: "Secret Circle", type: "private" } }, res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.group.type, "private");
  assert.equal(res.body.group.requiresInvite, false);
  assert.equal(res.body.group.joined, true);
  assert.equal(res.body.group.memberCount, 1);
  assert.equal(res.body.group.inviteCode, undefined, "the code is never returned on create");

  const [group] = await db.group.findMany({});
  assert.equal(group.type, "private");
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1);
  assert.equal(members[0].userId, "cus1");
});

test("create: an invite_only group succeeds and is flagged as invite-gated", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup({ user: userFixture(), body: { name: "Invite Club", type: "invite_only" } }, res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.group.type, "invite_only");
  assert.equal(res.body.group.requiresInvite, true);
  assert.equal((await db.group.findMany({}))[0].type, "invite_only");
});

test("create: malformed or non-object bodies are rejected with 400", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  for (const body of [null, [], "just a string", 42]) {
    const res = response();
    await createGroup({ user: userFixture(), body }, res, db);
    assert.equal(res.statusCode, 400, "non-object body should be rejected");
    assert.equal(res.body.error, "Request body must be a JSON object");
  }
});

test("create: blocked customer cannot create (403)", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  const res = response();
  await createGroup(
    { user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), body: { name: "X", type: "public" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "You are blocked from community groups");
  assert.equal((await db.group.findMany({})).length, 0);
});

test("create: group and member are created atomically (rollback on member failure)", async () => {
  groupCreateLimiter._reset();
  const db = makeDb({ failMemberCreate: true });
  let caught = null;
  const res = response();
  await createGroup(
    { user: userFixture(), body: { name: "X", type: "public" } },
    res,
    (error) => { caught = error; },
    db,
  );
  assert.ok(caught instanceof Error, "failure must propagate to the next handler");
  assert.equal((await db.group.findMany({})).length, 0, "group must not remain after a failed membership create");
  assert.equal((await db.groupMember.findMany({})).length, 0);
});

// -------------------- Discovery --------------------

test("discovery: public and invite_only groups appear, private and dissolved do not", async () => {
  const db = makeDb({
    groups: [
      groupFixture({ id: "g1", name: "public one" }),
      groupFixture({ id: "g2", name: "dissolved one", dissolvedAt: t("2026-09-05T00:00:00Z") }),
      groupFixture({ id: "g3", name: "private one", type: "private" }),
      groupFixture({ id: "g4", name: "invite one", type: "invite_only" }),
    ],
  });
  const res = response();
  await listGroups({ user: userFixture(), query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  // Same createdAt for all fixtures, so id DESC wins: g4 (invite_only) then g1 (public).
  assert.deepEqual(res.body.items.map((g) => g.id), ["g4", "g1"]);
  assert.equal(res.body.items.find((g) => g.id === "g4").requiresInvite, true, "invite_only groups are flagged for the UI");
  assert.equal(res.body.items.find((g) => g.id === "g1").requiresInvite, false);
  const payload = JSON.stringify(res.body);
  assert.ok(!payload.toLowerCase().includes("invitecode"), "the invite code must never leak into discovery");
});

test("discovery: default limit is 50 and returns hasMore/nextCursor correctly", async () => {
  const db = makeDb({ groups: genGroups(60) });
  const res = response();
  await listGroups({ user: userFixture(), query: {} }, res, db);
  assert.equal(res.body.items.length, 50);
  assert.equal(res.body.hasMore, true);
  assert.ok(typeof res.body.nextCursor === "string" && res.body.nextCursor.length > 0);
});

test("discovery: limit 1 works", async () => {
  const db = makeDb({ groups: genGroups(5) });
  const res = response();
  await listGroups({ user: userFixture(), query: { limit: "1" } }, res, db);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.hasMore, true);
});

test("discovery: exactly 50 groups yields hasMore false and nextCursor null", async () => {
  const db = makeDb({ groups: genGroups(50) });
  const res = response();
  await listGroups({ user: userFixture(), query: {} }, res, db);
  assert.equal(res.body.items.length, 50);
  assert.equal(res.body.hasMore, false);
  assert.equal(res.body.nextCursor, null);
});

test("discovery: limit 100 works", async () => {
  const db = makeDb({ groups: genGroups(120) });
  const res = response();
  await listGroups({ user: userFixture(), query: { limit: "100" } }, res, db);
  assert.equal(res.body.items.length, 100);
  assert.equal(res.body.hasMore, true);
});

test("discovery: invalid limits are rejected with 400", async () => {
  const db = makeDb();
  for (const limit of ["0", "-1", "101", "abc", "1.5", "[]"]) {
    const res = response();
    await listGroups({ user: userFixture(), query: { limit } }, res, db);
    assert.equal(res.statusCode, 400, `limit=${limit} should be rejected`);
    assert.match(res.body.error, /limit must be an integer/);
  }
});

test("discovery: malformed cursors are rejected with 400", async () => {
  const db = makeDb();
  const badCursors = ["not-a-cursor", Buffer.from("not json", "utf8").toString("base64url")];
  for (const before of badCursors) {
    const res = response();
    await listGroups({ user: userFixture(), query: { limit: 10, before } }, res, db);
    assert.equal(res.statusCode, 400, `cursor ${before} should be rejected`);
    assert.match(res.body.error, /before must be a valid cursor/);
  }
});

test("discovery: a malformed cursor payload (missing id / bad t) is rejected with 400", async () => {
  const db = makeDb();
  const noId = Buffer.from(JSON.stringify({ t: 1725144000000 })).toString("base64url");
  const badT = Buffer.from(JSON.stringify({ t: "now", i: "g1" })).toString("base64url");
  for (const before of [noId, badT]) {
    const res = response();
    await listGroups({ user: userFixture(), query: { limit: 10, before } }, res, db);
    assert.equal(res.statusCode, 400);
  }
});

test("discovery: stable cursor pagination does not duplicate items across pages", async () => {
  const same = t("2026-09-01T00:00:00Z");
  const db = makeDb({
    groups: ["g6", "g1", "g5", "g3", "g4", "g2"].map((id) => groupFixture({ id, createdAt: same })),
  });
  const page1 = response();
  await listGroups({ user: userFixture(), query: { limit: 2 } }, page1, db);
  assert.deepEqual(page1.body.items.map((g) => g.id), ["g6", "g5"]);
  assert.equal(page1.body.hasMore, true);

  const page2 = response();
  await listGroups({ user: userFixture(), query: { limit: 2, before: page1.body.nextCursor } }, page2, db);
  assert.deepEqual(page2.body.items.map((g) => g.id), ["g4", "g3"]);
  assert.equal(page2.body.hasMore, true);

  const page3 = response();
  await listGroups({ user: userFixture(), query: { limit: 2, before: page2.body.nextCursor } }, page3, db);
  assert.deepEqual(page3.body.items.map((g) => g.id), ["g2", "g1"]);
  assert.equal(page3.body.hasMore, false);
  assert.equal(page3.body.nextCursor, null);
});

test("discovery: joined is derived from the authenticated customer only", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "g1" }), groupFixture({ id: "g2", ownerId: "cus2" })],
    members: [
      memberFixture({ groupId: "g1", userId: "cus1" }),
      memberFixture({ groupId: "g2", userId: "cus2" }),
    ],
  });
  const asCus1 = response();
  await listGroups({ user: userFixture(), query: {} }, asCus1, db);
  assert.equal(asCus1.body.items.find((g) => g.id === "g1").joined, true);
  assert.equal(asCus1.body.items.find((g) => g.id === "g2").joined, false);

  const asCus2 = response();
  await listGroups({ user: userFixture({ id: "cus2", name: "Bob" }), query: {} }, asCus2, db);
  assert.equal(asCus2.body.items.find((g) => g.id === "g1").joined, false);
  assert.equal(asCus2.body.items.find((g) => g.id === "g2").joined, true);

  assert.equal(asCus1.body.items.find((g) => g.id === "g2").memberCount, 1);
  assert.equal(asCus2.body.items.find((g) => g.id === "g2").memberCount, 1);
});

test("discovery: memberCount is derived server-side from membership rows", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "g1" })],
    members: [
      memberFixture({ groupId: "g1", userId: "cus1" }),
      memberFixture({ groupId: "g1", userId: "cus2" }),
      memberFixture({ groupId: "g1", userId: "cus3" }),
    ],
  });
  const res = response();
  await listGroups({ user: userFixture(), query: {} }, res, db);
  assert.equal(res.body.items[0].memberCount, 3);
});

test("discovery: sensitive User fields are never leaked", async () => {
  const db = makeDb({
    groups: [
      groupFixture({
        owner: {
          id: "cus1",
          name: "Alice",
          email: "alice@x.com",
          phone: "555-1234",
          address: "1 Main St",
          status: "online",
          lastActiveAt: t("2026-09-30T00:00:00Z"),
          passwordHash: "hashed-credential",
          role: "customer",
          communityBlockedAt: t("2026-09-01T00:00:00Z"),
          moderationHiddenAt: t("2026-09-01T00:00:00Z"),
        },
      }),
    ],
  });
  const res = response();
  await listGroups({ user: userFixture(), query: {} }, res, db);
  const item = res.body.items[0];
  assert.deepEqual(item.owner, undefined);
  assert.equal(item.ownerId, undefined);
  assert.equal(item.dissolvedAt, undefined);
  const payload = JSON.stringify(res.body);
  for (const forbidden of ["email", "phone", "address", "password", "status", "lastActiveAt", "secret", "credential"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `list payload must not contain ${forbidden}`);
  }
});

// -------------------- G1f: non-public groups & invite codes --------------------

test("G1f: a member of a private group sees its detail with offers but no code", async () => {
  const db = makeDb({
    groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })],
    members: [memberFixture(), memberFixture({ userId: "cus2" })],
  });
  const res = response();
  await getGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group.type, "private");
  assert.equal(res.body.group.requiresInvite, false);
  const payload = JSON.stringify(res.body);
  assert.ok(!payload.includes("secretcode123"), "the invite code must never appear in detail");
});

test("G1f: a member of an invite_only group sees its detail flagged invite-gated", async () => {
  const db = makeDb({
    groups: [groupFixture({ type: "invite_only", inviteCode: "secretcode123" })],
    members: [memberFixture()],
  });
  const res = response();
  await getGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group.type, "invite_only");
  assert.equal(res.body.group.requiresInvite, true);
});

test("G1f: private and invite_only details are a uniform 404 for non-members", async () => {
  for (const type of ["private", "invite_only"]) {
    const db = makeDb({ groups: [groupFixture({ type, inviteCode: "secretcode123" })] });
    const res = response();
    await getGroup({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" } }, res, db);
    assert.equal(res.statusCode, 404, `${type} must hide from non-members`);
    assert.equal(res.body.error, "Group not found");
  }
});

test("G1f: a private group joins by its exact invite code", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })] });
  const res = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { code: "secretcode123" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1);
  assert.equal(members[0].userId, "cus1");
});

test("G1f: a wrong or missing code for a non-public group is a uniform 404", async () => {
  groupMembershipLimiter._reset();
  for (const body of [{ code: "wrong-code" }, {}, null]) {
    const db = makeDb({ groups: [groupFixture({ type: "invite_only", inviteCode: "secretcode123" })] });
    const res = response();
    await joinGroup({ user: userFixture(), params: { groupId: "grp1" }, body }, res, db);
    assert.equal(res.statusCode, 404, "wrong/missing code must behave as a missing group");
    assert.equal((await db.groupMember.findMany({})).length, 0);
  }
});

test("G1f: a non-public group with no code issued yet cannot be joined by path", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private" })] });
  const res = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { code: "secretcode123" } }, res, db);
  assert.equal(res.statusCode, 404, "no stored code means no join is possible");
});

test("G1f: the owner of a non-public group cannot leave (400)", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "invite_only" })], members: [memberFixture()] });
  const res = response();
  await leaveGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /[Tt]ransfer ownership or dissolve/);
});

test("G1f: a non-member can leave a non-public group idempotently", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private" })], members: [memberFixture({ userId: "cus2" })] });
  const res = response();
  await leaveGroup({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1, "cus2's membership must remain");
});

test("G1f: a member of an invite_only group reads the message feed", async () => {
  const db = makeDb({
    groups: [groupFixture({ type: "invite_only" })],
    members: [memberFixture()],
    users: [userRow({ id: "cus1" })],
    messages: [messageFixture({ id: "msg1" })],
  });
  const res = response();
  await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages.map((m) => m.id), ["msg1"]);
});

test("G1f: a non-member cannot read or write messages of a non-public group (404)", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })] });
  const roster = response();
  await listGroupMembers({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" }, query: {} }, roster, db);
  assert.equal(roster.statusCode, 404);
  const feed = response();
  await listGroupMessages({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" }, query: {} }, feed, db);
  assert.equal(feed.statusCode, 404);
});

test("G1f: a member of a private group can send a message", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({
    groups: [groupFixture({ type: "private" })],
    members: [memberFixture()],
  });
  const res = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "inside" } }, res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message.content, "inside");
});

test("G1f: a member of an invite_only group can delete their own message", async () => {
  const db = makeDb({
    groups: [groupFixture({ type: "invite_only" })],
    members: [memberFixture()],
    messages: [messageFixture({ senderId: "cus1" })],
  });
  const res = response();
  await deleteGroupMessage({ user: userFixture(), params: { groupId: "grp1", messageId: "msg1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.deleted, true);
});

test("G1f: the owner can update, remove from, transfer and dissolve their own non-public group", async () => {
  const updater = makeDb({ groups: [groupFixture({ type: "invite_only" })], members: [memberFixture(), memberFixture({ userId: "cus2" })], users: [userRow({ id: "cus2", name: "Bob" })] });
  const up = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name: "Renamed Private" } }, up, updater);
  assert.equal(up.statusCode, 200);
  assert.equal(up.body.group.name, "Renamed Private");

  const remover = makeDb({ groups: [groupFixture({ type: "private" })], members: [memberFixture(), memberFixture({ userId: "cus2" })] });
  const rm = response();
  await removeGroupMember({ user: userFixture(), params: { groupId: "grp1", userId: "cus2" } }, rm, remover);
  assert.equal(rm.statusCode, 200);
  assert.equal((await remover.groupMember.findMany({})).length, 1);

  const transferrer = makeDb({ groups: [groupFixture({ type: "invite_only" })], members: [memberFixture(), memberFixture({ userId: "cus2" })], users: [userRow({ id: "cus2", name: "Bob" })] });
  const tr = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "cus2" } }, tr, transferrer);
  assert.equal(tr.statusCode, 200);
  assert.deepEqual(tr.body.group.owner, { id: "cus2", name: "Bob" });

  const dissolver = makeDb({ groups: [groupFixture({ type: "private" })], members: [memberFixture()] });
  const ds = response();
  await dissolveGroup({ user: userFixture(), params: { groupId: "grp1" } }, ds, dissolver);
  assert.equal(ds.statusCode, 200);
  assert.equal(ds.body.dissolved, true);
});

test("G1f: non-owners probing a non-public group get a uniform 404, never 403", async () => {
  // cus3 is an authenticated customer with no membership in a private group the
  // owner cus1 runs. Every owner-scoped action and the code endpoints must look
  // exactly like a missing group.
  const db = makeDb({
    groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus3", name: "Carol" })],
  });
  const user = userFixture({ id: "cus3", name: "Carol" });
  const cases = [
    ["updateGroup", { user, params: { groupId: "grp1" }, body: { name: "X" } }],
    ["removeGroupMember", { user, params: { groupId: "grp1", userId: "cus2" } }],
    ["transferGroupOwner", { user, params: { groupId: "grp1" }, body: { userId: "cus2" } }],
    ["dissolveGroup", { user, params: { groupId: "grp1" } }],
    ["getInviteCode", { user, params: { groupId: "grp1" } }],
    ["generateInviteCode", { user, params: { groupId: "grp1" } }],
    ["disableInviteCode", { user, params: { groupId: "grp1" } }],
  ];
  const handlers = {
    updateGroup,
    removeGroupMember,
    transferGroupOwner,
    dissolveGroup,
    getInviteCode,
    generateInviteCode,
    disableInviteCode,
  };
  for (const [fn, req] of cases) {
    const res = response();
    await handlers[fn](req, res, db);
    assert.equal(res.statusCode, 404, `${fn} must hide the non-public group from non-owners`);
    assert.equal(res.body.error, "Group not found", `${fn} must not disclose the group`);
  }
});

test("G1f: getInviteCode is owner-only and never returns a code to anyone else", async () => {
  // Owner on a group with no code issued yet.
  const noCode = makeDb({ groups: [groupFixture({ type: "private" })], members: [memberFixture()] });
  const noRes = response();
  await getInviteCode({ user: userFixture(), params: { groupId: "grp1" } }, noRes, noCode);
  assert.equal(noRes.statusCode, 200);
  assert.equal(noRes.body.inviteCode, null);

  // Owner with a code issued.
  const withCode = makeDb({ groups: [groupFixture({ type: "invite_only", inviteCode: "secretcode123" })], members: [memberFixture()] });
  const okRes = response();
  await getInviteCode({ user: userFixture(), params: { groupId: "grp1" } }, okRes, withCode);
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.inviteCode, "secretcode123");

  // A non-owner member must NOT see the code (uniform 404).
  const memberDb = makeDb({ groups: [groupFixture({ type: "invite_only", inviteCode: "secretcode123" })], members: [memberFixture(), memberFixture({ userId: "cus2" })] });
  const memberRes = response();
  await getInviteCode({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" } }, memberRes, memberDb);
  assert.equal(memberRes.statusCode, 404);

  // public groups never hold codes: 400.
  const publicDb = makeDb({ groups: [groupFixture({ type: "public" })], members: [memberFixture()] });
  const publicRes = response();
  await getInviteCode({ user: userFixture(), params: { groupId: "grp1" } }, publicRes, publicDb);
  assert.equal(publicRes.statusCode, 400);
  assert.match(publicRes.body.error, /only apply to private and invite_only/);

  // missing and dissolved groups are 404.
  const ghost = makeDb();
  const ghostRes = response();
  await getInviteCode({ user: userFixture(), params: { groupId: "ghost" } }, ghostRes, ghost);
  assert.equal(ghostRes.statusCode, 404);
  const dissolved = makeDb({ groups: [groupFixture({ type: "private", dissolvedAt: t("2026-09-05T00:00:00Z") })] });
  const dissolvedRes = response();
  await getInviteCode({ user: userFixture(), params: { groupId: "grp1" } }, dissolvedRes, dissolved);
  assert.equal(dissolvedRes.statusCode, 404);

  // A blocked owner is still the owner and may view their own code.
  const blockedDb = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })], members: [memberFixture()] });
  const blockedRes = response();
  await getInviteCode({ user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" } }, blockedRes, blockedDb);
  assert.equal(blockedRes.statusCode, 200);
});

test("G1f: generateInviteCode issues, rotates and persists a 12-character code", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "private" })], members: [memberFixture()] });
  const first = response();
  await generateInviteCode({ user: userFixture(), params: { groupId: "grp1" } }, first, db);
  assert.equal(first.statusCode, 200);
  assert.match(first.body.inviteCode, /^[A-Za-z0-9_-]{12}$/, "code is 12 URL-safe characters");
  const stored1 = await db.group.findFirst({ where: { id: "grp1" } });
  assert.equal(stored1.inviteCode, first.body.inviteCode);

  // Rotation changes the code; the old one stops joining.
  const rotated = response();
  await generateInviteCode({ user: userFixture(), params: { groupId: "grp1" } }, rotated, db);
  assert.equal(rotated.statusCode, 200);
  assert.notEqual(rotated.body.inviteCode, first.body.inviteCode);
  const stored2 = await db.group.findFirst({ where: { id: "grp1" } });
  assert.equal(stored2.inviteCode, rotated.body.inviteCode);

  const stale = response();
  await joinGroup({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" }, body: { code: first.body.inviteCode } }, stale, db);
  assert.equal(stale.statusCode, 404, "the rotated-away code must no longer join");
});

test("G1f: disableInviteCode clears the code and blocks code-based joins", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })], members: [memberFixture()] });
  const res = response();
  await disableInviteCode({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.inviteCode, null);
  const stored = await db.group.findFirst({ where: { id: "grp1" } });
  assert.equal(stored.inviteCode, null);

  const again = response();
  await disableInviteCode({ user: userFixture(), params: { groupId: "grp1" } }, again, db);
  assert.equal(again.statusCode, 200, "disabling when already disabled is idempotent");

  const viaCode = response();
  await joinGroupWithCode({ user: userFixture({ id: "cus2", name: "Bob" }), body: { code: "secretcode123" } }, viaCode, db);
  assert.equal(viaCode.statusCode, 404, "a disabled code can no longer join");
});

test("G1f: joinGroupWithCode resolves a private group from the code and joins", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await joinGroupWithCode({ user: userFixture({ id: "cus2", name: "Bob" }), body: { code: "secretcode123" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.groupId, "grp1");
  assert.deepEqual(res.body.group, { id: "grp1", name: "Cleaning Hacks", type: "private" });
  const members = await db.groupMember.findMany({});
  assert.deepEqual(members.map((m) => m.userId).sort(), ["cus1", "cus2"]);
});

test("G1f: joinGroupWithCode trims whitespace around the code", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "invite_only", inviteCode: "secretcode123" })], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await joinGroupWithCode({ user: userFixture({ id: "cus2", name: "Bob" }), body: { code: "  secretcode123  " } }, res, db);
  assert.equal(res.statusCode, 200);
});

test("G1f: joinGroupWithCode is blocked for blocked customers (403, no membership)", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await joinGroupWithCode(
    { user: userFixture({ id: "cus3", name: "Carol", communityBlockedAt: t("2026-09-29T00:00:00Z") }), body: { code: "secretcode123" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 403);
  assert.equal((await db.groupMember.findMany({})).length, 1);
});

test("G1f: joinGroupWithCode returns 404 for unknown, disabled and dissolved codes", async () => {
  groupMembershipLimiter._reset();
  const unknown = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })] });
  const unknownRes = response();
  await joinGroupWithCode({ user: userFixture(), body: { code: "does-not-exist" } }, unknownRes, unknown);
  assert.equal(unknownRes.statusCode, 404);

  const disabled = makeDb({ groups: [groupFixture({ type: "private", inviteCode: null })] });
  const disabledRes = response();
  await joinGroupWithCode({ user: userFixture(), body: { code: "secretcode123" } }, disabledRes, disabled);
  assert.equal(disabledRes.statusCode, 404);

  const dissolved = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123", dissolvedAt: t("2026-09-05T00:00:00Z") })] });
  const dissolvedRes = response();
  await joinGroupWithCode({ user: userFixture(), body: { code: "secretcode123" } }, dissolvedRes, dissolved);
  assert.equal(dissolvedRes.statusCode, 404);
});

test("G1f: joinGroupWithCode rejects malformed bodies with 400", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })] });
  for (const body of [null, [], "code", 42]) {
    const res = response();
    await joinGroupWithCode({ user: userFixture(), body }, res, db);
    assert.equal(res.statusCode, 400, `body=${JSON.stringify(body)} should be rejected`);
  }
  for (const code of [undefined, "", "   "]) {
    const res = response();
    await joinGroupWithCode({ user: userFixture(), body: { code } }, res, db);
    assert.equal(res.statusCode, 400, `code=${JSON.stringify(code)} should be rejected`);
  }
});

test("G1f: repeated private joins with the same code are idempotent (P2002)", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private", inviteCode: "secretcode123" })], members: [memberFixture()] });
  const first = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { code: "secretcode123" } }, first, db);
  assert.equal(first.statusCode, 200);
  const second = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { code: "secretcode123" } }, second, db);
  assert.equal(second.statusCode, 200);
  assert.equal((await db.groupMember.findMany({})).length, 1);
});

test("G1f: the invite code never appears in any customer or admin payload", async () => {
  const CODE = "secretcode123";
  const db = makeDb({
    groups: [groupFixture({ type: "invite_only", inviteCode: CODE })],
    members: [memberFixture()],
    messages: [messageFixture()],
  });
  const payloads = [];
  const capture = (label, res) => payloads.push([label, JSON.stringify(res.body)]);

  const disc = response();
  await listGroups({ user: userFixture(), query: {} }, disc, db);
  capture("discovery", disc);

  const detail = response();
  await getGroup({ user: userFixture(), params: { groupId: "grp1" } }, detail, db);
  capture("detail", detail);

  const roster = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, roster, db);
  capture("members", roster);

  const feed = response();
  await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, feed, db);
  capture("messages", feed);

  const sent = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "hi" } }, sent, db);
  capture("send", sent);

  const updated = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name: "Renamed" } }, updated, db);
  capture("update", updated);

  for (const [label, payload] of payloads) {
    assert.ok(!payload.includes(CODE), `${label} must never expose the invite code`);
  }
});

// -------------------- Detail --------------------

test("detail: valid public group returns safe detail with joined and memberCount", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ groupId: "grp1", userId: "cus1" }), memberFixture({ groupId: "grp1", userId: "cus2" })],
  });
  const res = response();
  await getGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  const g = res.body.group;
  assert.equal(g.id, "grp1");
  assert.equal(g.name, "Cleaning Hacks");
  assert.equal(g.description, "Share cleaning tips");
  assert.equal(g.type, "public");
  assert.equal(g.joined, true);
  assert.equal(g.memberCount, 2);
  assert.deepEqual(g.owner, { id: "cus1", name: "Alice" });
  assert.equal(g.ownerId, undefined);
  assert.equal(g.dissolvedAt, undefined);
});

test("detail: nonexistent group behaves as 404", async () => {
  const db = makeDb();
  const res = response();
  await getGroup({ user: userFixture(), params: { groupId: "ghost" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Group not found");
});

test("detail: dissolved group behaves as 404", async () => {
  const db = makeDb({ groups: [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") })] });
  const res = response();
  await getGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("detail: non-public group behaves as 404", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "private" })] });
  const res = response();
  await getGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Group not found");
});

test("detail: sensitive fields are never leaked in the detail payload", async () => {
  const db = makeDb({
    groups: [
      groupFixture({
        owner: {
          id: "cus1",
          name: "Alice",
          email: "a@x.com",
          phone: "555",
          address: "1 Main",
          passwordHash: "x",
          status: "online",
          lastActiveAt: t("2026-09-01T00:00:00Z"),
        },
      }),
    ],
  });
  const res = response();
  await getGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.group.owner, { id: "cus1", name: "Alice" });
  const payload = JSON.stringify(res.body);
  for (const forbidden of ["email", "phone", "address", "password", "status", "lastActiveAt", "secret", "credential"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `detail payload must not contain ${forbidden}`);
  }
});

// -------------------- Join --------------------

test("join: customer can join a public group and membership is created", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture()] });
  const res = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1);
  assert.equal(members[0].groupId, "grp1");
  assert.equal(members[0].userId, "cus1");
});

test("join: duplicate join is idempotent and never duplicates membership", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture()] });
  const first = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, first, db);
  assert.equal(first.statusCode, 200);
  const second = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, second, db);
  assert.equal(second.statusCode, 200);
  assert.equal((await db.groupMember.findMany({})).length, 1);
});

test("join: an existing membership row is left alone (composite key is the guard)", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture()], // cus1 is already a member
  });
  const res = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1);
  assert.equal(members[0].userId, "cus1");
});

test("join: blocked customer cannot join (403) before any membership work", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture()] });
  const res = response();
  await joinGroup(
    { user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "You are blocked from community groups");
  assert.equal((await db.groupMember.findMany({})).length, 0);
});

test("join: nonexistent group behaves as 404", async () => {
  const db = makeDb();
  const res = response();
  await joinGroup({ user: userFixture(), params: { groupId: "ghost" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("join: dissolved group behaves as 404", async () => {
  const db = makeDb({ groups: [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") })] });
  const res = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("join: non-public group behaves as 404", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "private" })] });
  const res = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("join: a userId in the body cannot make the join happen for someone else", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture()] });
  const res = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "mallory" } }, res, db);
  assert.equal(res.statusCode, 200);
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1);
  assert.equal(members[0].userId, "cus1");
});

// -------------------- Leave --------------------

test("leave: a member can leave and the membership is removed", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus2" })] });
  const res = response();
  await leaveGroup({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal((await db.groupMember.findMany({})).length, 0);
});

test("leave: leaving twice is idempotent", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus2" })] });
  const first = response();
  await leaveGroup({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" } }, first, db);
  assert.equal(first.statusCode, 200);
  const second = response();
  await leaveGroup({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" } }, second, db);
  assert.equal(second.statusCode, 200);
  assert.equal((await db.groupMember.findMany({})).length, 0);
});

test("leave: the owner cannot leave (400) and the group is not deleted", async () => {
  const db = makeDb({
    groups: [groupFixture({ ownerId: "cus1" })],
    members: [memberFixture()], // creator is the only member
  });
  const res = response();
  await leaveGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /[Tt]ransfer ownership or dissolve/);
  assert.equal((await db.group.findMany({})).length, 1, "group must not be deleted");
  assert.equal((await db.groupMember.findMany({})).length, 1, "owner membership must remain");
});

test("leave: a blocked customer can still leave a group they belong to", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus2" })] });
  const res = response();
  await leaveGroup(
    { user: userFixture({ id: "cus2", name: "Bob", communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  assert.equal((await db.groupMember.findMany({})).length, 0);
});

test("leave: nonexistent group behaves as 404", async () => {
  const db = makeDb();
  const res = response();
  await leaveGroup({ user: userFixture(), params: { groupId: "ghost" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("leave: dissolved group behaves as 404", async () => {
  const db = makeDb({ groups: [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") })] });
  const res = response();
  await leaveGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("leave: the owner of a non-public group cannot leave (400)", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "private" })], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await leaveGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /[Tt]ransfer ownership or dissolve/);
});

test("leave: a non-member leaving a private group is idempotent (200)", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private" })], members: [memberFixture({ userId: "cus2" })] });
  const res = response();
  await leaveGroup({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal((await db.groupMember.findMany({})).length, 1);
});

test("leave: a userId in the body cannot make the leave happen for someone else", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus2" })], // only cus2 belongs; cus3 is the caller
  });
  const res = response();
  await leaveGroup(
    { user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" }, body: { userId: "cus2" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1, "cus2's membership must remain");
  assert.equal(members[0].userId, "cus2");
});

test("leave: a customer cannot remove another customer's membership", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus2" })],
  });
  const res = response();
  await leaveGroup({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200, "cus3 is not a member; leave is idempotent");
  assert.equal((await db.groupMember.findMany({})).length, 1);
  assert.equal((await db.groupMember.findMany({}))[0].userId, "cus2");
});

// -------------------- Rate limiting --------------------

test("create rate limit: successful creation consumes the budget (4th in 60min is 429)", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  for (let i = 0; i < 3; i += 1) {
    const res = response();
    await createGroup({ user: userFixture(), body: { name: `Group ${i}`, type: "public" } }, res, db);
    assert.equal(res.statusCode, 201, `creation ${i} should succeed`);
  }
  const fourth = response();
  await createGroup({ user: userFixture(), body: { name: "Fourth", type: "public" } }, fourth, db);
  assert.equal(fourth.statusCode, 429);
  assert.match(fourth.body.error, /Too many requests/);
  assert.equal((await db.group.findMany({})).length, 3);
});

test("create rate limit: failed validation does not consume the budget", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  for (let i = 0; i < 5; i += 1) {
    const res = response();
    await createGroup({ user: userFixture(), body: { name: "", type: "public" } }, res, db);
    assert.equal(res.statusCode, 400, `invalid creation ${i} should fail validation`);
  }
  const valid = response();
  await createGroup({ user: userFixture(), body: { name: "Still Allowed", type: "public" } }, valid, db);
  assert.equal(valid.statusCode, 201);
});

test("create rate limit: blocked customers do not consume the budget", async () => {
  groupCreateLimiter._reset();
  const db = makeDb();
  for (let i = 0; i < 5; i += 1) {
    const res = response();
    await createGroup(
      { user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), body: { name: `G${i}`, type: "public" } },
      res,
      db,
    );
    assert.equal(res.statusCode, 403);
  }
  const unblocked = response();
  await createGroup({ user: userFixture(), body: { name: "Free", type: "public" } }, unblocked, db);
  assert.equal(unblocked.statusCode, 201);
});

test("create rate limit: the limiter key is namespaced per customer", () => {
  groupCreateLimiter._reset();
  const key = (id) => `group:create:${id}`;
  for (let i = 0; i < 3; i += 1) groupCreateLimiter.record(key("cus1"));
  assert.equal(groupCreateLimiter.allow(key("cus1")), false);
  assert.equal(groupCreateLimiter.allow(key("cus2")), true);
  groupCreateLimiter._reset();
  assert.equal(groupCreateLimiter.allow(key("cus1")), true);
});

test("membership rate limit: 30 successful operations then the 31st is 429", async () => {
  groupMembershipLimiter._reset();
  // cus1 must not be the owner for leave to be allowed.
  const db = makeDb({ groups: [groupFixture({ ownerId: "owner" })], members: [memberFixture()] });
  // 15 idempotent joins + 15 idempotent leaves = 30 consumed operations.
  for (let i = 0; i < 15; i += 1) {
    const join = response();
    await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, join, db);
    assert.equal(join.statusCode, 200, `join ${i} should succeed`);
    const leave = response();
    await leaveGroup({ user: userFixture(), params: { groupId: "grp1" } }, leave, db);
    assert.equal(leave.statusCode, 200, `leave ${i} should succeed`);
  }
  const thirtyFirst = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, thirtyFirst, db);
  assert.equal(thirtyFirst.statusCode, 429);
  assert.match(thirtyFirst.body.error, /Too many requests/);
});

test("membership rate limit: failed requests do not consume the budget", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({ groups: [groupFixture()] });
  for (let i = 0; i < 5; i += 1) {
    const join = response();
    await joinGroup({ user: userFixture(), params: { groupId: "ghost" } }, join, db);
    assert.equal(join.statusCode, 404);
    const leave = response();
    await leaveGroup({ user: userFixture(), params: { groupId: "ghost" } }, leave, db);
    assert.equal(leave.statusCode, 404);
  }
  const valid = response();
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" } }, valid, db);
  assert.equal(valid.statusCode, 200);
});

test("membership rate limit: join and leave share the per-customer budget", () => {
  groupMembershipLimiter._reset();
  const key = (id) => `group:membership:${id}`;
  for (let i = 0; i < 30; i += 1) groupMembershipLimiter.record(key("cus1"));
  assert.equal(groupMembershipLimiter.allow(key("cus1")), false);
  assert.equal(groupMembershipLimiter.allow(key("cus2")), true);
  groupMembershipLimiter._reset();
});

// -------------------- Security / identity --------------------

test("identity: groupId always comes from route params, never the body", async () => {
  groupMembershipLimiter._reset();
  const db = makeDb({
    groups: [groupFixture({ id: "grp1" }), groupFixture({ id: "grp2", name: "Other" })],
  });
  const res = response();
  // Body carries a different groupId; the route param must win.
  await joinGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { groupId: "grp2" } }, res, db);
  assert.equal(res.statusCode, 200);
  const members = await db.groupMember.findMany({});
  assert.equal(members.length, 1);
  assert.equal(members[0].groupId, "grp1");
});

test("identity: blocked status is always checked server-side from req.user", async () => {
  const db = makeDb({ groups: [groupFixture()] });
  const res = response();
  await joinGroup(
    {
      user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }),
      params: { groupId: "grp1" },
      body: { userId: "cus1", communityBlockedAt: null },
    },
    res,
    db,
  );
  assert.equal(res.statusCode, 403);
});

test("routes: the seventeen G1b + G1c + G1f group routes are registered and Community V1 routes survive", () => {
  const src = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  for (const path of [
    'router.get("/community/groups", authenticate, requireCustomer, groups.listGroups)',
    'router.post("/community/groups", authenticate, requireCustomer, groups.createGroup)',
    'router.get("/community/groups/:groupId", authenticate, requireCustomer, groups.getGroup)',
    'router.post("/community/groups/:groupId/join", authenticate, requireCustomer, groups.joinGroup)',
    'router.post("/community/groups/:groupId/leave", authenticate, requireCustomer, groups.leaveGroup)',
    'router.get("/community/groups/:groupId/members", authenticate, requireCustomer, groups.listGroupMembers)',
    'router.get("/community/groups/:groupId/messages", authenticate, requireCustomer, groups.listGroupMessages)',
    'router.post("/community/groups/:groupId/messages", authenticate, requireCustomer, groups.sendGroupMessage)',
    'router.delete("/community/groups/:groupId/messages/:messageId", authenticate, requireCustomer, groups.deleteGroupMessage)',
    'router.patch("/community/groups/:groupId", authenticate, requireCustomer, groups.updateGroup)',
    'router.delete("/community/groups/:groupId/members/:userId", authenticate, requireCustomer, groups.removeGroupMember)',
    'router.post("/community/groups/:groupId/transfer", authenticate, requireCustomer, groups.transferGroupOwner)',
    'router.post("/community/groups/:groupId/dissolve", authenticate, requireCustomer, groups.dissolveGroup)',
    'router.post("/community/groups/join-with-code", authenticate, requireCustomer, groups.joinGroupWithCode)',
    'router.get("/community/groups/:groupId/invite-code", authenticate, requireCustomer, groups.getInviteCode)',
    'router.post("/community/groups/:groupId/invite-code", authenticate, requireCustomer, groups.generateInviteCode)',
    'router.delete("/community/groups/:groupId/invite-code", authenticate, requireCustomer, groups.disableInviteCode)',
  ]) {
    assert.ok(src.includes(path), `route ${path} must be registered`);
  }
  assert.ok(src.includes('router.get("/community/messages"'), "community V1 routes must remain");
  assert.ok(src.includes('router.post("/community/messages"'), "community V1 routes must remain");
  assert.ok(src.includes('router.get("/admin/community/users"'), "community V1 admin routes must remain");
});

test("isolation: existing controllers were not touched", () => {
  for (const file of ["community.js", "profiles.js", "messages.js"]) {
    const src = readFileSync(new URL(`../src/controllers/${file}`, import.meta.url), "utf8");
    assert.ok(!/\bGroups?\b/.test(src), `${file} must not reference groups`);
  }
});

// -------------------- G1c auth / role guard --------------------

test("groups: an admin cannot use the G1c group endpoints (403)", async () => {
  const db = makeDb();
  const admin = { id: "adm1", role: "admin" };
  const cases = [
    ["listGroupMembers", { user: admin, params: { groupId: "grp1" } }],
    ["listGroupMessages", { user: admin, params: { groupId: "grp1" } }],
    ["sendGroupMessage", { user: admin, params: { groupId: "grp1" }, body: { content: "x" } }],
    ["deleteGroupMessage", { user: admin, params: { groupId: "grp1", messageId: "msg1" } }],
    ["updateGroup", { user: admin, params: { groupId: "grp1" }, body: { name: "X" } }],
    ["removeGroupMember", { user: admin, params: { groupId: "grp1", userId: "cus2" } }],
    ["transferGroupOwner", { user: admin, params: { groupId: "grp1" }, body: { userId: "cus2" } }],
    ["dissolveGroup", { user: admin, params: { groupId: "grp1" } }],
    ["getInviteCode", { user: admin, params: { groupId: "grp1" } }],
    ["generateInviteCode", { user: admin, params: { groupId: "grp1" } }],
    ["disableInviteCode", { user: admin, params: { groupId: "grp1" } }],
    ["joinGroupWithCode", { user: admin, body: { code: "abc" } }],
  ];
  const handlers = {
    listGroupMembers,
    listGroupMessages,
    sendGroupMessage,
    deleteGroupMessage,
    updateGroup,
    removeGroupMember,
    transferGroupOwner,
    dissolveGroup,
    getInviteCode,
    generateInviteCode,
    disableInviteCode,
    joinGroupWithCode,
  };
  for (const [fn, req] of cases) {
    const res = response();
    await handlers[fn](req, res, db);
    assert.equal(res.statusCode, 403, `${fn} should reject admins`);
  }
});

test("groups: anonymous G1c requests are blocked with 401 by requireCustomer", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("groups: anonymous G1f (invite-code) requests are blocked with 401 by requireCustomer", async () => {
  for (let i = 0; i < 4; i += 1) {
    const res = response();
    await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
    assert.equal(res.statusCode, 401);
  }
});

// -------------------- Members list --------------------

const memberGroup = ({ users = [], members = [], messages = [], groups = [groupFixture()] } = {}) =>
  makeDb({ groups, members, messages, users });

test("members: the roster is newest-first with public identities", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [
      memberFixture({ userId: "cus1", joinedAt: t("2026-09-02T00:00:00Z") }),
      memberFixture({ userId: "cus2", joinedAt: t("2026-09-03T00:00:00Z") }),
    ],
    users: [
      userRow({ id: "cus1", name: "Alice", communityProfile: profileEmbed({ id: "pro1", userId: "cus1", avatarUrl: "https://cdn.example.com/alice.png" }) }),
      userRow({ id: "cus2", name: "Bob", communityProfile: profileEmbed({ id: "pro2", userId: "cus2", displayName: "Big Bob", avatarUrl: null }) }),
    ],
  });
  const res = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.members.map((m) => m.userId), ["cus2", "cus1"]);
  const bob = res.body.members[0];
  assert.equal(bob.user.id, "cus2");
  assert.equal(bob.user.name, "Big Bob");
  assert.equal(bob.user.avatarUrl, null);
  assert.ok(bob.joinedAt instanceof Date);
});

test("members: `online` is omitted when the member opts out (showOnline false)", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [
      userRow({ id: "cus1", communityProfile: profileEmbed({ id: "pro1", userId: "cus1" }) }),
      userRow({ id: "cus2", name: "Bob", communityProfile: profileEmbed({ id: "pro2", userId: "cus2", showOnline: false }) }),
    ],
  });
  const res = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  const alice = res.body.members.find((m) => m.userId === "cus1");
  const bob = res.body.members.find((m) => m.userId === "cus2");
  assert.ok("online" in alice.user, "opted-in member should carry online");
  assert.ok(!("online" in bob.user), "opted-out member must omit online entirely");
});

test("members: `online` reflects the auth heartbeat window", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [
      userRow({ id: "cus1", lastActiveAt: nowMinus(60_000), communityProfile: profileEmbed({ id: "pro1", userId: "cus1", showOnline: true }) }),
      userRow({ id: "cus2", name: "Bob", lastActiveAt: nowMinus(10 * 60_000 + 1), communityProfile: profileEmbed({ id: "pro2", userId: "cus2", showOnline: true }) }),
    ],
  });
  const res = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.body.members.find((m) => m.userId === "cus1").user.online, true);
  assert.equal(res.body.members.find((m) => m.userId === "cus2").user.online, false);
});

test("members: identity falls back to the username when no CommunityProfile exists", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus1", name: "Alice" }), userRow({ id: "cus2", name: "Bob" })],
  });
  const res = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  const bob = res.body.members.find((m) => m.userId === "cus2");
  assert.deepEqual(bob.user, { id: "cus2", name: "Bob", avatarUrl: null });
});

test("members: a hidden profile does not hide the member from the roster", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob", communityProfile: profileEmbed({ id: "pro2", userId: "cus2", displayName: "Bob", profileVisible: false }) })],
  });
  const res = response();
  await listGroupMembers({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.members[0].user.name, "Bob");
});

test("members: a non-member gets a uniform 404", async () => {
  // cus3 is an authenticated customer but not a member of the existing group.
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await listGroupMembers({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Group not found");
});

test("members: a blocked member can still read the roster", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() }), userRow({ id: "cus2", name: "Bob", communityProfile: profileEmbed({ id: "pro2", userId: "cus2" }) })],
  });
  const res = response();
  await listGroupMembers({ user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
});

test("members: nonexistent group is 404", async () => {
  const db = makeDb();
  const res = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "ghost" }, query: {} }, res, db);
  assert.equal(res.statusCode, 404);
});

test("members: dissolved and non-public groups are 404", async () => {
  for (const group of [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") }), groupFixture({ type: "private" })]) {
    const db = makeDb({ groups: [group] });
    const res = response();
    await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
    assert.equal(res.statusCode, 404, "dissolved/private groups must behave as 404");
  }
});

test("members: cursor pagination is stable and never duplicates", async () => {
  const joined = t("2026-09-02T00:00:00Z");
  const uids = ["cus1", "cus2", "cus3", "cus4", "cus5"];
  const db = makeDb({
    groups: [groupFixture()],
    members: uids.map((u) => memberFixture({ userId: u, joinedAt: joined })),
    users: uids.map((u) => userRow({ id: u, name: `User ${u}`, communityProfile: profileEmbed({ id: `pro-${u}`, userId: u, displayName: `User ${u}` }) })),
  });
  const page1 = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: { limit: "2" } }, page1, db);
  assert.deepEqual(page1.body.members.map((m) => m.userId), ["cus5", "cus4"]);
  assert.equal(page1.body.hasMore, true);

  const page2 = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: { limit: "2", before: page1.body.nextCursor } }, page2, db);
  assert.deepEqual(page2.body.members.map((m) => m.userId), ["cus3", "cus2"]);
  assert.equal(page2.body.hasMore, true);

  const page3 = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: { limit: "2", before: page2.body.nextCursor } }, page3, db);
  assert.deepEqual(page3.body.members.map((m) => m.userId), ["cus1"]);
  assert.equal(page3.body.hasMore, false);
  assert.equal(page3.body.nextCursor, null);
});

test("members: invalid limit and cursor are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const limit of ["0", "abc", "101"]) {
    const res = response();
    await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: { limit } }, res, db);
    assert.equal(res.statusCode, 400, `limit=${limit} should be rejected`);
  }
  const badCursor = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: { limit: 5, before: "not-a-cursor" } }, badCursor, db);
  assert.equal(badCursor.statusCode, 400);
});

test("members: sensitive user fields are never leaked", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [
      userRow({
        id: "cus1",
        email: "alice@x.com",
        phone: "555-1234",
        address: "1 Main St",
        status: "online",
        passwordHash: "hashed-credential",
        role: ROLES.CUSTOMER,
        communityBlockedAt: t("2026-09-01T00:00:00Z"),
        lastActiveAt: t("2026-09-30T00:00:00Z"),
        communityProfile: profileEmbed(),
      }),
    ],
  });
  const res = response();
  await listGroupMembers({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  const payload = JSON.stringify(res.body);
  for (const forbidden of ["email", "phone", "address", "password", "status", "lastActiveAt", "secret", "credential", "communityBlockedAt"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `roster payload must not contain ${forbidden}`);
  }
});

// -------------------- Messages list --------------------

test("messages: the feed is newest-first with public sender identities", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [
      messageFixture({ id: "msg1", createdAt: t("2026-09-02T00:00:00Z") }),
      messageFixture({ id: "msg2", createdAt: t("2026-09-02T00:00:01Z") }),
    ],
  });
  const res = response();
  await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages.map((m) => m.id), ["msg2", "msg1"]);
  const first = res.body.messages[0];
  assert.equal(first.content, "Hello group!");
  assert.equal(first.deleted, false);
  assert.equal(first.sender.id, "cus1");
  assert.equal(first.sender.name, "Alice");
  assert.equal(first.sender.avatarUrl, "https://cdn.example.com/alice.png");
  assert.ok("online" in first.sender, "sender presence reflects showOnline");
});

test("messages: deleted messages hide content and stay in the feed", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [messageFixture({ id: "msg1", deletedAt: t("2026-09-03T00:00:00Z") })],
  });
  const res = response();
  await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  const msg = res.body.messages[0];
  assert.equal(msg.deleted, true);
  assert.equal(msg.content, null);
  assert.equal(msg.id, "msg1");
});

test("messages: a blocked member can still read the feed", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [messageFixture()],
  });
  const res = response();
  await listGroupMessages({ user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.messages.length, 1);
});

test("messages: a non-member gets a uniform 404", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await listGroupMessages({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Group not found");
});

test("messages: nonexistent and dissolved groups are 404", async () => {
  for (const [group, gid] of [[null, "ghost"], [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") }), "grp1"]]) {
    const db = makeDb(group ? { groups: [group], members: [memberFixture({ userId: "cus1" })] } : {});
    const res = response();
    await listGroupMessages({ user: userFixture(), params: { groupId: gid }, query: {} }, res, db);
    assert.equal(res.statusCode, 404);
  }
});

test("messages: a member of a non-public group reads the feed (200)", async () => {
  for (const type of ["private", "invite_only"]) {
    const db = makeDb({ groups: [groupFixture({ type })], members: [memberFixture({ userId: "cus1" })] });
    const res = response();
    await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
    assert.equal(res.statusCode, 200, `${type} members must be able to read the feed`);
  }
});

test("messages: cursor pagination is stable with id tie-break", async () => {
  const same = t("2026-09-02T00:00:00Z");
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [
      messageFixture({ id: "m9", createdAt: same }),
      messageFixture({ id: "m1", createdAt: same }),
      messageFixture({ id: "m5", createdAt: same }),
    ],
  });
  const page1 = response();
  await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: { limit: "2" } }, page1, db);
  assert.deepEqual(page1.body.messages.map((m) => m.id), ["m9", "m5"]);
  assert.equal(page1.body.hasMore, true);

  const page2 = response();
  await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: { limit: "2", before: page1.body.nextCursor } }, page2, db);
  assert.deepEqual(page2.body.messages.map((m) => m.id), ["m1"]);
  assert.equal(page2.body.hasMore, false);
  assert.equal(page2.body.nextCursor, null);
});

test("messages: invalid limit and cursor are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const limit of ["0", "1.5", "101"]) {
    const res = response();
    await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: { limit } }, res, db);
    assert.equal(res.statusCode, 400, `limit=${limit} should be rejected`);
  }
  const badCursor = response();
  await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: { limit: 5, before: "garbage" } }, badCursor, db);
  assert.equal(badCursor.statusCode, 400);
});

test("messages: sensitive fields are never leaked from messages or senders", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [
      userRow({
        id: "cus1",
        email: "a@x.com",
        phone: "555",
        address: "1 Main",
        passwordHash: "x",
        status: "online",
        lastActiveAt: t("2026-09-30T00:00:00Z"),
        communityBlockedAt: t("2026-09-01T00:00:00Z"),
        communityProfile: profileEmbed(),
      }),
    ],
    messages: [messageFixture({ deletedById: "adm1" })],
  });
  const res = response();
  await listGroupMessages({ user: userFixture(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  const payload = JSON.stringify(res.body);
  for (const forbidden of ["email", "phone", "address", "password", "status", "lastActiveAt", "secret", "credential", "deletedById", "communityBlockedAt"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `feed payload must not contain ${forbidden}`);
  }
});

// -------------------- Send message --------------------

test("send: a member can post and the trimmed content is stored", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", name: "Alice", communityProfile: profileEmbed() })],
  });
  const res = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "  hey there  " } }, res, db);
  assert.equal(res.statusCode, 201);
  const msg = res.body.message;
  assert.equal(msg.content, "hey there");
  assert.equal(msg.deleted, false);
  assert.equal(msg.sender.id, "cus1");
  assert.equal(msg.sender.name, "Alice");
  assert.ok(typeof msg.id === "string" && msg.id.length > 0);
  const stored = await db.groupMessage.findMany({});
  assert.equal(stored.length, 1);
  assert.equal(stored[0].senderId, "cus1");
  assert.equal(stored[0].content, "hey there");
});

test("send: the sender identity is the authenticated user, never the body", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", name: "Alice", communityProfile: profileEmbed() })],
  });
  const res = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "hi", senderId: "mallory" } }, res, db);
  assert.equal(res.statusCode, 201);
  const stored = await db.groupMessage.findMany({});
  assert.equal(stored[0].senderId, "cus1");
});

test("send: a groupId in the body is ignored (params win)", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({
    groups: [groupFixture({ id: "grp1" }), groupFixture({ id: "grp2", name: "Other", ownerId: "cus2" })],
    members: [memberFixture({ groupId: "grp1", userId: "cus1" }), memberFixture({ groupId: "grp2", userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
  });
  const res = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "hi", groupId: "grp2" } }, res, db);
  assert.equal(res.statusCode, 201);
  const stored = await db.groupMessage.findMany({});
  assert.equal(stored.length, 1);
  assert.equal(stored[0].groupId, "grp1");
});

test("send: exact max-length content succeeds; longer is rejected with 400", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const ok = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "x".repeat(GROUP_MESSAGE_MAX) } }, ok, db);
  assert.equal(ok.statusCode, 201);
  const tooLong = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "y".repeat(GROUP_MESSAGE_MAX + 1) } }, tooLong, db);
  assert.equal(tooLong.statusCode, 400);
  assert.equal(tooLong.body.error, `content must be ${GROUP_MESSAGE_MAX} characters or fewer`);
});

test("send: missing and blank content are rejected with 400", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const content of [undefined, "", "   \t "]) {
    const res = response();
    await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content } }, res, db);
    assert.equal(res.statusCode, 400, `content=${JSON.stringify(content)} should be rejected`);
    assert.equal(res.body.error, "content is required");
  }
});

test("send: non-object bodies are rejected with 400", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const body of [null, [], "string", 42]) {
    const res = response();
    await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body }, res, db);
    assert.equal(res.statusCode, 400);
  }
});

test("send: a non-member stores nothing and gets a uniform 404", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await sendGroupMessage({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1" }, body: { content: "hi" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Group not found");
  assert.equal((await db.groupMessage.findMany({})).length, 0);
});

test("send: a blocked member gets 403 and nothing is stored", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await sendGroupMessage(
    { user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" }, body: { content: "spam" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "You are blocked from community groups");
  assert.equal((await db.groupMessage.findMany({})).length, 0);
});

test("send: a blocked NON-member gets 404 (blocked check runs after membership)", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  // cus3 is blocked AND not a member — the membership failure must win (404).
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus3", name: "Carol", communityBlockedAt: t("2026-09-29T00:00:00Z") })],
  });
  const res = response();
  await sendGroupMessage(
    { user: userFixture({ id: "cus3", name: "Carol", communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" }, body: { content: "hi" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Group not found");
});

test("send: nonexistent and dissolved groups are 404", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  for (const [group, gid] of [[null, "ghost"], [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") }), "grp1"]]) {
    const db = makeDb(group ? { groups: [group], members: [memberFixture({ userId: "cus1" })] } : {});
    const res = response();
    await sendGroupMessage(
      { user: userFixture(), params: { groupId: gid }, body: { content: "hi" } },
      res,
      db,
    );
    assert.equal(res.statusCode, 404);
  }
});

test("send: a member of a private group can send (201)", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({ groups: [groupFixture({ type: "private" })], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "hi" } }, res, db);
  assert.equal(res.statusCode, 201);
});

test("send rate limit: 10 messages to one group then the 11th is 429, other groups stay open", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({
    groups: [groupFixture({ id: "grp1" }), groupFixture({ id: "grp2", name: "Other", ownerId: "cus2" })],
    members: [memberFixture({ groupId: "grp1", userId: "cus1" }), memberFixture({ groupId: "grp2", userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
  });
  for (let i = 0; i < 10; i += 1) {
    const res = response();
    await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: `m${i}` } }, res, db);
    assert.equal(res.statusCode, 201, `send ${i} to grp1 should succeed`);
  }
  const eleventh = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "one too many" } }, eleventh, db);
  assert.equal(eleventh.statusCode, 429);
  assert.match(eleventh.body.error, /Too many requests/);
  const otherGroup = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp2" }, body: { content: "elsewhere" } }, otherGroup, db);
  assert.equal(otherGroup.statusCode, 201);
});

test("send rate limit: 30 messages across groups then the 31st is 429", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  // 4 groups keep each per-group budget (10) fresh while the per-customer
  // budget (30) is what gets exhausted.
  const groups = ["grp1", "grp2", "grp3", "grp4"].map((id, i) => groupFixture({ id, name: `G${i}`, ownerId: "cus2" }));
  const db = makeDb({
    groups,
    members: groups.map((g) => memberFixture({ groupId: g.id, userId: "cus1" })),
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
  });
  for (let i = 0; i < 30; i += 1) {
    const res = response();
    await sendGroupMessage({ user: userFixture(), params: { groupId: groups[i % 4].id }, body: { content: `m${i}` } }, res, db);
    assert.equal(res.statusCode, 201, `send ${i} should succeed`);
  }
  const thirtyFirst = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "over budget" } }, thirtyFirst, db);
  assert.equal(thirtyFirst.statusCode, 429);
});

test("send rate limit: 404 and validation failures do not consume the budget", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })], users: [userRow({ id: "cus1" })] });
  for (let i = 0; i < 5; i += 1) {
    const ghost = response();
    await sendGroupMessage({ user: userFixture(), params: { groupId: "ghost" }, body: { content: "x" } }, ghost, db);
    assert.equal(ghost.statusCode, 404);
    const blank = response();
    await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "   " } }, blank, db);
    assert.equal(blank.statusCode, 400);
  }
  const valid = response();
  await sendGroupMessage({ user: userFixture(), params: { groupId: "grp1" }, body: { content: "finally" } }, valid, db);
  assert.equal(valid.statusCode, 201);
});

test("send rate limit: blocked 403s never consume the send budget", async () => {
  groupMessagePerGroupLimiter._reset();
  groupMessagePerCustomerLimiter._reset();
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })], users: [userRow({ id: "cus1" })] });
  for (let i = 0; i < 5; i += 1) {
    const res = response();
    await sendGroupMessage(
      { user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" }, body: { content: "x" } },
      res,
      db,
    );
    assert.equal(res.statusCode, 403);
  }
  assert.equal(groupMessagePerCustomerLimiter.allow("group:message:send:cus1"), true, "blocked attempts must not consume the budget");
});

// -------------------- Delete message --------------------

test("delete: the sender can soft-delete their own message", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [messageFixture({ senderId: "cus1" })],
  });
  const res = response();
  await deleteGroupMessage({ user: userFixture(), params: { groupId: "grp1", messageId: "msg1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.message.deleted, true);
  assert.equal(res.body.message.content, null);
  assert.equal(res.body.message.id, "msg1");
  const stored = await db.groupMessage.findMany({});
  assert.ok(stored[0].deletedAt instanceof Date, "deletedAt must be set on the stored row");
  assert.equal(stored[0].deletedById, null, "customer self-delete never sets deletedById");
});

test("delete: deleting twice is idempotent", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [messageFixture({ senderId: "cus1" })],
  });
  const first = response();
  await deleteGroupMessage({ user: userFixture(), params: { groupId: "grp1", messageId: "msg1" } }, first, db);
  assert.equal(first.statusCode, 200);
  const second = response();
  await deleteGroupMessage({ user: userFixture(), params: { groupId: "grp1", messageId: "msg1" } }, second, db);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.message.deleted, true);
});

test("delete: a non-sender member cannot delete (403) and nothing changes", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() }), userRow({ id: "cus2", name: "Bob", communityProfile: profileEmbed({ id: "pro2", userId: "cus2" }) })],
    messages: [messageFixture({ senderId: "cus1" })],
  });
  const res = response();
  await deleteGroupMessage({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1", messageId: "msg1" } }, res, db);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /sender can delete/);
  const stored = await db.groupMessage.findMany({});
  assert.equal(stored[0].deletedAt, null);
});

test("delete: a non-member gets a uniform 404", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    messages: [messageFixture({ senderId: "cus1" })],
  });
  const res = response();
  await deleteGroupMessage({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1", messageId: "msg1" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Group not found");
});

test("delete: a message that does not exist is 404", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await deleteGroupMessage({ user: userFixture(), params: { groupId: "grp1", messageId: "ghost" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Message not found");
});

test("delete: a message from another group cannot be deleted (404, IDOR safe)", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "grp1" }), groupFixture({ id: "grp2", name: "Other", ownerId: "cus2" })],
    members: [memberFixture({ groupId: "grp1", userId: "cus1" }), memberFixture({ groupId: "grp2", userId: "cus2" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [messageFixture({ id: "msg1", groupId: "grp2", senderId: "cus2" })],
  });
  const res = response();
  await deleteGroupMessage({ user: userFixture(), params: { groupId: "grp1", messageId: "msg1" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Message not found");
});

test("delete: nonexistent and dissolved groups are 404", async () => {
  for (const [group, gid] of [[null, "ghost"], [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") }), "grp1"]]) {
    const db = makeDb(group ? { groups: [group], members: [memberFixture({ userId: "cus1" })] } : {});
    const res = response();
    await deleteGroupMessage(
      { user: userFixture(), params: { groupId: gid, messageId: "msg1" } },
      res,
      db,
    );
    assert.equal(res.statusCode, 404);
  }
});

test("delete: a member of a non-public group can delete their own message", async () => {
  for (const type of ["private", "invite_only"]) {
    const db = makeDb({
      groups: [groupFixture({ type })],
      members: [memberFixture({ userId: "cus1" })],
      messages: [messageFixture({ senderId: "cus1" })],
    });
    const res = response();
    await deleteGroupMessage({ user: userFixture(), params: { groupId: "grp1", messageId: "msg1" } }, res, db);
    assert.equal(res.statusCode, 200, `${type} members must be able to delete their own message`);
  }
});

test("delete: a non-member cannot reach messages in a non-public group", async () => {
  const db = makeDb({
    groups: [groupFixture({ type: "private" })],
    members: [memberFixture({ userId: "cus2" })],
    messages: [messageFixture({ senderId: "cus2" })],
  });
  const res = response();
  await deleteGroupMessage(
    { user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1", messageId: "msg1" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Group not found");
});

test("delete: a blocked sender can still delete their own message", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [messageFixture({ senderId: "cus1" })],
  });
  const res = response();
  await deleteGroupMessage(
    { user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1", messageId: "msg1" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.deleted, true);
});

test("delete: a messageId in the body is ignored (params win)", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus1", communityProfile: profileEmbed() })],
    messages: [messageFixture({ id: "msg1" }), messageFixture({ id: "msg2" })],
  });
  const res = response();
  await deleteGroupMessage({ user: userFixture(), params: { groupId: "grp1", messageId: "msg1" }, body: { messageId: "msg2" } }, res, db);
  assert.equal(res.statusCode, 200);
  const stored = await db.groupMessage.findMany({ where: { id: "msg1" } });
  assert.ok(stored[0].deletedAt instanceof Date, "msg1 must be deleted, not msg2");
});

// -------------------- Update group --------------------

test("update: owner can rename and re-describe the group", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name: "  New Name  ", description: "  New desc  " } }, res, db);
  assert.equal(res.statusCode, 200);
  const g = res.body.group;
  assert.equal(g.name, "New Name");
  assert.equal(g.description, "New desc");
  assert.equal(g.id, "grp1");
  assert.equal(g.memberCount, 1);
  assert.equal(g.joined, true);
  assert.deepEqual(g.owner, { id: "cus1", name: "Alice" });
  const stored = await db.group.findMany({});
  assert.equal(stored[0].name, "New Name");
  assert.equal(stored[0].description, "New desc");
});

test("update: owner can clear the description with null or an empty string", async () => {
  for (const description of [null, "", "   "]) {
    const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
    const res = response();
    await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { description } }, res, db);
    assert.equal(res.statusCode, 200, `description=${JSON.stringify(description)} should be accepted`);
    assert.equal(res.body.group.description, null);
  }
});

test("update: missing and blank names are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const name of [undefined, "", "   "]) {
    const res = response();
    await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name } }, res, db);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "name is required");
  }
});

test("update: names over the limit are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name: "x".repeat(GROUP_NAME_MAX + 1) } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, `name must be ${GROUP_NAME_MAX} characters or fewer`);
  const ok = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name: "x".repeat(GROUP_NAME_MAX) } }, ok, db);
  assert.equal(ok.statusCode, 200);
});

test("update: non-string descriptions are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { description: 123 } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "description must be a string");
});

test("update: descriptions over the limit are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { description: "x".repeat(GROUP_DESC_MAX + 1) } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, `description must be ${GROUP_DESC_MAX} characters or fewer`);
});

test("update: an empty body is rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: {} }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /name or description is required/);
});

test("update: immutable fields are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const field of ["id", "ownerId", "type", "dissolvedAt", "createdAt", "updatedAt"]) {
    const res = response();
    await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { [field]: "anything" } }, res, db);
    assert.equal(res.statusCode, 400, `field ${field} must be rejected`);
    assert.match(res.body.error, /cannot be changed/);
  }
});

test("update: a non-owner member and a non-member are both 403", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus2" })] });
  for (const userId of ["cus2", "cus3"]) {
    const res = response();
    await updateGroup({ user: userFixture({ id: userId, name: "Bob" }), params: { groupId: "grp1" }, body: { name: "Hijack" } }, res, db);
    assert.equal(res.statusCode, 403, `${userId} must not update the group`);
    assert.match(res.body.error, /owner can update/);
  }
});

test("update: nonexistent and dissolved groups are 404", async () => {
  for (const [group, gid] of [[null, "ghost"], [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") }), "grp1"]]) {
    const db = makeDb(group ? { groups: [group] } : {});
    const res = response();
    await updateGroup({ user: userFixture(), params: { groupId: gid }, body: { name: "X" } }, res, db);
    assert.equal(res.statusCode, 404);
  }
});

test("update: the owner can update their own non-public group", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "invite_only" })] });
  const res = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name: "Still Mine" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group.name, "Still Mine");
});

test("update: a blocked owner can still update the group", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await updateGroup({ user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" }, body: { name: "Still Mine" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group.name, "Still Mine");
});

test("update: a groupId in the body is ignored (params win)", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "grp1" }), groupFixture({ id: "grp2", name: "Other", ownerId: "cus2" })],
    members: [memberFixture({ groupId: "grp1", userId: "cus1" })],
  });
  const res = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name: "Renamed", groupId: "grp2" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group.id, "grp1");
});

test("update: non-object bodies are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const body of [null, [], "string", 42]) {
    const res = response();
    await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body }, res, db);
    assert.equal(res.statusCode, 400);
  }
});

// -------------------- Remove member --------------------

test("removeMember: the owner can remove another member", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2", joinedAt: t("2026-09-03T00:00:00Z") })],
  });
  const res = response();
  await removeGroupMember({ user: userFixture(), params: { groupId: "grp1", userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.memberId, "cus2");
  const rows = await db.groupMember.findMany({});
  assert.deepEqual(rows.map((r) => r.userId), ["cus1"]);
});

test("removeMember: removing a non-member is idempotent", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await removeGroupMember({ user: userFixture(), params: { groupId: "grp1", userId: "ghost" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.removed, true);
  assert.equal((await db.groupMember.findMany({})).length, 1);
});

test("removeMember: the owner cannot remove themselves (400)", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await removeGroupMember({ user: userFixture(), params: { groupId: "grp1", userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /[Tt]ransfer ownership or dissolve/);
  assert.equal((await db.groupMember.findMany({})).length, 1);
});

test("removeMember: a non-owner member cannot remove (403)", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
  });
  const res = response();
  await removeGroupMember({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1", userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /owner can remove/);
});

test("removeMember: a non-member cannot remove (403)", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await removeGroupMember({ user: userFixture({ id: "cus3", name: "Carol" }), params: { groupId: "grp1", userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 403);
});

test("removeMember: nonexistent and dissolved groups are 404", async () => {
  for (const [group, gid] of [[null, "ghost"], [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") }), "grp1"]]) {
    const db = makeDb(group ? { groups: [group] } : {});
    const res = response();
    await removeGroupMember({ user: userFixture(), params: { groupId: gid, userId: "cus2" } }, res, db);
    assert.equal(res.statusCode, 404);
  }
});

test("removeMember: the owner can remove members from their own non-public group", async () => {
  const db = makeDb({
    groups: [groupFixture({ type: "private" })],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
  });
  const res = response();
  await removeGroupMember({ user: userFixture(), params: { groupId: "grp1", userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.removed, true);
});

test("removeMember: a userId in the body is ignored (params win)", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" }), memberFixture({ userId: "cus3" })],
  });
  const res = response();
  await removeGroupMember({ user: userFixture(), params: { groupId: "grp1", userId: "cus2" }, body: { userId: "cus3" } }, res, db);
  assert.equal(res.statusCode, 200);
  const rows = await db.groupMember.findMany({});
  assert.deepEqual(rows.map((r) => r.userId).sort(), ["cus1", "cus3"]);
});

test("removeMember: a blocked owner can still remove", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
  });
  const res = response();
  await removeGroupMember(
    { user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1", userId: "cus2" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  assert.equal((await db.groupMember.findMany({})).length, 1);
});

test("removeMember: a removed member becomes a uniform 404 everywhere", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob" })],
  });
  const remove = response();
  await removeGroupMember({ user: userFixture(), params: { groupId: "grp1", userId: "cus2" } }, remove, db);
  assert.equal(remove.statusCode, 200);
  const list = response();
  await listGroupMessages({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" }, query: {} }, list, db);
  assert.equal(list.statusCode, 404);
  assert.equal(list.body.error, "Group not found");
});

// -------------------- Transfer ownership --------------------

test("transfer: the owner transfers to an active member; the old owner stays a member", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob", communityProfile: profileEmbed({ id: "pro2", userId: "cus2", displayName: "Bob" }) })],
  });
  const res = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.group.owner, { id: "cus2", name: "Bob" });
  assert.equal(res.body.group.joined, true);
  assert.equal(res.body.group.memberCount, 2, "both members remain after transfer");
  const stored = await db.group.findMany({});
  assert.equal(stored[0].ownerId, "cus2");
  const members = await db.groupMember.findMany({});
  assert.deepEqual(members.map((m) => m.userId).sort(), ["cus1", "cus2"]);
});

test("transfer: the target must be a member of the group (400)", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus3", name: "Carol" })],
  });
  const res = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "cus3" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "The new owner must be a member of the group");
});

test("transfer: the target must be a customer (400 for admins)", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "adm1", name: "Admin", role: ROLES.ADMIN })],
  });
  const res = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "adm1" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /transferred to a customer/);
});

test("transfer: the target must not be blocked (400)", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob", communityBlockedAt: t("2026-09-29T00:00:00Z") })],
  });
  const res = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /[Bb]locked from community/);
});

test("transfer: an unknown target is 404", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "ghost" } }, res, db);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "User not found");
});

test("transfer: a non-owner cannot transfer (403)", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob" })],
  });
  const res = response();
  await transferGroupOwner({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" }, body: { userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 403);
});

test("transfer: nonexistent and dissolved groups are 404", async () => {
  for (const [group, gid] of [[null, "ghost"], [groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") }), "grp1"]]) {
    const db = makeDb(group ? { groups: [group] } : {});
    const res = response();
    await transferGroupOwner({ user: userFixture(), params: { groupId: gid }, body: { userId: "cus2" } }, res, db);
    assert.equal(res.statusCode, 404);
  }
});

test("transfer: the owner can transfer their own non-public group", async () => {
  const db = makeDb({
    groups: [groupFixture({ type: "private" })],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob" })],
  });
  const res = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 200);
  const stored = await db.group.findMany({});
  assert.equal(stored[0].ownerId, "cus2");
});

test("transfer: missing, blank and non-string userId are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const userId of [undefined, "", "   ", 42, null]) {
    const res = response();
    await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId } }, res, db);
    assert.equal(res.statusCode, 400, `userId=${JSON.stringify(userId)} should be rejected`);
    assert.equal(res.body.error, "userId is required");
  }
});

test("transfer: non-object bodies are rejected with 400", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  for (const body of [null, [], "string", 42]) {
    const res = response();
    await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body }, res, db);
    assert.equal(res.statusCode, 400);
  }
});

test("transfer: a blocked owner can still transfer", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob" })],
  });
  const res = response();
  await transferGroupOwner(
    { user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" }, body: { userId: "cus2" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  const stored = await db.group.findMany({});
  assert.equal(stored[0].ownerId, "cus2");
});

test("transfer: a groupId in the body is ignored (params win)", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "grp1" }), groupFixture({ id: "grp2", name: "Other", ownerId: "cus1" })],
    members: [memberFixture({ groupId: "grp1", userId: "cus1" }), memberFixture({ groupId: "grp1", userId: "cus2" }), memberFixture({ groupId: "grp2", userId: "cus1" })],
    users: [userRow({ id: "cus2", name: "Bob" })],
  });
  const res = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "cus2", groupId: "grp2" } }, res, db);
  assert.equal(res.statusCode, 200);
  const grp1 = await db.group.findFirst({ where: { id: "grp1" } });
  const grp2 = await db.group.findFirst({ where: { id: "grp2" } });
  assert.equal(grp1.ownerId, "cus2");
  assert.equal(grp2.ownerId, "cus1");
});

test("transfer: the new owner can manage and the old owner is locked out", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob" })],
  });
  const transfer = response();
  await transferGroupOwner({ user: userFixture(), params: { groupId: "grp1" }, body: { userId: "cus2" } }, transfer, db);
  assert.equal(transfer.statusCode, 200);
  const asNewOwner = response();
  await updateGroup({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" }, body: { name: "Bob's Group" } }, asNewOwner, db);
  assert.equal(asNewOwner.statusCode, 200);
  const asOldOwner = response();
  await updateGroup({ user: userFixture(), params: { groupId: "grp1" }, body: { name: "Nope" } }, asOldOwner, db);
  assert.equal(asOldOwner.statusCode, 403);
});

// -------------------- Dissolve --------------------

test("dissolve: the owner soft-dissolves and the group 404s everywhere after", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await dissolveGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dissolved, true);
  const stored = await db.group.findMany({});
  assert.ok(stored[0].dissolvedAt instanceof Date, "dissolvedAt must be set (soft delete)");
  const again = response();
  await dissolveGroup({ user: userFixture(), params: { groupId: "grp1" } }, again, db);
  assert.equal(again.statusCode, 404);
  const detail = response();
  await getGroup({ user: userFixture(), params: { groupId: "grp1" } }, detail, db);
  assert.equal(detail.statusCode, 404);
});

test("dissolve: member and message rows are preserved", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    messages: [messageFixture({ senderId: "cus2" })],
  });
  const res = response();
  await dissolveGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal((await db.groupMember.findMany({})).length, 2);
  assert.equal((await db.groupMessage.findMany({})).length, 1);
});

test("dissolve: a non-owner cannot dissolve (403)", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })] });
  const res = response();
  await dissolveGroup({ user: userFixture({ id: "cus2", name: "Bob" }), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 403);
  const stored = await db.group.findMany({});
  assert.equal(stored[0].dissolvedAt, null);
});

test("dissolve: nonexistent and already-dissolved groups are 404", async () => {
  const groupCases = [null, groupFixture({ dissolvedAt: t("2026-09-05T00:00:00Z") })];
  for (const group of groupCases) {
    const db = makeDb(group ? { groups: [group] } : {});
    const res = response();
    await dissolveGroup({ user: userFixture(), params: { groupId: group ? "grp1" : "ghost" } }, res, db);
    assert.equal(res.statusCode, 404);
  }
});

test("dissolve: a blocked owner can still dissolve", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await dissolveGroup({ user: userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") }), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
});

test("dissolve: dissolved groups vanish from the discovery feed", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "g1" }), groupFixture({ id: "g2", dissolvedAt: t("2026-09-05T00:00:00Z") })],
  });
  const res = response();
  await listGroups({ user: userFixture(), query: {} }, res, db);
  assert.deepEqual(res.body.items.map((g) => g.id), ["g1"]);
});

test("dissolve: the owner can dissolve their own non-public group", async () => {
  const db = makeDb({ groups: [groupFixture({ type: "invite_only" })], members: [memberFixture({ userId: "cus1" })] });
  const res = response();
  await dissolveGroup({ user: userFixture(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dissolved, true);
});

// -------------------- Security / IDOR sweep --------------------

test("security: non-members get the same 404 across every group-scoped endpoint", async () => {
  // cus3 is an authenticated customer who is not a member of a real group.
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" })],
    users: [userRow({ id: "cus3", name: "Carol", communityProfile: profileEmbed({ id: "pro3", userId: "cus3", displayName: "Carol" }) })],
    messages: [messageFixture({ id: "msg1" })],
  });
  const user = userFixture({ id: "cus3", name: "Carol" });
  const cases = [
    ["listGroupMembers", { user, params: { groupId: "grp1" }, query: {} }],
    ["listGroupMessages", { user, params: { groupId: "grp1" }, query: {} }],
    ["sendGroupMessage", { user, params: { groupId: "grp1" }, body: { content: "hi" } }],
    ["deleteGroupMessage", { user, params: { groupId: "grp1", messageId: "msg1" } }],
  ];
  const handlers = { listGroupMembers, listGroupMessages, sendGroupMessage, deleteGroupMessage };
  for (const [fn, req] of cases) {
    const res = response();
    await handlers[fn](req, res, db);
    assert.equal(res.statusCode, 404, `${fn} must hide the group from non-members`);
    assert.equal(res.body.error, "Group not found", `${fn} must not disclose membership`);
  }
});

test("security: owner-only write actions all return 403 for non-owners", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob" })],
  });
  const user = userFixture({ id: "cus2", name: "Bob" });
  const cases = [
    ["updateGroup", { user, paramGroupId: "grp1", params: { groupId: "grp1" }, body: { name: "X" } }],
    ["removeGroupMember", { user, paramGroupId: "grp1", params: { groupId: "grp1", userId: "cus1" } }],
    ["transferGroupOwner", { user, paramGroupId: "grp1", params: { groupId: "grp1" }, body: { userId: "cus1" } }],
    ["dissolveGroup", { user, paramGroupId: "grp1", params: { groupId: "grp1" } }],
  ];
  const handlers = { updateGroup, removeGroupMember, transferGroupOwner, dissolveGroup };
  for (const [fn, req] of cases) {
    const res = response();
    await handlers[fn](req, res, db);
    assert.equal(res.statusCode, 403, `${fn} must be owner-only`);
  }
});