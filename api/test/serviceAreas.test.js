import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin } from "../src/middleware/auth.js";
import {
  listPublicServiceAreas,
  adminListServiceAreas,
  adminCreateServiceArea,
  adminUpdateServiceArea,
  adminDeleteServiceArea,
} from "../src/controllers/serviceAreas.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const areaFixture = (overrides = {}) => ({
  id: "seed-area-anoka",
  name: "Anoka",
  city: "Anoka",
  state: "MN",
  postalCode: "55303",
  description: "Proudly serving Anoka, MN 55303 and surrounding communities. Coverage can vary by location.",
  order: 0,
  isActive: true,
  createdAt: new Date("2026-09-16T00:00:00Z"),
  updatedAt: new Date("2026-09-16T00:00:00Z"),
  ...overrides,
});

// In-memory fake of prisma.serviceArea with real P2002/P2025 semantics, and
// (order, name) sorting mirroring the public controller's orderBy.
const makeDb = (areas = []) => {
  const rows = areas.map((a) => ({ ...a }));
  let seq = rows.length;
  return {
    serviceArea: {
      findMany: async ({ where = {}, orderBy } = {}) => {
        const out = rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
        if (orderBy) {
          out.sort((a, b) => {
            for (const o of orderBy) {
              const key = Object.keys(o)[0];
              const dir = o[key];
              if (a[key] !== b[key]) return a[key] < b[key] ? (dir === "asc" ? -1 : 1) : dir === "asc" ? 1 : -1;
            }
            return 0;
          });
        }
        return out;
      },
      findUnique: async ({ where } = {}) => rows.find((r) => r.id === where.id) ?? null,
      create: async ({ data }) => {
        if (rows.some((r) => r.name === data.name)) throw P2002();
        const a = { id: `sa${++seq}`, createdAt: new Date("2026-09-16T00:00:00Z"), updatedAt: new Date("2026-09-16T00:00:00Z"), ...data };
        rows.push(a);
        return { ...a };
      },
      update: async ({ where, data }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        if (data.name !== undefined && rows.some((r) => r.id !== where.id && r.name === data.name)) throw P2002();
        rows[i] = { ...rows[i], ...data, updatedAt: new Date("2026-09-16T12:00:00Z") };
        return { ...rows[i] };
      },
      delete: async ({ where }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        return rows.splice(i, 1)[0];
      },
    },
  };
};

const P2002 = () => { const e = new Error("Unique constraint failed"); e.code = "P2002"; return e; };
const P2025 = () => { const e = new Error("Record not found"); e.code = "P2025"; return e; };

const validAreaBody = () => ({
  name: "  Andover  ",
  city: "Andover",
  state: "mn",
  postalCode: "55303",
  description: "Proudly serving Anoka.",
  order: 0,
  isActive: true,
});

test("public GET returns only active areas, ordered by order then name", async () => {
  const inactive = areaFixture({ id: "z", name: "Zebra", order: 0, isActive: false });
  const zebra = areaFixture({ id: "zb", name: "Zebra", order: 1 });
  const alpha = areaFixture({ id: "al", name: "Blaine", order: 1 });
  const anoka = areaFixture({ id: "a1", name: "Anoka", order: 1 });
  const low = areaFixture({ id: "lo", name: "Andover", order: 0 });
  const db = makeDb([inactive, zebra, alpha, anoka, low]);
  const res = response();
  await listPublicServiceAreas({}, res, db);
  assert.equal(res.body.areas.some((a) => !a.isActive), false);
  assert.deepEqual(res.body.areas.map((a) => a.name), ["Andover", "Anoka", "Blaine", "Zebra"]);
});

test("public GET returns an empty list when no active areas exist", async () => {
  const db = makeDb([areaFixture({ isActive: false })]);
  const res = response();
  await listPublicServiceAreas({}, res, db);
  assert.deepEqual(res.body.areas, []);
});

test("admin GET returns all areas including inactive, deterministically ordered", async () => {
  const inactive = areaFixture({ id: "z", name: "Zephyr", order: 5, isActive: false });
  const active = areaFixture({ id: "a", name: "Andover", order: 0 });
  const db = makeDb([inactive, active]);
  const res = response();
  await adminListServiceAreas({}, res, db);
  assert.deepEqual(res.body.areas.map((a) => a.name), ["Andover", "Zephyr"]);
  assert.equal(res.body.areas.some((a) => !a.isActive), true);
});

