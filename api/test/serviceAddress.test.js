import test from "node:test";
import assert from "node:assert/strict";
import { normalizeServiceAddress } from "../src/utils/serviceAddress.js";
import { validateTaxAddress } from "../src/utils/tax.js";

// Structural service-address validation for the booking flow.
//
// These tests assert the STRICTEST useful behavior is not over-applied: the
// validator only rejects obviously malformed/incomplete addresses and never
// computes tax. Every accepted output is proven to feed the existing Stripe
// Tax address pipeline (validateTaxAddress) unchanged.

const VALID = { line1: "2638 Cutters Grove Ave", city: "Anoka", state: "MN", postalCode: "55303", country: "US" };

function assertOk(result, expected) {
  assert.equal(result.ok, true, `expected ok: ${JSON.stringify(result)}`);
  assert.deepEqual(result.address, expected);
}

function assertRejected(result) {
  assert.equal(result.ok, false, `expected rejection, got: ${JSON.stringify(result)}`);
  assert.ok(result.error && result.error.length > 0, "rejection must carry a message");
}

test("valid US address is accepted and normalized (harmless casing/whitespace)", () => {
  const r = normalizeServiceAddress({
    line1: "  2638 Cutters Grove Ave  ",
    city: "  Anoka  ",
    state: "mn",
    postalCode: " 55303 ",
    country: " us ",
  });
  assertOk(r, { line1: "2638 Cutters Grove Ave", city: "Anoka", state: "MN", postalCode: "55303", country: "US" });
  // And the normalized output is exactly what the existing tax pipeline accepts.
  assert.deepEqual(validateTaxAddress(r.address), {
    line1: "2638 Cutters Grove Ave",
    city: "Anoka",
    state: "MN",
    postal_code: "55303",
    country: "US",
  });
});

test("valid plain US address accepted verbatim", () => {
  assertOk(normalizeServiceAddress(VALID), { line1: "2638 Cutters Grove Ave", city: "Anoka", state: "MN", postalCode: "55303", country: "US" });
});

test("ZIP+4 is accepted", () => {
  const r = normalizeServiceAddress({ ...VALID, postalCode: "55303-1234" });
  assertOk(r, { line1: "2638 Cutters Grove Ave", city: "Anoka", state: "MN", postalCode: "55303-1234", country: "US" });
});

test("lowercase state is normalized and accepted", () => {
  const r = normalizeServiceAddress({ ...VALID, state: "mn" });
  assertOk(r, { ...VALID, state: "MN" });
});

test("full state name from reverse-geocoding (e.g. Minnesota) is mapped and accepted", () => {
  const r = normalizeServiceAddress({ ...VALID, state: "Minnesota" });
  assertOk(r, { ...VALID, state: "MN" });
});

test("whitespace normalization across all fields", () => {
  const r = normalizeServiceAddress({
    line1: " 1 Main St ",
    city: " Anoka ",
    state: " MN ",
    postalCode: " 55303 ",
    country: " US ",
  });
  assertOk(r, { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" });
});

test("line2 (e.g. apartment) is preserved when present", () => {
  const r = normalizeServiceAddress({ ...VALID, line2: "Apt 33" });
  assertOk(r, { line1: "2638 Cutters Grove Ave", line2: "Apt 33", city: "Anoka", state: "MN", postalCode: "55303", country: "US" });
});

test("missing line1 is rejected", () => {
  assertRejected(normalizeServiceAddress({ ...VALID, line1: "" }));
  assertRejected(normalizeServiceAddress({ ...VALID, line1: "   " }));
});

test("missing city is rejected", () => {
  assertRejected(normalizeServiceAddress({ ...VALID, city: "" }));
});

test("missing state is rejected", () => {
  assertRejected(normalizeServiceAddress({ ...VALID, state: "" }));
});

test("invalid/truncated state such as 'An' is rejected", () => {
  assertRejected(normalizeServiceAddress({ ...VALID, state: "An" }));
});

test("invalid state such as 'Minnesotaa' is rejected", () => {
  assertRejected(normalizeServiceAddress({ ...VALID, state: "Minnesotaa" }));
});

test("missing postalCode is rejected", () => {
  assertRejected(normalizeServiceAddress({ ...VALID, postalCode: "" }));
});

test("city name used as postalCode such as 'Anoka' is rejected", () => {
  assertRejected(normalizeServiceAddress({ ...VALID, postalCode: "Anoka" }));
});

test("malformed ZIP is rejected", () => {
  for (const zip of ["5530", "55303-", "55303 55304", "abcde", "55303-12"]) {
    assertRejected(normalizeServiceAddress({ ...VALID, postalCode: zip }), `expected reject ${zip}`);
  }
});

test("missing country is rejected", () => {
  assertRejected(normalizeServiceAddress({ ...VALID, country: "" }));
});

test("unsupported country requires only structurally complete fields (no foreign validation)", () => {
  const r = normalizeServiceAddress({ line1: "5 Oak Ave", city: "Toronto", state: "ON", postalCode: "M4W 1J7", country: "CA" });
  assertOk(r, { line1: "5 Oak Ave", city: "Toronto", state: "ON", postalCode: "M4W 1J7", country: "CA" });
  assertRejected(normalizeServiceAddress({ line1: "", city: "Toronto", state: "ON", postalCode: "M4W 1J7", country: "CA" }));
});

test("USA and full 'United States' normalize to US", () => {
  assertOk(normalizeServiceAddress({ ...VALID, country: "USA" }), { ...VALID, country: "US" });
  assertOk(normalizeServiceAddress({ ...VALID, country: "United States" }), { ...VALID, country: "US" });
});

test("nonexistent/empty/null address object is rejected", () => {
  assertRejected(normalizeServiceAddress(null));
  assertRejected(normalizeServiceAddress(undefined));
  assertRejected(normalizeServiceAddress({}));
});

test("location-assisted five-field shape (reverse-geocode output) is accepted", () => {
  const geo = { line1: "1 Main St", city: "Anoka", state: "Minnesota", postalCode: "55303", country: "US" };
  const r = normalizeServiceAddress(geo);
  assertOk(r, { line1: "1 Main St", city: "Anoka", state: "MN", postalCode: "55303", country: "US" });
});

test("validation never computes tax and never mutates inputs", () => {
  const input = { line1: "1 Main St", city: "Anoka", state: "mn", postalCode: "55303", country: "us", line2: "Apt 1" };
  const snapshot = JSON.stringify(input);
  const r = normalizeServiceAddress(input);
  assert.equal(r.ok, true);
  assert.ok(!("taxCents" in r.address), "no tax computed");
  assert.ok(!("finalAmountCents" in r.address), "no final amount computed");
  assert.equal(JSON.stringify(input), snapshot, "input must not be mutated");
});