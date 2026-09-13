import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin } from "../src/middleware/auth.js";
import { CONTENT_PAGES } from "../src/utils/validators.js";
import {
  listPublicContent,
  adminListContent,
  adminCreateContent,
  adminUpdateContent,
  adminDeleteContent,
} from "../src/controllers/content.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const P2025 = () => { const e = new Error("Record not found"); e.code = "P2025"; return e; };
const P2002 = () => { const e = new Error("Unique constraint failed"); e.code = "P2002"; return e; };

const sectionFixture = (overrides = {}) => ({
  id: "s1",
  page: "how-it-works",
  serviceId: null,
  sectionKey: "create-account",
  title: "Step 1 — Create an account",
  body: "Create a free account.",
  order: 10,
  isActive: true,
  createdAt: new Date("2026-09-13T00:00:00Z"),
  updatedAt: new Date("2026-09-13T00:00:00Z"),
  ...overrides,
});

const serviceFixture = (overrides = {}) => ({
  id: "svc",
  name: "Window Cleaning",
  description: "Streak-free windows.",
  basePrice: 75,
  isActive: true,
  ...overrides,
});

// In-memory fake of prisma.contentSection (+ a service findUnique for scope
// validation) with real P2002/P2025 semantics and a serviceId-scoped
// uniqueness model mirroring the (page, serviceId, sectionKey) composite plus
// the global partial unique index. handler orderBy approximates the
// controller's sort.
const makeDb = (initial = [], services = []) => {
  const rows = initial.map((r) => ({ ...r }));
  let seq = rows.length;
  return {
    contentSection: {
      findMany: async ({ where = {}, orderBy } = {}) => {
        const filtered = rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
        if (orderBy) {
          const keys = orderBy.map((o) => Object.keys(o)[0]);
          filtered.sort((a, b) => { for (const k of keys) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1; return 0; });
        }
        return filtered;
      },
      findUnique: async ({ where }) => {
        if (where.id) return rows.find((r) => r.id === where.id) ?? null;
        return null;
      },
      findFirst: async ({ where = {} } = {}) => {
        return rows.find((r) => {
          for (const [k, v] of Object.entries(where)) {
            if (k === "NOT") continue;
            if (r[k] !== v) return false;
          }
          return true;
        }) ?? null;
      },
      create: async ({ data }) => {
        if (rows.some((r) => r.page === data.page && r.serviceId === data.serviceId && r.sectionKey === data.sectionKey)) throw P2002();
        const s = { id: `c${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(s);
        return s;
      },
      update: async ({ where, data }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        const target = rows[i];
        if (rows.some((r) => r.id !== where.id && r.page === target.page && r.serviceId === target.serviceId && r.sectionKey === data.sectionKey)) throw P2002();
        rows[i] = { ...rows[i], ...data, updatedAt: new Date() };
        return rows[i];
      },
      delete: async ({ where }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        return rows.splice(i, 1)[0];
      },
    },
    service: {
      findUnique: async ({ where }) => services.find((s) => s.id === where.id) ?? null,
    },
  };
};

test("content page whitelist is limited to how-it-works for this checkpoint", () => {
  assert.deepEqual(CONTENT_PAGES, ["how-it-works"]);
});

test("public endpoint returns only active sections ordered by order then sectionKey", async () => {
  const inactive = sectionFixture({ id: "z", sectionKey: "zzz", order: 1, isActive: false });
  const a = sectionFixture({ id: "a", sectionKey: "alpha", order: 20 });
  const b = sectionFixture({ id: "b", sectionKey: "beta", order: 10 });
  const res = response();
  await listPublicContent({ params: { page: "how-it-works" } }, res, makeDb([inactive, a, b]));
  assert.equal(res.body.sections.some((s) => !s.isActive), false);
  assert.deepEqual(res.body.sections.map((s) => s.sectionKey), ["beta", "alpha"]);
});

test("public endpoint returns empty sections for a valid page with no content", async () => {
  const res = response();
  await listPublicContent({ params: { page: "how-it-works" } }, res, makeDb());
  assert.deepEqual(res.body.sections, []);
});

test("public endpoint rejects an unknown page slug with 404", async () => {
  const res = response();
  await listPublicContent({ params: { page: "not-a-page" } }, res, makeDb());
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Page not found");
});

test("public content route is registered without any auth middleware", () => {
  const route = findRoute("/content/:page", "get");
  assert.ok(route, "GET /content/:page route should be registered");
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles.length, 1);
  assert.equal(handles[0], listPublicContent);
});

test("admin content routes are registered behind authenticate + requireAdmin", () => {
  const routes = [
    ["/admin/content/:page", "get", adminListContent],
    ["/admin/content/:page", "post", adminCreateContent],
    ["/admin/content/:page/:id", "put", adminUpdateContent],
    ["/admin/content/:page/:id", "delete", adminDeleteContent],
  ];
  for (const [path, method, handler] of routes) {
    const route = findRoute(path, method);
    assert.ok(route, `${method.toUpperCase()} ${path} should be registered`);
    const handles = route.stack.map((layer) => layer.handle);
    assert.equal(handles[0], authenticate);
    assert.equal(handles[1], requireAdmin);
    assert.equal(handles[2], handler);
  }
});

test("requireAdmin blocks customers and unauthenticated requests", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
  const anon = response();
  await requireAdmin({}, anon, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(anon.statusCode, 401);
});

test("admin list returns all page sections (including inactive), deterministically ordered", async () => {
  const db = makeDb([
    sectionFixture({ id: "z", sectionKey: "zeta", order: 1, isActive: false }),
    sectionFixture({ id: "a", sectionKey: "alpha", order: 0 }),
  ]);
  const res = response();
  await adminListContent({ params: { page: "how-it-works" } }, res, db);
  assert.deepEqual(res.body.sections.map((s) => s.sectionKey), ["alpha", "zeta"]);
  assert.equal(res.body.sections.some((s) => !s.isActive), true);
});

test("admin can create a section (201, trimmed) and rejects duplicates and invalid payloads", async () => {
  const db = makeDb([sectionFixture()]);
  const res = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "  payment  ", title: "  Pay  ", body: "  secure checkout  ", order: 2 } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.section.sectionKey, "payment");
  assert.equal(res.body.section.title, "Pay");
  assert.equal(res.body.section.body, "secure checkout");
  assert.equal(res.body.section.order, 2);
  assert.equal(res.body.section.isActive, true);

  const dup = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "create-account", title: "t", body: "b" } },
    dup,
    db,
  );
  assert.equal(dup.statusCode, 400);
  assert.match(dup.body.error, /already exists/);

  const badOrder = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "x", title: "t", body: "b", order: -1 } },
    badOrder,
    db,
  );
  assert.equal(badOrder.statusCode, 400);

  const noBody = response();
  await adminCreateContent({ params: { page: "how-it-works" }, body: { sectionKey: "x", title: "t" } }, noBody, db);
  assert.equal(noBody.statusCode, 400);

  const badPage = response();
  await adminCreateContent({ params: { page: "other" }, body: { sectionKey: "x", title: "t", body: "b" } }, badPage, db);
  assert.equal(badPage.statusCode, 400);

  const badType = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "x", title: "t", body: "b", isActive: "yes" } },
    badType,
    db,
  );
  assert.equal(badType.statusCode, 400);
});

test("admin can update a section and rejects not-found, colliding, empty, and invalid updates", async () => {
  const db = makeDb([sectionFixture(), sectionFixture({ id: "s2", sectionKey: "payment", order: 20 })]);
  const res = response();
  await adminUpdateContent(
    { params: { page: "how-it-works", id: "s1" }, body: { title: "  Updated title  ", order: 5, isActive: false } },
    res,
    db,
  );
  assert.equal(res.body.section.title, "Updated title");
  assert.equal(res.body.section.order, 5);
  assert.equal(res.body.section.isActive, false);

  const missing = response();
  await adminUpdateContent({ params: { page: "how-it-works", id: "nope" }, body: { title: "x" } }, missing, db);
  assert.equal(missing.statusCode, 404);

  const colliding = response();
  await adminUpdateContent({ params: { page: "how-it-works", id: "s1" }, body: { sectionKey: "payment" } }, colliding, db);
  assert.equal(colliding.statusCode, 400);
  assert.match(colliding.body.error, /already exists/);

  const empty = response();
  await adminUpdateContent({ params: { page: "how-it-works", id: "s1" }, body: {} }, empty, db);
  assert.equal(empty.statusCode, 400);

  const badOrder = response();
  await adminUpdateContent({ params: { page: "how-it-works", id: "s1" }, body: { order: -2 } }, badOrder, db);
  assert.equal(badOrder.statusCode, 400);

  const wrongPage = response();
  await adminUpdateContent({ params: { page: "other", id: "s1" }, body: { title: "x" } }, wrongPage, db);
  assert.equal(wrongPage.statusCode, 400);
});

test("admin delete removes the section and 404s on missing or wrong-page sections", async () => {
  const db = makeDb([sectionFixture(), sectionFixture({ id: "spy", page: "another", sectionKey: "x" })]);
  const ok = response();
  await adminDeleteContent({ params: { page: "how-it-works", id: "s1" } }, ok, db);
  assert.deepEqual(ok.body, { ok: true });

  const missing = response();
  await adminDeleteContent({ params: { page: "how-it-works", id: "ghost" } }, missing, db);
  assert.equal(missing.statusCode, 404);

  const wrongPage = response();
  await adminDeleteContent({ params: { page: "how-it-works", id: "spy" } }, wrongPage, db);
  assert.equal(wrongPage.statusCode, 404);
});

test("content responses expose no credential-like fields", async () => {
  const db = makeDb([sectionFixture()]);
  const master = response();
  await adminListContent({ params: { page: "how-it-works" } }, master, db);
  const payload = JSON.stringify(master.body);
  for (const forbidden of ["secret", "token", "password", "DATABASE_URL", "STRIPE", "JWT", "credential"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `response must not contain ${forbidden}`);
  }
});

// ---- service-specific scope: shared fixtures ----

const svcA = serviceFixture({ id: "svcA", name: "Window Cleaning" });
const svcB = serviceFixture({ id: "svcB", name: "Screen Cleaning" });
const globalStep = sectionFixture({ id: "global", sectionKey: "create-account" });
const aStep = sectionFixture({ id: "a1", serviceId: "svcA", sectionKey: "request" });
const bStep = sectionFixture({ id: "b1", serviceId: "svcB", sectionKey: "request" });

test("service-scoped create stores the correct serviceId and global create keeps null", async () => {
  const services = [svcA];
  let db = makeDb([], services);
  const sres = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "payment", title: "Pay", body: "checkout", serviceId: "svcA" } },
    sres,
    db,
  );
  assert.equal(sres.statusCode, 201);
  assert.equal(sres.body.section.serviceId, "svcA");

  db = makeDb([], services);
  const gres = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "payment", title: "Pay", body: "checkout" } },
    gres,
    db,
  );
  assert.equal(gres.statusCode, 201);
  assert.equal(gres.body.section.serviceId, null);
});

test("invalid or unknown serviceId is rejected with 400", async () => {
  const db = makeDb([], [svcA]);
  const missing = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "x", title: "t", body: "b", serviceId: "not-a-service" } },
    missing,
    db,
  );
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.error, "Service not found");

  const badType = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "x", title: "t", body: "b", serviceId: 42 } },
    badType,
    db,
  );
  assert.equal(badType.statusCode, 400);
});

test("public global query returns only global (serviceId null) rows", async () => {
  const db = makeDb([globalStep, aStep, bStep]);
  const res = response();
  await listPublicContent({ params: { page: "how-it-works" } }, res, db);
  assert.deepEqual(res.body.sections.map((s) => s.id), ["global"]);
});

test("public service query returns only that service's active rows", async () => {
  const db = makeDb([globalStep, aStep, bStep]);
  const res = response();
  await listPublicContent({ params: { page: "how-it-works" }, query: { serviceId: "svcA" } }, res, db);
  assert.deepEqual(res.body.sections.map((s) => s.id), ["a1"]);
});

test("Service A cannot see Service B content and vice versa", async () => {
  const db = makeDb([aStep, bStep]);
  const a = response();
  await listPublicContent({ params: { page: "how-it-works" }, query: { serviceId: "svcA" } }, a, db);
  assert.deepEqual(a.body.sections.map((s) => s.id), ["a1"]);
  const b = response();
  await listPublicContent({ params: { page: "how-it-works" }, query: { serviceId: "svcB" } }, b, db);
  assert.deepEqual(b.body.sections.map((s) => s.id), ["b1"]);
});

test("service content never appears in the global query", async () => {
  const db = makeDb([globalStep, aStep, bStep]);
  const res = response();
  await listPublicContent({ params: { page: "how-it-works" } }, res, db);
  assert.equal(res.body.sections.some((s) => s.serviceId !== null), false);
});

test("inactive service-specific sections are excluded from the public service query", async () => {
  const inactiveA = sectionFixture({ id: "a2", serviceId: "svcA", sectionKey: "payment", isActive: false });
  const db = makeDb([aStep, inactiveA]);
  const res = response();
  await listPublicContent({ params: { page: "how-it-works" }, query: { serviceId: "svcA" } }, res, db);
  assert.deepEqual(res.body.sections.map((s) => s.id), ["a1"]);
});

test("same sectionKey can exist for different services but not twice in one service", async () => {
  const db = makeDb([], [svcA, svcB]);
  const a = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "request", title: "Request", body: "book", serviceId: "svcA" } },
    a,
    db,
  );
  assert.equal(a.statusCode, 201);
  const b = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "request", title: "Request", body: "book", serviceId: "svcB" } },
    b,
    db,
  );
  assert.equal(b.statusCode, 201);

  const dup = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "request", title: "Request", body: "book", serviceId: "svcA" } },
    dup,
    db,
  );
  assert.equal(dup.statusCode, 400);
  assert.match(dup.body.error, /already exists/);
});

test("same global sectionKey cannot be duplicated globally", async () => {
  const db = makeDb([globalStep]);
  const dup = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "create-account", title: "t", body: "b" } },
    dup,
    db,
  );
  assert.equal(dup.statusCode, 400);
  assert.match(dup.body.error, /already exists/);
});

test("a global and a service-specific section may share a sectionKey", async () => {
  const db = makeDb([globalStep], [svcA]);
  const res = response();
  await adminCreateContent(
    { params: { page: "how-it-works" }, body: { sectionKey: "create-account", title: "t", body: "b", serviceId: "svcA" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
});

test("admin list is scope-aware: global query returns only global, service query only that service", async () => {
  const db = makeDb([globalStep, aStep, bStep]);
  const g = response();
  await adminListContent({ params: { page: "how-it-works" } }, g, db);
  assert.deepEqual(g.body.sections.map((s) => s.id), ["global"]);
  const a = response();
  await adminListContent({ params: { page: "how-it-works" }, query: { serviceId: "svcA" } }, a, db);
  assert.deepEqual(a.body.sections.map((s) => s.id), ["a1"]);
});

test("update duplicate detection is service-scoped and excludes the current row", async () => {
  const db = makeDb(
    [
      sectionFixture({ id: "a1", serviceId: "svcA", sectionKey: "request" }),
      sectionFixture({ id: "a2", serviceId: "svcA", sectionKey: "payment" }),
      sectionFixture({ id: "b1", serviceId: "svcB", sectionKey: "book" }),
    ],
    [svcA, svcB],
  );

  // Own-key update is allowed: the current row is excluded from the check.
  const ownKey = response();
  await adminUpdateContent({ params: { page: "how-it-works", id: "a1" }, body: { sectionKey: "request", title: "Tweaked" } }, ownKey, db);
  assert.equal(ownKey.body.section.sectionKey, "request");
  assert.equal(ownKey.body.section.title, "Tweaked");
  assert.equal(ownKey.body.section.serviceId, "svcA");

  // Same sectionKey in the SAME service collides.
  const colliding = response();
  await adminUpdateContent({ params: { page: "how-it-works", id: "a1" }, body: { sectionKey: "payment" } }, colliding, db);
  assert.equal(colliding.statusCode, 400);
  assert.match(colliding.body.error, /already exists/);

  // Same sectionKey in a DIFFERENT service is allowed.
  const otherService = response();
  await adminUpdateContent({ params: { page: "how-it-works", id: "b1" }, body: { sectionKey: "payment" } }, otherService, db);
  assert.equal(otherService.body.section.sectionKey, "payment");
  assert.equal(otherService.body.section.serviceId, "svcB");
});

test("serviceId cannot be changed through PUT", async () => {
  const db = makeDb([sectionFixture({ id: "a1", serviceId: "svcA", sectionKey: "request" })], [svcA, svcB]);
  const res = response();
  await adminUpdateContent({ params: { page: "how-it-works", id: "a1" }, body: { serviceId: "svcB" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Scope cannot be changed/);
});

function findRoute(path, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      if (!method || layer.route.methods[method]) return layer.route;
    }
  }
  return null;
}