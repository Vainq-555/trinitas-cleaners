import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requestLocation,
  reverseGeocode,
  useMyLocation,
  isCompleteAddress,
  GEO_ERROR,
} from "../lib/geo.mjs";

const COMPLETE = { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" };

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const geo = (coords, err) => ({
  getCurrentPosition(success, fail, opts) {
    if (err) fail(err);
    else success({ coords: { latitude: coords.lat, longitude: coords.lon } });
    // record the options for timeout assertions
    geo.lastOpts = opts;
  },
});
geo.lastOpts = null;

test("location button exists in every customer booking address form", () => {
  // The button lives on both customer entry points that collect a service
  // address. Guard the contract so the label can't silently disappear.
  for (const rel of ["../app/dashboard/services/page.jsx", "../app/dashboard/bookings/page.jsx"]) {
    const page = source(rel);
    assert.match(page, /Use my current location/, rel);
    assert.match(page, /useMyLocation/, rel);
    assert.match(page, /type="button"/, rel);
  }
});

test("manual address entry remains the default (no location state on load)", () => {
  // Both forms initialize address with empty fields and only fill them after an
  // explicit action, so manual entry + editing work without geolocation.
  for (const rel of ["../app/dashboard/services/page.jsx", "../app/dashboard/bookings/page.jsx"]) {
    const page = source(rel);
    assert.match(page, /useState\(\{ line1: "", city: "", state: "", postalCode: "", country: "US" \}\)/, rel);
    // No geolocation request is ever called on load.
    assert.doesNotMatch(page, /getCurrentPosition/, rel);
  }
});

test("geolocation success yields coordinates", async () => {
  const res = await requestLocation({ geolocation: geo({ lat: 45.1976, lon: -93.3871 }) });
  assert.equal(res.ok, true);
  assert.deepEqual(res.coords, { lat: 45.1976, lon: -93.3871 });
  // Never requests continuously / high accuracy is off.
  assert.equal(geo.lastOpts.enableHighAccuracy, false);
});

test("permission denied is handled with a concise message and no throw", async () => {
  const res = await requestLocation({
    geolocation: geo(null, { code: 1, message: "denied" }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "DENIED");
  assert.equal(res.message, GEO_ERROR.DENIED);
});

test("position unavailable and timeout are handled", async () => {
  const unavail = await requestLocation({ geolocation: geo(null, { code: 2 }) });
  assert.equal(unavail.ok, false);
  assert.equal(unavail.code, "UNAVAILABLE");
  const timeout = await requestLocation({ geolocation: geo(null, { code: 3 }) });
  assert.equal(timeout.code, "TIMEOUT");
});

test("browser without geolocation support is handled", async () => {
  const res = await requestLocation({ geolocation: null });
  assert.equal(res.ok, false);
  assert.equal(res.code, "UNSUPPORTED");
});

test("requestLocation never throws and caps on a hard timeout", async () => {
  // A geolocation that never calls back should resolve (not hang) via the wrapper timer.
  const never = {
    getCurrentPosition() {
      /* never callbacks */
    },
  };
  const res = await requestLocation({ geolocation: never, timeoutMs: 10 });
  assert.equal(res.ok, false);
  assert.equal(res.code, "TIMEOUT");
});

test("reverse geocode maps complete address and never exposes keys", async () => {
  const fetchImpl = async (path) => {
    assert.match(path, /^\/geocode\/reverse\?lat=45\.1976&lon=-93\.3871$/);
    return { ok: true, address: COMPLETE };
  };
  const res = await reverseGeocode({ lat: 45.1976, lon: -93.3871, fetchImpl });
  assert.equal(res.ok, true);
  assert.deepEqual(res.address, COMPLETE);
});

test("incomplete returned address is flagged and lets the user complete it", async () => {
  const partial = { line1: "1 Main St", city: "Anoka", state: "", postalCode: "", country: "US" };
  const fetchImpl = async () => ({ ok: true, address: partial });
  const res = await reverseGeocode({ lat: 1, lon: 2, fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, "INCOMPLETE");
  assert.equal(res.address.line1, "1 Main St");
});

test("incomplete address returned as a thrown 422 (API client behavior) yields the partial address", async () => {
  const partial = { line1: "Lake Rd", city: "", state: "MN", postalCode: "55011", country: "US" };
  // The real api() client throws for non-2xx with err.data carrying the payload.
  const fetchImpl = async () => {
    const err = new Error("incomplete");
    err.data = { error: "incomplete", address: partial };
    err.status = 422;
    throw err;
  };
  const res = await reverseGeocode({ lat: 1, lon: 2, fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, "INCOMPLETE");
  assert.deepEqual(res.address, partial);
});

test("reverse geocode failure (network/backend error) is handled", async () => {
  const fetchImpl = async () => {
    throw new Error("boom");
  };
  const res = await reverseGeocode({ lat: 1, lon: 2, fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, "GEOCODE_FAILED");
});

test("useMyLocation success returns a filled address (no auto-submit)", async () => {
  const geolocation = geo({ lat: 45.1976, lon: -93.3871 });
  const fetchImpl = async () => ({ ok: true, address: COMPLETE });
  const res = await useMyLocation({ geolocation, fetchImpl });
  assert.equal(res.ok, true);
  assert.deepEqual(res.address, COMPLETE);
  // The module never persists or submits anything.
  assert.equal(typeof res.submit, "undefined");
});

test("useMyLocation denial bubbles up without geocoding and without a key", async () => {
  const geolocation = geo(null, { code: 1 });
  let geocoded = false;
  const fetchImpl = async () => {
    geocoded = true;
    return { ok: true, address: COMPLETE };
  };
  const res = await useMyLocation({ geolocation, fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.code, "DENIED");
  assert.equal(geocoded, false);
});

test("no secrets or keys are exposed by the address helper path", () => {
  // The geocode flow uses the backend proxy; the client never holds a key.
  const geoSource = source("../lib/geo.mjs");
  assert.doesNotMatch(geoSource, /API[_-]?KEY|sk_live|sk_test|apiKey|secret/i);
  assert.doesNotMatch(geoSource, /nominatim\.openstreetmap\.org/);
});
