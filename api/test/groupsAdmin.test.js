import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requireAdmin } from "../src/middleware/auth.js";
import { ROLES } from "../src/config.js";
import {
  adminListGroups,
  adminGetGroup,
  adminListGroupMembers,
  adminListGroupMessages,
  adminRemoveGroupMember,
  adminDeleteGroupMessage,
  adminDissolveGroup,
  adminGroupActionLimiter,
  GROUP_LIMIT_MAX,
} from "../src/controllers/groups.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const t = (s) => new Date(s);

const P2025 = () => { const e = new Error("Record not found"); e.code = "P2025"; return e; };

const adminUser = (overrides = {}) => ({
  id: "adm1",
  name: "Root",
  role: ROLES.ADMIN,
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

const clone = (o) => structuredClone(o);

// In-memory fake of prisma.group + prisma.groupMember + prisma.groupMessage for
// the injected-db test pattern (same as makeDb in groups.test.js). Honors scalar
// where-filters (including Date equality, {lt} ranges, {in} lists and OR
// groups), multi-key orderBy and take. groupMember.delete throws P2025 when
// absent. groupMessage embeds the sender row (and groupMember the user row)
// from the `users` pool so the controller-owned shapes can be exercised.
const makeDb = ({ users = [], groups = [], members = [], messages = [] } = {}) => {
  const state = {
    users: users.map(clone),
    groups: groups.map(clone),
    members: members.map(clone),
    messages: messages.map(clone),
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
      update: async ({ where, data }) => {
        const i = state.groups.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        const updated = { ...state.groups[i], ...data };
        state.groups[i] = updated;
        return clone(updated);
      },
    },
    groupMember: {
      findMany: async ({ where, orderBy, take } = {}) => {
        let out = state.members.filter((r) => rowMatch(r, where));
        out = sortRows(out, orderBy);
        if (take !== undefined) out = out.slice(0, take);
        const rows = out.map(clone);
        rows.forEach(embedUser);
        return rows;
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
      update: async ({ where, data }) => {
        const i = state.messages.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        const updated = { ...state.messages[i], ...data };
        state.messages[i] = updated;
        return embedSender(clone(updated));
      },
    },
  };
  return db;
};

// A full User row with sensitive account fields present so leaks are detected.
const userRow = (overrides = {}) => ({
  id: "cus1",
  name: "Alice",
  email: "alice@example.com",
  passwordHash: "secret-hash",
  phone: "555-0100",
  role: ROLES.CUSTOMER,
  status: "customer",
  communityBlockedAt: null,
  lastActiveAt: t("2026-09-28T00:00:00Z"),
  communityProfile: null,
  ...overrides,
});

const memberWithUser = (memberOverrides = {}, userOverrides = {}) => {
  const m = memberFixture(memberOverrides);
  return { member: m, user: userRow({ id: m.userId, name: m.userId === "cus1" ? "Alice" : "Bob", ...userOverrides }) };
};

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

// `status` is intentionally excluded: it is the GROUP state field ("active" /
// "dissolved") an admin requires. The User account status can never leak because
// members/owners/senders are serialized by whitelisted shapes only.
const SENSITIVE = ["email", "passwordHash", "phone", "communityBlockedAt", "lastActiveAt", "role"];

const assertNoSensitive = (obj, path = "") => {
  if (obj === null || typeof obj !== "object") return;
  for (const k of SENSITIVE) {
    assert.equal(Object.prototype.hasOwnProperty.call(obj, k), false, `${path}.${k} must not be exposed`);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      for (const item of v) assertNoSensitive(item, `${path}.${k}[]`);
    } else if (v !== null && typeof v === "object") {
      assertNoSensitive(v, `${path}.${k}`);
    }
  }
};

// -------------------- Auth (401 / 403) --------------------

test("admin groups: unauthenticated access is blocked with 401", async () => {
  const res = response();
  await requireAdmin({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("admin groups: customer access is blocked with 403", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
});

test("admin groups: defense-in-depth 403 when a customer reaches an admin handler", async () => {
  const db = makeDb({ groups: [groupFixture()] });
  for (const [handler, req] of [
    [adminListGroups, { user: { role: "customer" }, query: {} }],
    [adminGetGroup, { user: { role: "customer" }, params: { groupId: "grp1" } }],
    [adminListGroupMembers, { user: { role: "customer" }, params: { groupId: "grp1" }, query: {} }],
    [adminListGroupMessages, { user: { role: "customer" }, params: { groupId: "grp1" }, query: {} }],
    [adminRemoveGroupMember, { user: { role: "customer" }, params: { groupId: "grp1", userId: "cus2" } }],
    [adminDeleteGroupMessage, { user: { role: "customer" }, params: { groupId: "grp1", messageId: "msg1" } }],
    [adminDissolveGroup, { user: { role: "customer" }, params: { groupId: "grp1" } }],
  ]) {
    const res = response();
    await handler(req, res, db);
    assert.equal(res.statusCode, 403, `${handler.name} must stay 403 for customers`);
  }
});

test("admin groups: defense-in-depth 403 with no req.user", async () => {
  const db = makeDb({ groups: [groupFixture()] });
  const res = response();
  await adminListGroups({ query: {} }, res, db);
  assert.equal(res.statusCode, 403);
});

// -------------------- GET /admin/community/groups --------------------

test("admin groups: lists public groups with owner, memberCount and status", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "grp2" }), groupFixture({ id: "grp1" })],
    members: [memberFixture({ groupId: "grp1", userId: "cus1" }), memberFixture({ groupId: "grp1", userId: "cus2" })],
  });
  const res = response();
  await adminListGroups({ user: adminUser(), query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.hasMore, false);
  assert.equal(res.body.nextCursor, null);

  const grp2 = res.body.items[0];
  assert.equal(grp2.id, "grp2");
  assert.equal(grp2.status, "active");
  assert.equal(grp2.dissolvedAt, null);
  assert.equal(grp2.memberCount, 0);
  assert.deepEqual(grp2.owner, { id: "cus1", name: "Alice" });

  const grp1 = res.body.items[1];
  assert.equal(grp1.memberCount, 2);
  assertNoSensitive(res.body);
});

