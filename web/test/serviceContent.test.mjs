import test from "node:test";
import assert from "node:assert/strict";
import { activeSections, filterSectionsForService } from "../lib/serviceContent.mjs";

const step = (overrides = {}) => ({
  id: "s",
  serviceId: null,
  sectionKey: "k",
  title: "T",
  body: "B",
  order: 1,
  isActive: true,
  ...overrides,
});

test("activeSections drops inactive and non-object rows", () => {
  const rows = [step(), step({ id: "off", isActive: false }), null, "junk", step({ id: "ok2", isActive: true })];
  const out = activeSections(rows);
  assert.equal(out.length, 2);
  assert.ok(out.every((s) => s.isActive === true));
});

test("activeSections returns [] for non-array input", () => {
  assert.deepEqual(activeSections(undefined), []);
  assert.deepEqual(activeSections(null), []);
  assert.deepEqual(activeSections({}), []);
});

test("filterSectionsForService keeps only the requested service's active rows", () => {
  const rows = [
    step({ id: "global", serviceId: null }),
    step({ id: "a1", serviceId: "svcA" }),
    step({ id: "a2", serviceId: "svcA", isActive: false }),
    step({ id: "b1", serviceId: "svcB" }),
  ];
  const out = filterSectionsForService(rows, "svcA");
  assert.deepEqual(out.map((s) => s.id), ["a1"]);
});

test("filterSectionsForService never returns global or other-service rows", () => {
  const rows = [step({ id: "global", serviceId: null }), step({ id: "b1", serviceId: "svcB" })];
  const out = filterSectionsForService(rows, "svcA");
  assert.deepEqual(out, []);
});

test("filterSectionsForService tolerates missing payloads", () => {
  assert.deepEqual(filterSectionsForService(undefined, "svcA"), []);
  assert.deepEqual(filterSectionsForService(null, "svcA"), []);
});