test("admin can create an area (201, normalized) and rejects duplicates and invalid payloads", async () => {
  const db = makeDb([areaFixture()]);
  const res = response();
  await adminCreateServiceArea({ body: validAreaBody() }, res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.area.name, "Andover");
  assert.equal(res.body.area.state, "MN");
  assert.equal(res.body.area.isActive, true);
  assert.equal(res.body.area.order, 0);

  const dup = response();
  await adminCreateServiceArea({ body: { name: "Anoka", city: "Anoka", state: "MN" } }, dup, db);
  assert.equal(dup.statusCode, 400);
  assert.match(dup.body.error, /already exists/);

  const noName = response();
  await adminCreateServiceArea({ body: { city: "Anoka", state: "MN" } }, noName, db);
  assert.equal(noName.statusCode, 400);
  assert.match(noName.body.error, /name/);

  const badState = response();
  await adminCreateServiceArea({ body: { name: "X", city: "Y", state: "M" } }, badState, db);
  assert.equal(badState.statusCode, 400);

  const badPostal = response();
  await adminCreateServiceArea({ body: { name: "X", city: "Y", state: "MN", postalCode: "55" } }, badPostal, db);
  assert.equal(badPostal.statusCode, 400);

  const badOrder = response();
  await adminCreateServiceArea({ body: { name: "X", city: "Y", state: "MN", order: -1 } }, badOrder, db);
  assert.equal(badOrder.statusCode, 400);

  const badIsActive = response();
  await adminCreateServiceArea({ body: { name: "X", city: "Y", state: "MN", isActive: "yes" } }, badIsActive, db);
  assert.equal(badIsActive.statusCode, 400);
});

test("admin can update an area (trimmed, uppercased state) and rejects not-found, colliding, empty, invalid", async () => {
  const db = makeDb([areaFixture(), areaFixture({ id: "s2", name: "Andover" })]);
  const res = response();
  await adminUpdateServiceArea(
    { params: { id: "seed-area-anoka" }, body: { name: "  Anoka MN  ", state: "mn", order: 2, isActive: false, postalCode: "" } },
    res,
    db,
  );
  assert.equal(res.body.area.name, "Anoka MN");
  assert.equal(res.body.area.state, "MN");
  assert.equal(res.body.area.order, 2);
  assert.equal(res.body.area.isActive, false);
  assert.equal(res.body.area.postalCode, null);

  const missing = response();
  await adminUpdateServiceArea({ params: { id: "nope" }, body: { name: "x" } }, missing, db);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, "Service area not found");

  const colliding = response();
  await adminUpdateServiceArea({ params: { id: "seed-area-anoka" }, body: { name: "Andover" } }, colliding, db);
  assert.equal(colliding.statusCode, 400);
  assert.match(colliding.body.error, /already exists/);

  const empty = response();
  await adminUpdateServiceArea({ params: { id: "seed-area-anoka" }, body: {} }, empty, db);
  assert.equal(empty.statusCode, 400);

  const invalid = response();
  await adminUpdateServiceArea({ params: { id: "seed-area-anoka" }, body: { order: "two" } }, invalid, db);
  assert.equal(invalid.statusCode, 400);
});

test("admin can delete an area and rejects missing records with 404", async () => {
  const db = makeDb([areaFixture()]);
  const res = response();
  await adminDeleteServiceArea({ params: { id: "seed-area-anoka" } }, res, db);
  assert.deepEqual(res.body, { ok: true });

  const missing = response();
  await adminDeleteServiceArea({ params: { id: "nope" } }, missing, db);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, "Service area not found");
});

test("public service areas route is registered without any auth middleware", () => {
  const route = findRoute("/service-areas", "get");
  assert.ok(route, "GET /service-areas route should be registered");
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles.length, 1);
  assert.equal(handles[0], listPublicServiceAreas);
});

test("admin service area routes are registered behind authenticate + requireAdmin", () => {
  const routes = [
    ["/admin/service-areas", "get", adminListServiceAreas],
    ["/admin/service-areas", "post", adminCreateServiceArea],
    ["/admin/service-areas/:id", "put", adminUpdateServiceArea],
    ["/admin/service-areas/:id", "delete", adminDeleteServiceArea],
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

function findRoute(path, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      if (!method || layer.route.methods[method]) return layer.route;
    }
  }
  return null;
}