test("admin groups: dissolved groups stay visible with status dissolved", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "grp1", dissolvedAt: t("2026-09-10T00:00:00Z") })],
  });
  const res = response();
  await adminListGroups({ user: adminUser(), query: {} }, res, db);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].status, "dissolved");
  assert.equal(res.body.items[0].dissolvedAt.getTime(), t("2026-09-10T00:00:00Z").getTime());
});

test("admin groups: non-public groups appear in discovery (admins see all types)", async () => {
  const db = makeDb({
    groups: [
      groupFixture({ id: "grp1" }),
      groupFixture({ id: "grp2", type: "private", name: "Secret" }),
      groupFixture({ id: "grp3", type: "invite_only", name: "Invite Club" }),
    ],
  });
  const res = response();
  await adminListGroups({ user: adminUser(), query: {} }, res, db);
  assert.deepEqual(res.body.items.map((g) => g.id).sort(), ["grp1", "grp2", "grp3"]);
  assert.equal(res.body.items.find((g) => g.id === "grp2").type, "private");
});

test("admin groups: discovery pagination does not skip or duplicate", async () => {
  const db = makeDb({ groups: genGroups(5) });
  const page1 = response();
  await adminListGroups({ user: adminUser(), query: { limit: "2" } }, page1, db);
  assert.equal(page1.body.items.length, 2);
  assert.equal(page1.body.hasMore, true);
  assert.deepEqual(page1.body.items.map((g) => g.id), ["g004", "g003"]);
  assert.ok(typeof page1.body.nextCursor === "string" && page1.body.nextCursor.length > 0);

  const page2 = response();
  await adminListGroups(
    { user: adminUser(), query: { limit: "2", before: page1.body.nextCursor } },
    page2,
    db,
  );
  assert.equal(page2.body.items.length, 2);
  assert.equal(page2.body.hasMore, true);
  assert.deepEqual(page2.body.items.map((g) => g.id), ["g002", "g001"]);
  assert.ok(
    !page2.body.items.some((g) => page1.body.items.some((p) => p.id === g.id)),
    "no items shared between pages",
  );

  const page3 = response();
  await adminListGroups(
    { user: adminUser(), query: { limit: "2", before: page2.body.nextCursor } },
    page3,
    db,
  );
  assert.equal(page3.body.items.length, 1);
  assert.equal(page3.body.items[0].id, "g000");
  assert.equal(page3.body.hasMore, false);
  assert.equal(page3.body.nextCursor, null);
});

