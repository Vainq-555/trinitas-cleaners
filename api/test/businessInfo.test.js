import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin } from "../src/middleware/auth.js";
import { BUSINESS_INFO_ID } from "../src/utils/validators.js";
import {
  getBusinessInfo,
  adminGetBusinessInfo,
  adminPutBusinessInfo,
} from "../src/controllers/businessInfo.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const businessFixture = (overrides = {}) => ({
  id: BUSINESS_INFO_ID,
  businessName: "Trinitas-Cleaners",
  phone: "1 763-620-4955",
  email: "trinitascleaner@gmail.com",
  addressLine1: null,
  city: "Anoka",
  state: "MN",
  postalCode: "55303",
  hoursWeek: "Monday \u2013 Saturday \u00b7 8:00 AM \u2013 6:00 PM",
  hoursWeekend: "Sunday \u00b7 Closed",
  responseTime: "Replies within one business day",
  createdAt: new Date("2026-09-16T00:00:00Z"),
  updatedAt: new Date("2026-09-16T00:00:00Z"),
  ...overrides,
});

// In-memory fake of prisma.businessInfo supporting findUnique + upsert against
// the singleton. When initialRow is null the singleton is treated as missing.
const makeDb = ({ business = null } = {}) => {
  let row = business ? { ...business } : null;
  return {
    businessInfo: {
      findUnique: async ({ where } = {}) => (row && row.id === where.id ? { ...row } : null),
      upsert: async ({ where, update, create }) => {
        if (row && row.id === where.id) row = { ...row, ...update, updatedAt: new Date("2026-09-16T12:00:00Z") };
        else row = { ...create, createdAt: new Date("2026-09-16T00:00:00Z"), updatedAt: new Date("2026-09-16T00:00:00Z") };
        return { ...row };
      },
    },
  };
};

const validBody = () => ({
  businessName: "  Trinitas-Cleaners  ",
  phone: "1 763-620-4955",
  email: "trinitascleaner@gmail.com",
  addressLine1: null,
  city: "Anoka",
  state: "mn",
  postalCode: "55303",
  hoursWeek: "Monday \u2013 Saturday \u00b7 8:00 AM \u2013 6:00 PM",
  hoursWeekend: "Sunday \u00b7 Closed",
  responseTime: "Replies within one business day",
});

test("business info singleton id is the canonical business-info", () => {
  assert.equal(BUSINESS_INFO_ID, "business-info");
});

test("public GET returns the singleton under { business }", async () => {
  const db = makeDb({ business: businessFixture() });
  const res = response();
  await getBusinessInfo({}, res, db);
  assert.equal(res.body.business.id, "business-info");
  assert.equal(res.body.business.businessName, "Trinitas-Cleaners");
  assert.equal(res.body.business.phone, "1 763-620-4955");
});

test("public GET returns { business: null } when the singleton is unset", async () => {
  const res = response();
  await getBusinessInfo({}, res, makeDb());
  assert.deepEqual(res.body, { business: null });
});

test("admin GET returns the singleton under { business }", async () => {
  const db = makeDb({ business: businessFixture() });
  const res = response();
  await adminGetBusinessInfo({}, res, db);
  assert.equal(res.body.business.id, "business-info");
});

test("admin GET returns { business: null } before first save", async () => {
  const res = response();
  await adminGetBusinessInfo({}, res, makeDb());
  assert.deepEqual(res.body, { business: null });
});

test("admin PUT creates the singleton when missing (upsert with canonical id)", async () => {
  const db = makeDb();
  const res = response();
  await adminPutBusinessInfo({ body: validBody() }, res, db);
  assert.equal(res.body.business.id, "business-info");
  assert.equal(res.body.business.state, "MN");
  assert.equal(res.body.business.businessName, "Trinitas-Cleaners");
  assert.equal(res.body.business.addressLine1, null);
});

test("admin PUT updates the existing singleton (upsert, not duplicate)", async () => {
  const db = makeDb({ business: businessFixture() });
  const res = response();
  await adminPutBusinessInfo(
    { body: { ...validBody(), businessName: "  Updated Name  ", phone: "(763) 555-0100", email: "new@trinitascleaners.com" } },
    res,
    db,
  );
  assert.equal(res.body.business.businessName, "Updated Name");
  assert.equal(res.body.business.phone, "(763) 555-0100");
  assert.equal(res.body.business.email, "new@trinitascleaners.com");
});

test("admin PUT trims supplied address lines and stores empty optional as null", async () => {
  const db = makeDb();
  const res = response();
  await adminPutBusinessInfo({ body: { ...validBody(), addressLine1: "  123 Main St  " } }, res, db);
  assert.equal(res.body.business.addressLine1, "123 Main St");

  const empty = response();
  await adminPutBusinessInfo({ body: { ...validBody(), addressLine1: "" } }, empty, db);
  assert.equal(empty.body.business.addressLine1, null);
});

test("admin PUT rejects validation failures with the 400 badRequest format", async () => {
  const cases = [
    { body: { ...validBody(), businessName: "" }, expect: /businessName/ },
    { body: { ...validBody(), businessName: "  " }, expect: /businessName/ },
    { body: { ...validBody(), phone: "abc" }, expect: /phone/ },
    { body: { ...validBody(), phone: "555" }, expect: /phone/ },
    { body: { ...validBody(), email: "not-an-email" }, expect: /email/ },
    { body: { ...validBody(), city: "" }, expect: /city/ },
    { body: { ...validBody(), state: "M" }, expect: /state/ },
    { body: { ...validBody(), state: "MNN" }, expect: /state/ },
    { body: { ...validBody(), state: "123" }, expect: /state/ },
    { body: { ...validBody(), postalCode: "5530" }, expect: /postalCode/ },
    { body: { ...validBody(), postalCode: "abcde" }, expect: /postalCode/ },
    { body: { ...validBody(), hoursWeek: "" }, expect: /hoursWeek/ },
    { body: { ...validBody(), hoursWeekend: "" }, expect: /hoursWeekend/ },
    { body: { ...validBody(), responseTime: "   " }, expect: /responseTime/ },
    { body: { ...validBody(), addressLine1: "x".repeat(201) }, expect: /addressLine1/ },
    { body: {}, expect: /businessName/ },
  ];
  for (const { body, expect } of cases) {
    const res = response();
    await adminPutBusinessInfo({ body }, res, makeDb());
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.ok(expect.test(res.body.error), `${JSON.stringify(body)} -> ${res.body.error}`);
  }
});

test("public business info route is registered without any auth middleware", () => {
  const route = findRoute("/business-information", "get");
  assert.ok(route, "GET /business-information route should be registered");
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles.length, 1);
  assert.equal(handles[0], getBusinessInfo);
});

test("admin business info routes are registered behind authenticate + requireAdmin", () => {
  const routes = [
    ["/admin/business-information", "get", adminGetBusinessInfo],
    ["/admin/business-information", "put", adminPutBusinessInfo],
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