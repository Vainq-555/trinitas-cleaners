import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requireAdmin, requireCustomer } from "../src/middleware/auth.js";
import { ROLES } from "../src/config.js";
import {
  adminBlockUser,
  adminListCommunityMessages,
  adminListCommunityUsers,
  adminUnblockUser,
  communityPostLimiter,
  createCommunityMessage,
  listCommunityMessages,
} from "../src/controllers/community.js";
import { COMMUNITY_LIMIT_MAX, COMMUNITY_MESSAGE_MAX_LENGTH } from "../src/utils/validators.js";

const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const t = (s) => new Date(s);
const epoch = (s) => t(s).getTime();

const messageFixture = (overrides = {}) => ({
  id: "cm1",
  customerId: "cus1",
  content: "Hello community!",
  createdAt: t("2026-09-01T00:00:00Z"),
  customer: { id: "cus1", name: "Alice" },
  ...overrides,
});

const userFixture = (overrides = {}) => ({
  id: "cus1",
  name: "Alice",
  role: "customer",
  communityBlockedAt: null,
  ...overrides,
});

// In-memory fake of prisma.communityMessage + prisma.user for the injected-db
// test pattern (same as makeDb in reviews.test.js). Honors scalar where-filters
// (including Date equality + {lt} ranges), OR groups, multi-key orderBy and
// take. Rows carry their `customer` relation shape already; the fake never
// joins. No `.message` accessor is exposed: any community code that touches the
// existing Message model throws here, proving isolation.
const makeDb = ({ messages = [], users = [] } = {}) => {
  const msgRows = messages.map((m) => ({ ...m }));
  const userRows = users.map((u) => ({ ...u }));
  let seq = msgRows.length;

  function leafMatch(row, k, v) {
    if (v instanceof Date) return row[k] instanceof Date ? row[k].getTime() === v.getTime() : row[k] === v;
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

  return {
    communityMessage: {
      findMany: async ({ where, orderBy, take } = {}) => {
        let out = msgRows.filter((r) => rowMatch(r, where));
        out = sortRows(out, orderBy);
        if (take !== undefined) out = out.slice(0, take);
        return out;
      },
      create: async ({ data }) => {
        const owner = userRows.find((u) => u.id === data.customerId);
        const m = {
          id: `cm${++seq}`,
          createdAt: t("2026-09-30T00:00:00Z"),
          customer: { id: data.customerId, name: owner?.name ?? null },
          ...data,
        };
        msgRows.push(m);
        return m;
      },
    },
    user: {
      findUnique: async ({ where } = {}) => userRows.find((u) => u.id === where.id) ?? null,
      update: async ({ where, data } = {}) => {
        const i = userRows.findIndex((u) => u.id === where.id);
        userRows[i] = { ...userRows[i], ...data };
        return userRows[i];
      },
      findMany: async ({ where = {}, orderBy } = {}) => {
        let out = userRows.filter((u) => rowMatch(u, where));
        return sortRows(out, orderBy);
      },
    },
  };
};

// ---- Authorization (middleware; routes are registered in CP3) ----

test("unauthenticated community GET is blocked with 401", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("unauthenticated community POST is blocked with 401", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("non-customer is blocked from customer community routes with 403", async () => {
  const res = response();
  await requireCustomer({ user: { role: "admin" } }, res, () => assert.fail("admin should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
});

test("admin cannot create a community message through the customer endpoint", async () => {
  const db = makeDb();
  const res = response();
  await createCommunityMessage({ user: { id: "adm1", role: "admin" }, body: { content: "Admin not allowed" } }, res, db);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "Only customers can post to the community");
});

test("anonymous cannot create a community message (no req.user)", async () => {
  const db = makeDb();
  const res = response();
  await createCommunityMessage({ body: { content: "Hello" } }, res, db);
  assert.equal(res.statusCode, 403);
});

test("unauthenticated admin community endpoint is blocked with 401", async () => {
  const res = response();
  await requireAdmin({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("customer is blocked from admin community endpoints with 403", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
});

// ---- Customer POST validation ----

test("valid message succeeds (201, trimmed, stored under req.user)", async () => {
  const db = makeDb({ users: [userFixture()] });
  const res = response();
  await createCommunityMessage({ user: userFixture(), body: { content: "  Hello world!  " } }, res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message.content, "Hello world!");
  assert.equal(res.body.message.customer.id, "cus1");
  assert.equal(res.body.message.customer.name, "Alice");

  // Confirm the stored row uses req.user.id and the trimmed content.
  const list = response();
  await listCommunityMessages({ user: userFixture(), query: {} }, list, db);
  assert.equal(list.body.messages.length, 1);
  assert.equal(list.body.messages[0].content, "Hello world!");
  assert.equal(list.body.messages[0].customer.id, "cus1");
});

test("missing or whitespace-only content is rejected with 400", async () => {
  const db = makeDb();
  for (const content of [undefined, "", "   \t  "]) {
    const res = response();
    await createCommunityMessage({ user: userFixture(), body: { content } }, res, db);
    assert.equal(res.statusCode, 400, "empty content should be rejected");
    assert.equal(res.body.error, "content is required");
  }
});

test("message over 1000 characters is rejected with 400", async () => {
  const db = makeDb();
  const res = response();
  await createCommunityMessage({ user: userFixture(), body: { content: "x".repeat(1001) } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, `content must be ${COMMUNITY_MESSAGE_MAX_LENGTH} characters or fewer`);
});

test("exactly 1000 characters succeeds", async () => {
  communityPostLimiter._reset();
  const db = makeDb();
  const res = response();
  await createCommunityMessage({ user: userFixture(), body: { content: "x".repeat(1000) } }, res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message.content.length, 1000);
});

test("supplied customerId in the body cannot impersonate another user", async () => {
  communityPostLimiter._reset();
  const db = makeDb();
  const res = response();
  await createCommunityMessage(
    { user: userFixture(), body: { content: "Hello", customerId: "mallory" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.message.customer.id, "cus1");
  assert.notEqual(res.body.message.customer.id, "mallory");
});

// ---- Safe response shape (GET) ----

test("community GET returns public identity and never private customer fields", async () => {
  const db = makeDb({
    messages: [
      messageFixture({
        customer: {
          id: "cus1",
          name: "Alice",
          email: "alice@x.com",
          phone: "555-1234",
          address: "1 Main St",
          status: "online",
          lastActiveAt: t("2026-09-30T00:00:00Z"),
          passwordHash: "hashed-credential",
        },
      }),
    ],
  });
  const res = response();
  await listCommunityMessages({ user: userFixture(), query: {} }, res, db);
  assert.equal(res.body.messages[0].customer.name, "Alice");
  assert.equal(res.body.messages[0].customer.id, "cus1");

  const payload = JSON.stringify(res.body);
  for (const forbidden of ["email", "phone", "address", "password", "status", "lastActiveAt", "secret", "token", "credential"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `community payload must not contain ${forbidden}`);
  }
  assert.equal(res.body.messages[0].customer.email, undefined);
  assert.equal(res.body.messages[0].customer.phone, undefined);
  assert.equal(res.body.messages[0].customer.address, undefined);
});

// ---- Pagination ----

test("default limit is 50 and returns hasMore/nextBefore correctly", async () => {
  const db = makeDb({
    messages: Array.from({ length: 60 }, (_, idx) => messageFixture({ id: `cm${idx}`, content: `m${idx}`, createdAt: t(`2026-09-01T00:00:${String(idx).padStart(2, "0")}Z`), customer: { id: "cus1", name: "Alice" } })),
  });
  const res = response();
  await listCommunityMessages({ user: userFixture(), query: {} }, res, db);
  assert.equal(res.body.messages.length, 50);
  assert.equal(res.body.hasMore, true);
  assert.ok(typeof res.body.nextBefore === "string" && res.body.nextBefore.length > 0);
});

test("exactly 50 messages yields hasMore false and nextBefore null", async () => {
  const db = makeDb({
    messages: Array.from({ length: 50 }, (_, idx) => messageFixture({ id: `cm${idx}`, createdAt: t(`2026-09-01T00:00:${String(idx).padStart(2, "0")}Z`) })),
  });
  const res = response();
  await listCommunityMessages({ user: userFixture(), query: {} }, res, db);
  assert.equal(res.body.messages.length, 50);
  assert.equal(res.body.hasMore, false);
  assert.equal(res.body.nextBefore, null);
});

test("maximum limit 100 works", async () => {
  const db = makeDb({
    messages: Array.from({ length: 120 }, (_, idx) => messageFixture({ id: `cm${idx}`, createdAt: t(`2026-09-01T00:00:${String(idx).padStart(2, "0")}Z`) })),
  });
  const res = response();
  await listCommunityMessages({ user: userFixture(), query: { limit: "100" } }, res, db);
  assert.equal(res.body.messages.length, 100);
  assert.equal(res.body.hasMore, true);
});

test("invalid limits are rejected with 400", async () => {
  const db = makeDb();
  for (const limit of ["0", "-1", "101", "abc", "1.5", "[]"]) {
    const res = response();
    await listCommunityMessages({ user: userFixture(), query: { limit } }, res, db);
    assert.equal(res.statusCode, 400, `limit=${limit} should be rejected`);
    assert.match(res.body.error, /limit must be an integer/);
  }
});

test("cursor returns older messages without overlap and nextBefore null at the end", async () => {
  const db = makeDb({
    messages: Array.from({ length: 60 }, (_, idx) => messageFixture({ id: `cm${idx}`, content: `m${idx}`, createdAt: t(`2026-09-01T00:00:${String(idx).padStart(2, "0")}Z`) })),
  });
  let before;
  let previous = [];
  let lastBody;
  for (let page = 1; page <= 6; page += 1) {
    const res = response();
    await listCommunityMessages({ user: userFixture(), query: { limit: 10, before } }, res, db);
    assert.equal(res.body.messages.length, 10, `page ${page} should carry exactly 10 messages`);
    assert.equal(res.body.messages[0].content, `m${59 - (page - 1) * 10}`, `page ${page} should start newest-first at the right offset`);
    if (page > 1) {
      const overlap = res.body.messages.filter((m) => previous.includes(m));
      assert.equal(overlap.length, 0, `page ${page} must not overlap the previous page`);
    }
    previous = res.body.messages;
    assert.equal(res.body.hasMore, page < 6);
    before = res.body.nextBefore;
    if (page < 6) assert.ok(typeof before === "string" && before.length > 0);
    lastBody = res.body;
  }
  assert.equal(lastBody.hasMore, false);
  assert.equal(lastBody.nextBefore, null);
});

test("malformed cursors are rejected with 400", async () => {
  const db = makeDb();
  const badCursors = [
    "not-a-cursor",
    Buffer.from("not json", "utf8").toString("base64url"),
  ];
  for (const before of badCursors) {
    const res = response();
    await listCommunityMessages({ user: userFixture(), query: { limit: 10, before } }, res, db);
    assert.equal(res.statusCode, 400, `cursor ${before} should be rejected`);
    assert.match(res.body.error, /before must be a valid cursor/);
  }
});

test("a malformed cursor payload (missing id / bad t) is rejected with 400", async () => {
  const db = makeDb();
  const noId = Buffer.from(JSON.stringify({ t: epoch("2026-09-01T00:00:00Z") })).toString("base64url");
  const badT = Buffer.from(JSON.stringify({ t: "now", i: "cm1" })).toString("base64url");
  for (const before of [noId, badT]) {
    const res = response();
    await listCommunityMessages({ user: userFixture(), query: { limit: 10, before } }, res, db);
    assert.equal(res.statusCode, 400);
  }
});

test("same-createdAt messages use the id tie-break and pages do not overlap", async () => {
  const same = t("2026-09-01T00:00:00Z");
  const db = makeDb({
    messages: [
      messageFixture({ id: "c6", createdAt: same }),
      messageFixture({ id: "c1", createdAt: same }),
      messageFixture({ id: "c5", createdAt: same }),
      messageFixture({ id: "c3", createdAt: same }),
      messageFixture({ id: "c4", createdAt: same }),
      messageFixture({ id: "c2", createdAt: same }),
    ],
  });
  const page1 = response();
  await listCommunityMessages({ user: userFixture(), query: { limit: 2 } }, page1, db);
  assert.deepEqual(page1.body.messages.map((m) => m.id), ["c6", "c5"]);
  assert.equal(page1.body.hasMore, true);

  const page2 = response();
  await listCommunityMessages({ user: userFixture(), query: { limit: 2, before: page1.body.nextBefore } }, page2, db);
  assert.deepEqual(page2.body.messages.map((m) => m.id), ["c4", "c3"]);

  const page3 = response();
  await listCommunityMessages({ user: userFixture(), query: { limit: 2, before: page2.body.nextBefore } }, page3, db);
  assert.deepEqual(page3.body.messages.map((m) => m.id), ["c2", "c1"]);
  assert.equal(page3.body.hasMore, false);
  assert.equal(page3.body.nextBefore, null);
});

// ---- Blocking ----

test("blocked customer can still read community messages", async () => {
  const db = makeDb({ messages: [messageFixture()] });
  const res = response();
  await listCommunityMessages({ user: { id: "cus1", role: "customer", communityBlockedAt: t("2026-09-29T00:00:00Z") }, query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.messages.length, 1);
});

test("blocked customer POST is rejected with 403", async () => {
  communityPostLimiter._reset();
  const db = makeDb();
  const res = response();
  await createCommunityMessage(
    { user: { id: "cus1", role: "customer", communityBlockedAt: t("2026-09-29T00:00:00Z") }, body: { content: "Hello" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "You are blocked from posting to the community");
});

test("block is idempotent (re-blocking overwrites the timestamp safely)", async () => {
  const db = makeDb({ users: [userFixture({ communityBlockedAt: t("2026-09-01T00:00:00Z") })] });
  const first = response();
  await adminBlockUser({ params: { id: "cus1" } }, first, db);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.ok, true);
  assert.ok(first.body.user.communityBlockedAt instanceof Date);

  const second = response();
  await adminBlockUser({ params: { id: "cus1" } }, second, db);
  assert.equal(second.body.ok, true);
  assert.ok(second.body.user.communityBlockedAt instanceof Date);
});

test("unblock is idempotent (staying null is safe)", async () => {
  const db = makeDb({ users: [userFixture({ communityBlockedAt: null })] });
  const first = response();
  await adminUnblockUser({ params: { id: "cus1" } }, first, db);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.user.communityBlockedAt, null);

  const second = response();
  await adminUnblockUser({ params: { id: "cus1" } }, second, db);
  assert.equal(second.body.ok, true);
  assert.equal(second.body.user.communityBlockedAt, null);
});

test("unblock restores posting ability", async () => {
  communityPostLimiter._reset();
  const db = makeDb({ users: [userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") })] });
  const blocked = response();
  await createCommunityMessage({ user: { ...userFixture(), communityBlockedAt: t("2026-09-29T00:00:00Z") }, body: { content: "No" } }, blocked, db);
  assert.equal(blocked.statusCode, 403);

  const unblocked = response();
  await adminUnblockUser({ params: { id: "cus1" } }, unblocked, db);
  assert.equal(unblocked.body.user.communityBlockedAt, null);

  const posted = response();
  await createCommunityMessage({ user: userFixture(), body: { content: "Yes" } }, posted, db);
  assert.equal(posted.statusCode, 201);
});

test("admin cannot be blocked through the moderation endpoint", async () => {
  const db = makeDb({ users: [userFixture({ id: "adm1", name: "Admin", role: "admin" })] });
  const res = response();
  await adminBlockUser({ params: { id: "adm1" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /customers only/);
});

test("admin cannot be unblocked through the moderation endpoint", async () => {
  const db = makeDb({ users: [userFixture({ id: "adm1", name: "Admin", role: "admin" })] });
  const res = response();
  await adminUnblockUser({ params: { id: "adm1" } }, res, db);
  assert.equal(res.statusCode, 400);
});

test("moderating a nonexistent user returns 404", async () => {
  const db = makeDb();
  const block = response();
  await adminBlockUser({ params: { id: "ghost" } }, block, db);
  assert.equal(block.statusCode, 404);
  assert.equal(block.body.error, "User not found");

  const unblock = response();
  await adminUnblockUser({ params: { id: "ghost" } }, unblock, db);
  assert.equal(unblock.statusCode, 404);
});

// ---- Rate limiting ----

test("first 10 posts are allowed, the 11th in the same window is 429", async () => {
  communityPostLimiter._reset();
  const db = makeDb();
  for (let i = 0; i < 10; i += 1) {
    const res = response();
    await createCommunityMessage({ user: userFixture(), body: { content: `post ${i}` } }, res, db);
    assert.equal(res.statusCode, 201, `post ${i} should succeed`);
  }
  const eleventh = response();
  await createCommunityMessage({ user: userFixture(), body: { content: "too many" } }, eleventh, db);
  assert.equal(eleventh.statusCode, 429);
  assert.match(eleventh.body.error, /Too many requests/);
});

test("rate limit is per customer, not global", async () => {
  communityPostLimiter._reset();
  const db = makeDb();
  for (let i = 0; i < 10; i += 1) {
    const res = response();
    await createCommunityMessage({ user: userFixture(), body: { content: `cus1 ${i}` } }, res, db);
    assert.equal(res.statusCode, 201);
  }
  const cus1Again = response();
  await createCommunityMessage({ user: userFixture(), body: { content: "cus1 again" } }, cus1Again, db);
  assert.equal(cus1Again.statusCode, 429);

  const cus2 = response();
  await createCommunityMessage({ user: userFixture({ id: "cus2", name: "Bob" }), body: { content: "cus2 is separate" } }, cus2, db);
  assert.equal(cus2.statusCode, 201);
});

test("failed posts do not consume the rate limit", async () => {
  communityPostLimiter._reset();
  const db = makeDb();
  for (let i = 0; i < 10; i += 1) {
    const res = response();
    await createCommunityMessage({ user: userFixture(), body: { content: " ".repeat(i + 1) } }, res, db);
    assert.equal(res.statusCode, 400, "empty content should fail validation");
  }
  const valid = response();
  await createCommunityMessage({ user: userFixture(), body: { content: "still allowed" } }, valid, db);
  assert.equal(valid.statusCode, 201);
});

test("the community limiter key is namespaced per customer (no cross-talk keys)", () => {
  communityPostLimiter._reset();
  const key = (id) => `community:${id}`;
  for (let i = 0; i < 10; i += 1) {
    communityPostLimiter.record(key("cus1"));
  }
  assert.equal(communityPostLimiter.allow(key("cus1")), false);
  assert.equal(communityPostLimiter.allow(key("cus2")), true);
  communityPostLimiter._reset();
  assert.equal(communityPostLimiter.allow(key("cus1")), true);
});

// ---- Admin ----

test("admin can read community messages with the same safe shape", async () => {
  const db = makeDb({ messages: [messageFixture()] });
  const res = response();
  await adminListCommunityMessages({ query: {} }, res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.messages[0].customer.name, "Alice");
  assert.equal(res.body.messages[0].customer.email, undefined);
});

test("admin can block a customer (safe user shape returned)", async () => {
  const db = makeDb({ users: [userFixture()] });
  const res = response();
  await adminBlockUser({ params: { id: "cus1" } }, res, db);
  assert.equal(res.body.ok, true);
  assert.deepEqual(Object.keys(res.body.user).sort(), ["communityBlockedAt", "id", "name"]);
  assert.ok(res.body.user.communityBlockedAt instanceof Date);
});

test("admin can unblock a customer (communityBlockedAt null)", async () => {
  const db = makeDb({ users: [userFixture({ communityBlockedAt: t("2026-09-29T00:00:00Z") })] });
  const res = response();
  await adminUnblockUser({ params: { id: "cus1" } }, res, db);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.communityBlockedAt, null);
});

test("admin community user list contains only customers, keeps blocked status, and hides private fields", async () => {
  const db = makeDb({
    users: [
      userFixture({ id: "cus2", name: "Bob", communityBlockedAt: t("2026-09-29T00:00:00Z") }),
      userFixture({ id: "cus1", name: "Alice" }),
      userFixture({ id: "adm1", name: "Admin", role: "admin", communityBlockedAt: t("2026-09-28T00:00:00Z") }),
    ],
  });
  const res = response();
  await adminListCommunityUsers({}, res, db);
  assert.equal(res.body.users.length, 2);
  assert.deepEqual(res.body.users.map((u) => u.id), ["cus1", "cus2"]);
  assert.equal(res.body.users[0].communityBlockedAt, null);
  assert.equal(res.body.users[1].communityBlockedAt instanceof Date, true);

  const payload = JSON.stringify(res.body);
  for (const forbidden of ["email", "phone", "address", "password", "role", "status", "lastActiveAt", "secret"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `admin user list must not contain ${forbidden}`);
  }
});

// ---- Isolation ----

test("community code never touches the existing Message model or controller", async () => {
  const db = makeDb({ users: [userFixture()] });

  const blocked = response();
  await createCommunityMessage({ user: userFixture(), body: { content: "hello" } }, blocked, db);
  assert.equal(blocked.statusCode, 201);

  const read = response();
  await adminListCommunityMessages({ query: {} }, read, db);
  assert.equal(read.body.messages.length, 1);

  const mod = response();
  await adminBlockUser({ params: { id: "cus1" } }, mod, db);
  assert.equal(mod.body.ok, true);
});

test("existing messages controller has no community references", () => {
  const src = readFileSync(new URL("../src/controllers/messages.js", import.meta.url), "utf8");
  assert.ok(!src.toLowerCase().includes("community"));
});