test("admin groups: invalid limit is a 400", async () => {
  const db = makeDb({ groups: genGroups(3) });
  for (const limit of ["0", "-1", "1.5", "abc", String(GROUP_LIMIT_MAX + 1)]) {
    const res = response();
    await adminListGroups({ user: adminUser(), query: { limit } }, res, db);
    assert.equal(res.statusCode, 400, `limit=${limit}`);
  }
});

test("admin groups: invalid before cursor is a 400", async () => {
  const db = makeDb({ groups: genGroups(3) });
  const res = response();
  await adminListGroups({ user: adminUser(), query: { limit: 2, before: "not-a-cursor" } }, res, db);
  assert.equal(res.statusCode, 400);
});

// -------------------- GET /admin/community/groups/:groupId --------------------

test("admin groups: detail returns group with owner and memberCount", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture(), memberFixture({ userId: "cus2", joinedAt: t("2026-09-03T00:00:00Z") })],
  });
  const res = response();
  await adminGetGroup({ user: adminUser(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group.id, "grp1");
  assert.equal(res.body.group.status, "active");
  assert.equal(res.body.group.memberCount, 2);
  assert.deepEqual(res.body.group.owner, { id: "cus1", name: "Alice" });
  assertNoSensitive(res.body);
});

test("admin groups: detail works on a dissolved group", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "grp1", dissolvedAt: t("2026-09-10T00:00:00Z") })],
  });
  const res = response();
  await adminGetGroup({ user: adminUser(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.group.status, "dissolved");
});

test("admin groups: detail 404 for missing groups", async () => {
  const missing = makeDb({ groups: [groupFixture()] });
  const missRes = response();
  await adminGetGroup({ user: adminUser(), params: { groupId: "ghost" } }, missRes, missing);
  assert.equal(missRes.statusCode, 404, "missing group must 404");
});

test("admin groups: moderation covers non-public groups end-to-end without codes", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "grp1", type: "invite_only", inviteCode: "secretcode123" })],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2" })],
    users: [userRow({ id: "cus2", name: "Bob" })],
    messages: [messageFixture({ id: "msg1", senderId: "cus2" })],
  });

  const feed = response();
  await adminListGroupMessages({ user: adminUser(), params: { groupId: "grp1" }, query: {} }, feed, db);
  assert.equal(feed.statusCode, 200);
  assert.equal(feed.body.messages.length, 1);
  assert.ok(!JSON.stringify(feed.body).includes("secretcode123"), "admin message payload must be code-free");

  const remove = response();
  await adminRemoveGroupMember({ user: adminUser(), params: { groupId: "grp1", userId: "cus2" } }, remove, db);
  assert.equal(remove.statusCode, 200);

  const del = response();
  await adminDeleteGroupMessage({ user: adminUser(), params: { groupId: "grp1", messageId: "msg1" } }, del, db);
  assert.equal(del.statusCode, 200);

  const dissolve = response();
  await adminDissolveGroup({ user: adminUser(), params: { groupId: "grp1" } }, dissolve, db);
  assert.equal(dissolve.statusCode, 200);
});

