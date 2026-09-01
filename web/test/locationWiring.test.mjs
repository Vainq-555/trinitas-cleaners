import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useMyLocation, isCompleteAddress } from "../lib/geo.mjs";
import { api } from "../lib/api.js";

// Phase 5 — Regression: production location autofill must be wired to the
// existing api() client via fetchImpl. This fails if either production page
// reverts to `useMyLocation({ geolocation })` without fetchImpl.

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ---- Static wiring regression (guards the two production call sites) ----

test("both production booking forms wire useMyLocation to the existing api() client", () => {
  for (const rel of ["../app/dashboard/services/page.jsx", "../app/dashboard/bookings/page.jsx"]) {
    const page = source(rel);
    const call = page.match(/useMyLocation\(\{[^}]*\}\)/)?.[0] || "";
    assert.match(page, /useMyLocation/, rel);
    // The call must pass fetchImpl and wire it to the imported api() client.
    assert.match(call, /useMyLocation\(\{/, rel);
    assert.match(call, /fetchImpl:\s*\(path\)\s*=>\s*api\(path\)/, `${rel}: call site must pass fetchImpl: (path) => api(path)`);
    // And it must still request geolocation (no fetchImpl-only regression).
    assert.match(call, /geolocation/, rel);
  }
});

test("the wired useMyLocation call does not bypass the shared api() client", () => {
  // Guard against a future refactor that introduces a bespoke fetch or exposes
  // a raw backend URL in the browser.
  for (const rel of ["../app/dashboard/services/page.jsx", "../app/dashboard/bookings/page.jsx"]) {
    const page = source(rel);
    const call = page.match(/useMyLocation\(\{[^}]*\}\)/)?.[0] || "";
    assert.doesNotMatch(call, /fetch\(/, rel);
    assert.doesNotMatch(call, /https?:\/\//, rel);
    assert.doesNotMatch(call, /apiKey|secret|nominatim/i, rel);
  }
});

// ---- Behavioral end-to-end wiring regression (real api() + stubbed fetch) ----

const GEO = { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" };
const geolocation = (coords, err) => ({
  getCurrentPosition(success, fail) {
    if (err) fail(err);
    else success({ coords: { latitude: coords.lat, longitude: coords.lon } });
  },
});

// Replicates what lib/api.js sees over the network: a fetch Response object.
const okResponse = (payload) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(payload),
});

test("wired flow reaches /api/geocode/reverse?lat=..&lon=.. via the real api() client and fills the address", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = null;
  let seenCredentials = null;

  globalThis.fetch = async (input, opts = {}) => {
    seenUrl = input;
    seenCredentials = opts.credentials;
    return okResponse({ ok: true, address: GEO });
  };

  try {
    // EXACT production wiring: useMyLocation({ geolocation, fetchImpl: (path) => api(path) })
    const res = await useMyLocation({
      geolocation: geolocation({ lat: 45.1976, lon: -93.3871 }),
      fetchImpl: (path) => api(path),
    });

    assert.equal(res.ok, true);
    assert.equal(res.code, "OK");
    assert.deepEqual(res.address, GEO);
    assert.equal(res.address.line1, "1 Main St");
    assert.equal(res.address.city, "Anoka");
    assert.equal(res.address.state, "MN");
    assert.equal(res.address.postalCode, "55303");
    assert.equal(res.address.country, "US");
    assert.equal(isCompleteAddress(res.address), true);

    // The actual request path produced by the api() abstraction:
    // BASE = "/api" + "/geocode/reverse?lat=45.1976&lon=-93.3871".
    assert.equal(seenUrl, "/api/geocode/reverse?lat=45.1976&lon=-93.3871");
    assert.equal(seenCredentials, "same-origin");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wired flow surfaces a partial geocode response (incomplete) for editing, no submit", async () => {
  const originalFetch = globalThis.fetch;
  const partial = { line1: "Lake Rd", city: "", state: "MN", postalCode: "55011", country: "US" };
  globalThis.fetch = async () => okResponse({ ok: true, address: partial });

  try {
    const res = await useMyLocation({
      geolocation: geolocation({ lat: 1, lon: 2 }),
      fetchImpl: (path) => api(path),
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "INCOMPLETE");
    assert.equal(res.address.line1, "Lake Rd");
    assert.equal(typeof res.submit, "undefined", "location autofill must never auto-submit");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
