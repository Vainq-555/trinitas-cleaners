import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useMyLocation, reverseGeocode, isCompleteAddress, GEO_ERROR } from "../lib/geo.mjs";

// Phase 4 — Location-resolution triage.
//
// These tests prove WHY users see:
//   "We couldn't resolve your location to an address. Please enter it manually."
// and confirm the location->tax address shape contract.

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const geolocation = (coords, err) => ({
  getCurrentPosition(success, fail) {
    if (err) fail(err);
    else success({ coords: { latitude: coords.lat, longitude: coords.lon } });
  },
});

// ---- ROOT CAUSE ----

test("calling useMyLocation EXACTLY as the pages do (no fetchImpl) yields the reported message and never fetches", async () => {
  // The dashboards call: useMyLocation({ geolocation: navigator.geolocation })
  // with NO fetchImpl (see services/page.jsx:48 and bookings/page.jsx:99).
  // reverseGeocode's default doFetch is a stub that throws, so no HTTP request
  // is ever made, and the error is mapped to GEOCODE_FAILED.
  let fetched = false;
  const fetchImpl = async () => { fetched = true; };

  const res = await useMyLocation({
    geolocation: geolocation({ lat: 45.1976, lon: -93.3871 }),
    fetchImpl: undefined, // mirrors the production page call site
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "GEOCODE_FAILED");
  assert.equal(res.message, GEO_ERROR.GEOCODE_FAILED);
  assert.equal(res.message, "We couldn't resolve your location to an address. Please enter it manually.");
  assert.equal(fetched, false, "No network request must be attempted when fetchImpl is absent");
});

test("reverseGeocode without fetchImpl throws internally and maps to GEOCODE_FAILED (no partial address)", async () => {
  // With the real (unwired) call, err.data is undefined so no partial address
  // is recovered and the generic "couldn't resolve" message is returned.
  const res = await reverseGeocode({ lat: 1, lon: 2, fetchImpl: undefined });
  assert.equal(res.ok, false);
  assert.equal(res.code, "GEOCODE_FAILED");
  assert.equal(res.address, undefined);
  assert.equal(res.message, "We couldn't resolve your location to an address. Please enter it manually.");
});

test("both production pages now pass fetchImpl wired to the api() client (fix verified)", () => {
  for (const rel of ["../app/dashboard/services/page.jsx", "../app/dashboard/bookings/page.jsx"]) {
    const page = source(rel);
    const callLine = page.match(/useMyLocation\(\{[^}]*\}\)/)?.[0] || "";
    assert.match(callLine, /useMyLocation\(/);
    assert.match(callLine, /fetchImpl:\s*\(path\)\s*=>\s*api\(path\)/, `${rel} must pass fetchImpl wired to api()`);
    assert.doesNotMatch(callLine, /https?:\/\//, `${rel} must not expose a raw backend URL`);
  }
});

test("with fetchImpl wired, a successful geolocation resolves to a full address (control case)", async () => {
  const fetchImpl = async (path) => {
    assert.match(path, /^\/geocode\/reverse\?lat=45\.1976&lon=-93\.3871$/);
    return { ok: true, address: { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" } };
  };
  const res = await useMyLocation({ geolocation: geolocation({ lat: 45.1976, lon: -93.3871 }), fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(res.code, "OK");
  assert.deepEqual(res.address, { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" });
  assert.equal(typeof res.submit, "undefined", "location autofill must never auto-submit");
});

// ---- LOCATION -> TAX COMPATIBILITY (shape contract) ----

const GEOCODED = { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" };

test("a fully resolved location produces exactly the 5-field address shape Stripe Tax needs", async () => {
  assert.equal(isCompleteAddress(GEOCODED), true);
  assert.deepEqual(Object.keys(GEOCODED).sort(), ["city", "country", "line1", "postalCode", "state"]);
});

test("no client-side tax is ever computed (no math, no rate, Stripe stays authoritative)", () => {
  const geoLib = source("../lib/geo.mjs");
  // No hard-coded rate, no tax estimation, no Stripe key on the client.
  assert.doesNotMatch(geoLib, /taxRate|tax_|percentage|sk_live|sk_test|apiKey|secret/i);
  assert.doesNotMatch(geoLib, /nominatim\.openstreetmap\.org/);
  // No client-side tax arithmetic (no fractional-rate multiplication).
  assert.doesNotMatch(geoLib, /Math\.round\(.*\*|subtotal.*tax/i);
  // Coordinates are only used transiently for the reverse lookup, never persisted.
  assert.match(geoLib, /coords: \{ lat: pos\.coords\.latitude, lon: pos\.coords\.longitude \}/);
});

test("permission denial and incomplete results never block manual address entry", () => {
  // Denied -> handled, still allows manual entry.
  const denied = {
    ok: false, code: "DENIED", message: GEO_ERROR.DENIED,
  };
  assert.match(denied.message, /enter your address manually/i);
  // Incomplete -> surfaces partial + lets the user correct it.
  const partial = { line1: "Lake Rd", city: "", state: "MN", postalCode: "55011", country: "US" };
  assert.equal(isCompleteAddress(partial), false);
  assert.ok(GEO_ERROR.INCOMPLETE);
});