test("admin groups: detail works on non-public groups without ever returning the code", async () => {
  for (const type of ["private", "invite_only"]) {
    const nonPublic = makeDb({ groups: [groupFixture({ id: "grp2", type, inviteCode: "secretcode123" })] });
    const privRes = response();
    await adminGetGroup({ user: adminUser(), params: { groupId: "grp2" } }, privRes, nonPublic);
    assert.equal(privRes.statusCode, 200, `${type} group must be visible to admins`);
    assert.equal(privRes.body.group.type, type);
    assert.ok(!JSON.stringify(privRes.body).includes("secretcode123"), "admin detail must never expose the invite code");
  }
});

test("admin groups: detail requires a groupId param", async () => {
  const db = makeDb({ groups: [groupFixture()] });
  const res = response();
  await adminGetGroup({ user: adminUser(), params: {} }, res, db);
  assert.equal(res.statusCode, 400);
});

// -------------------- GET /admin/community/groups/:groupId/members --------------------

test("admin groups: members list is safe and ordered", async () => {
  const { member: m1, user: u1 } = memberWithUser({ userId: "cus1", joinedAt: t("2026-09-02T00:00:00Z") });
  const { member: m2, user: u2 } = memberWithUser({ userId: "cus2", joinedAt: t("2026-09-03T00:00:00Z") });
  const db = makeDb({ groups: [groupFixture()], members: [m1, m2], users: [u1, u2] });
  const res = response();
  await adminListGroupMembers({ user: adminUser(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.members.length, 2);
  assert.equal(res.body.members[0].userId, "cus2");
  assert.equal(res.body.members[1].userId, "cus1");
  assert.deepEqual(
    Object.keys(res.body.members[0]).sort(),
    ["joinedAt", "user", "userId"],
    "members are serialized by the safe memberShape",
  );
  assertNoSensitive(res.body);
});

test("admin groups: members list works on a dissolved group", async () => {
  const db = makeDb({
    groups: [groupFixture({ dissolvedAt: t("2026-09-10T00:00:00Z") })],
    members: [memberFixture()],
  });
  const res = response();
  await adminListGroupMembers({ user: adminUser(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.members.length, 1);
});

test("admin groups: members list 404 for missing groups", async () => {
  const db = makeDb({ groups: [groupFixture()] });
  const res = response();
  await adminListGroupMembers({ user: adminUser(), params: { groupId: "ghost" }, query: {} }, res, db);
  assert.equal(res.statusCode, 404);
});

test("admin groups: members list paginates", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: Array.from({ length: 5 }, (_, i) =>
      memberFixture({ userId: `cus${i}`, joinedAt: t(`2026-09-02T00:00:0${i}Z`) }),
    ),
  });
  const page1 = response();
  await adminListGroupMembers({ user: adminUser(), params: { groupId: "grp1" }, query: { limit: "3" } }, page1, db);
  assert.equal(page1.body.members.length, 3);
  assert.equal(page1.body.hasMore, true);

  const page2 = response();
  await adminListGroupMembers(
    { user: adminUser(), params: { groupId: "grp1" }, query: { limit: "3", before: page1.body.nextCursor } },
    page2,
    db,
  );
  assert.equal(page2.body.members.length, 2);
  assert.equal(page2.body.hasMore, false);
  assert.equal(page2.body.nextCursor, null);
});

// -------------------- GET /admin/community/groups/:groupId/messages --------------------

test("admin groups: messages list includes moderation attribution", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    messages: [
      messageFixture({ id: "msg1", senderId: "cus1" }),
      messageFixture({
        id: "msg2",
        senderId: "cus2",
        content: "Old msg",
        createdAt: t("2026-09-01T00:00:00Z"),
        deletedAt: t("2026-09-05T00:00:00Z"),
        deletedById: "adm1",
      }),
    ],
  });
  const res = response();
  await adminListGroupMessages({ user: adminUser(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);

  const [live, deleted] = res.body.messages;
  assert.equal(live.id, "msg1");
  assert.equal(live.content, "Hello group!");
  assert.equal(live.deleted, false);
  assert.equal(live.deletedById, null);
  assert.equal(live.deletedAt, null);

  assert.equal(deleted.id, "msg2");
  assert.equal(deleted.content, null);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.deletedById, "adm1");
  assert.equal(deleted.deletedAt.getTime(), t("2026-09-05T00:00:00Z").getTime());

  const senderKeys = Object.keys(res.body.messages[0].sender).sort();
  assert.deepEqual(
    senderKeys,
    ["avatarUrl", "id", "name"],
    "senders use the safe senderShape (avatarUrl present as null when unset)",
  );
  assertNoSensitive(res.body);
});

