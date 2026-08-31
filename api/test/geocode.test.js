import test from "node:test";
import assert from "node:assert/strict";
import { reverseGeocode } from "../src/controllers/geocode.js";

const response = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const nomReply = (address = {}) => ({
  place_id: 123,
  address: {
    house_number: "1",
    road: "Main St",
    city: "Anoka",
    state: "Minnesota",
    postcode: "55303",
    country_code: "us",
    ...address,
  },
});

test("valid coordinates reverse geocode to the expected address shape (no internal fields)", async () => {
  const req = { query: { lat: "45.1976", lon: "-93.3871" } };
  const res = response();
  await reverseGeocode(req, res, { geocodeFetch: async () => nomReply() });
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.address, { line1: "1 Main St", city: "Anoka", state: "Minnesota", postalCode: "55303", country: "US" });
  // The response must not leak raw provider fields or any internal detail.
  const json = JSON.stringify(res.body);
  assert.ok(!json.includes("place_id"));
  assert.ok(!json.includes("nominatim"));
  assert.ok(!json.includes("secret"));
  assert.ok(!json.includes("api_key"));
});

test("missing or invalid coordinates are rejected as 400", async () => {
  for (const q of [{}, { lat: "x", lon: "y" }, { lat: "91", lon: "0" }, { lat: "0", lon: "181" }, { lat: "NaN", lon: "1" }]) {
    const res = response();
    await reverseGeocode({ query: q }, res, { geocodeFetch: async () => nomReply() });
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(q)}`);
  }
});

test("provider failure returns a generic 503 without internals", async () => {
  const req = { query: { lat: "45.1976", lon: "-93.3871" } };
  const res = response();
  await reverseGeocode(req, res, { geocodeFetch: async () => { throw new Error("upstream down: 500"); } });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /enter your address manually/i);
  assert.ok(!JSON.stringify(res.body).includes("upstream"));
});

test("malformed provider payload returns a generic 502", async () => {
  const req = { query: { lat: "1", lon: "2" } };
  const res = response();
  await reverseGeocode(req, res, { geocodeFetch: async () => "not-json{{{" });
  assert.equal(res.statusCode, 502);
});

test("incomplete address returns 422 with a partial, user-useful address", async () => {
  const req = { query: { lat: "1", lon: "2" } };
  const res = response();
  await reverseGeocode(req, res, {
    geocodeFetch: async () => nomReply({ city: "", postcode: "" }),
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.address.state, "Minnesota");
  assert.ok(res.body.error && res.body.error.length > 0);
});

test("addressMapping handles missing road/house number and town/village city", async () => {
  const req = { query: { lat: "1", lon: "2" } };
  const res = response();
  await reverseGeocode(req, res, {
    geocodeFetch: async () => ({
      address: { road: "Lake Rd", village: "Oak Grove", state: "MN", postcode: "55011", country_code: "us" },
    }),
  });
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.address, { line1: "Lake Rd", city: "Oak Grove", state: "MN", postalCode: "55011", country: "US" });
});