test("admin groups: messages list works on a dissolved group", async () => {
  const db = makeDb({
    groups: [groupFixture({ dissolvedAt: t("2026-09-10T00:00:00Z") })],
    messages: [messageFixture()],
  });
  const res = response();
  await adminListGroupMessages({ user: adminUser(), params: { groupId: "grp1" }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.messages.length, 1);
});

test("admin groups: messages list 404 for missing groups", async () => {
  const db = makeDb({ groups: [groupFixture()] });
  const res = response();
  await adminListGroupMessages({ user: adminUser(), params: { groupId: "ghost" }, query: {} }, res, db);
  assert.equal(res.statusCode, 404);
});

test("admin groups: messages list paginates", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    messages: Array.from({ length: 5 }, (_, i) =>
      messageFixture({ id: `msg${i}`, createdAt: t(`2026-09-02T00:00:0${i}Z`) }),
    ),
  });
  const page1 = response();
  await adminListGroupMessages({ user: adminUser(), params: { groupId: "grp1" }, query: { limit: "3" } }, page1, db);
  assert.equal(page1.body.messages.length, 3);
  assert.equal(page1.body.hasMore, true);

  const page2 = response();
  await adminListGroupMessages(
    { user: adminUser(), params: { groupId: "grp1" }, query: { limit: "3", before: page1.body.nextCursor } },
    page2,
    db,
  );
  assert.equal(page2.body.messages.length, 2);
  assert.equal(page2.body.hasMore, false);
});

// -------------------- DELETE /admin/community/groups/:groupId/members/:userId --------------------

test("admin groups: removes a member but keeps their messages", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2", joinedAt: t("2026-09-03T00:00:00Z") })],
    messages: [messageFixture({ senderId: "cus2" })],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminRemoveGroupMember({ user: adminUser(), params: { groupId: "grp1", userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, groupId: "grp1", memberId: "cus2", removed: true });

  const members = await db.groupMember.findMany({ where: { groupId: "grp1" } });
  assert.equal(members.length, 1);
  assert.equal(members[0].userId, "cus1");
  const msgs = await db.groupMessage.findMany({ where: { groupId: "grp1" } });
  assert.equal(msgs.length, 1, "messages are never deleted when a member is removed");
  assert.equal(msgs[0].senderId, "cus2");
});

test("admin groups: owner removal returns 400", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2", joinedAt: t("2026-09-03T00:00:00Z") })],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminRemoveGroupMember({ user: adminUser(), params: { groupId: "grp1", userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.includes("owner"), "error message must explain the owner invariant");
});

test("admin groups: owner removal still 400 on a dissolved group", async () => {
  const db = makeDb({
    groups: [groupFixture({ dissolvedAt: t("2026-09-10T00:00:00Z") })],
    members: [memberFixture({ userId: "cus1" })],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminRemoveGroupMember({ user: adminUser(), params: { groupId: "grp1", userId: "cus1" } }, res, db);
  assert.equal(res.statusCode, 400);
});

test("admin groups: non-member removal is idempotent (P2025 swallowed)", async () => {
  const db = makeDb({ groups: [groupFixture()], members: [memberFixture({ userId: "cus1" })] });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminRemoveGroupMember({ user: adminUser(), params: { groupId: "grp1", userId: "cus99" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, groupId: "grp1", memberId: "cus99", removed: true });
});

test("admin groups: remove on missing group returns 404", async () => {
  const db = makeDb();
  adminGroupActionLimiter._reset();
  const res = response();
  await adminRemoveGroupMember({ user: adminUser(), params: { groupId: "ghost", userId: "cus2" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("admin groups: remove-member ignores body userId", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture({ userId: "cus1" }), memberFixture({ userId: "cus2", joinedAt: t("2026-09-03T00:00:00Z") })],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminRemoveGroupMember(
    { user: adminUser(), params: { groupId: "grp1", userId: "cus2" }, body: { userId: "cus1" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.memberId, "cus2", "the params userId must win over body");
});

test("admin groups: remove-member is rate-limited", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: Array.from({ length: 65 }, (_, i) => memberFixture({ userId: `cus${i}` })),
  });
  adminGroupActionLimiter._reset();
  for (let i = 0; i < 60; i++) {
    const res = response();
    await adminRemoveGroupMember(
      { user: adminUser(), params: { groupId: "grp1", userId: `cus${i + 3}` } },
      res,
      db,
    );
    assert.equal(res.statusCode, 200);
  }
  const res = response();
  await adminRemoveGroupMember({ user: adminUser(), params: { groupId: "grp1", userId: "cus64" } }, res, db);
  assert.equal(res.statusCode, 429);
});

// -------------------- DELETE /admin/community/groups/:groupId/messages/:messageId --------------------

test("admin groups: soft-deletes a message and sets deletedById", async () => {
  const db = makeDb({ groups: [groupFixture()], messages: [messageFixture()] });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDeleteGroupMessage({ user: adminUser(), params: { groupId: "grp1", messageId: "msg1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.message.content, null);
  assert.equal(res.body.message.deleted, true);
  assert.equal(res.body.message.deletedById, "adm1");
  assert.ok(res.body.message.deletedAt instanceof Date);
});

test("admin groups: delete is idempotent on a twice-deleted message", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    messages: [messageFixture({ deletedAt: t("2026-09-05T00:00:00Z"), deletedById: "adm1" })],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDeleteGroupMessage({ user: adminUser(), params: { groupId: "grp1", messageId: "msg1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.deletedById, "adm1");
  assert.equal(res.body.message.deletedAt.getTime(), t("2026-09-05T00:00:00Z").getTime());
});

test("admin groups: cross-group messageId returns 404", async () => {
  const db = makeDb({
    groups: [groupFixture({ id: "grp1" }), groupFixture({ id: "grp2", name: "Other" })],
    messages: [messageFixture({ id: "msg1", groupId: "grp1" }), messageFixture({ id: "msg2", groupId: "grp2", senderId: "cus2" })],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDeleteGroupMessage({ user: adminUser(), params: { groupId: "grp1", messageId: "msg2" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("admin groups: delete on nonexistent message returns 404", async () => {
  const db = makeDb({ groups: [groupFixture()] });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDeleteGroupMessage({ user: adminUser(), params: { groupId: "grp1", messageId: "ghost" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("admin groups: delete on missing group returns 404", async () => {
  const db = makeDb();
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDeleteGroupMessage({ user: adminUser(), params: { groupId: "ghost", messageId: "msg1" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("admin groups: delete ignores body messageId", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    messages: [messageFixture({ id: "msg1" }), messageFixture({ id: "msg2", senderId: "cus2" })],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDeleteGroupMessage(
    { user: adminUser(), params: { groupId: "grp1", messageId: "msg1" }, body: { messageId: "msg2" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.id, "msg1", "params messageId must win");
});

test("admin groups: delete is rate-limited", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    messages: Array.from({ length: 65 }, (_, i) => messageFixture({ id: `msg${i}`, senderId: "cus1" })),
  });
  adminGroupActionLimiter._reset();
  for (let i = 0; i < 60; i++) {
    const res = response();
    await adminDeleteGroupMessage({ user: adminUser(), params: { groupId: "grp1", messageId: `msg${i}` } }, res, db);
    assert.equal(res.statusCode, 200);
  }
  const res = response();
  await adminDeleteGroupMessage({ user: adminUser(), params: { groupId: "grp1", messageId: "msg64" } }, res, db);
  assert.equal(res.statusCode, 429);
});

// -------------------- POST /admin/community/groups/:groupId/dissolve --------------------

test("admin groups: dissolves an active group", async () => {
  const db = makeDb({
    groups: [groupFixture()],
    members: [memberFixture()],
    messages: [messageFixture()],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDissolveGroup({ user: adminUser(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, groupId: "grp1", dissolved: true });

  const group = await db.group.findFirst({ where: { id: "grp1" } });
  assert.ok(group.dissolvedAt instanceof Date, "dissolvedAt must be set");
  const members = await db.groupMember.findMany({ where: { groupId: "grp1" } });
  assert.equal(members.length, 1, "members are preserved");
  const msgs = await db.groupMessage.findMany({ where: { groupId: "grp1" } });
  assert.equal(msgs.length, 1, "messages are preserved");
});

test("admin groups: already-dissolved group is idempotent", async () => {
  const dissolvedAt = t("2026-09-10T00:00:00Z");
  const db = makeDb({
    groups: [groupFixture({ dissolvedAt })],
  });
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDissolveGroup({ user: adminUser(), params: { groupId: "grp1" } }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, groupId: "grp1", dissolved: true });
});

test("admin groups: dissolve on missing group returns 404", async () => {
  const db = makeDb();
  adminGroupActionLimiter._reset();
  const res = response();
  await adminDissolveGroup({ user: adminUser(), params: { groupId: "ghost" } }, res, db);
  assert.equal(res.statusCode, 404);
});

test("admin groups: dissolve is rate-limited", async () => {
  const db = makeDb({ groups: Array.from({ length: 65 }, (_, i) => groupFixture({ id: `g${String(i).padStart(3, "0")}` })) });
  adminGroupActionLimiter._reset();
  for (let i = 0; i < 60; i++) {
    const res = response();
    await adminDissolveGroup({ user: adminUser(), params: { groupId: `g${String(i).padStart(3, "0")}` } }, res, db);
    assert.equal(res.statusCode, 200);
  }
  const res = response();
  await adminDissolveGroup({ user: adminUser(), params: { groupId: "g064" } }, res, db);
  assert.equal(res.statusCode, 429);
});

// -------------------- Route registration --------------------

test("routes: the seven G1d admin group routes are registered", () => {
  const src = readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  for (const path of [
    'router.get("/admin/community/groups", adminOnly, groups.adminListGroups)',
    'router.get("/admin/community/groups/:groupId", adminOnly, groups.adminGetGroup)',
    'router.get("/admin/community/groups/:groupId/members", adminOnly, groups.adminListGroupMembers)',
    'router.get("/admin/community/groups/:groupId/messages", adminOnly, groups.adminListGroupMessages)',
    'router.delete("/admin/community/groups/:groupId/members/:userId", adminOnly, groups.adminRemoveGroupMember)',
    'router.delete("/admin/community/groups/:groupId/messages/:messageId", adminOnly, groups.adminDeleteGroupMessage)',
    'router.post("/admin/community/groups/:groupId/dissolve", adminOnly, groups.adminDissolveGroup)',
  ]) {
    assert.ok(src.includes(path), `route ${path} must be registered`);
  }
  assert.ok(src.includes('router.get("/community/messages"'), "community V1 routes must remain");
  assert.ok(src.includes('router.get("/admin/community/users"'), "community V1 admin routes must remain");
  assert.ok(src.includes('router.get("/community/groups", authenticate, requireCustomer, groups.listGroups)'), "customer group routes must remain");
});

// -------------------- Existing file isolation --------------------

test("isolation: existing controllers were not touched", () => {
  for (const file of ["community.js", "profiles.js", "messages.js"]) {
    const src = readFileSync(new URL(`../src/controllers/${file}`, import.meta.url), "utf8");
    assert.ok(!/\bGroups?\b/.test(src), `${file} must not reference groups`);
  }
});