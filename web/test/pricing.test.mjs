// node:test suite for the admin monthly-pricing helpers in web/lib/pricing.mjs.
// Run with: npm test  (web)
import test from "node:test";
import assert from "node:assert/strict";
import {
  monthlyDollarsToCents,
  centsToDollars,
  globalMonthlyBody,
  customerMonthlyBody,
  customerMonthlyClearBody,
} from "../lib/pricing.mjs";

test("monthlyDollarsToCents converts valid non-negative dollars to integer cents", () => {
  assert.equal(monthlyDollarsToCents("180"), 18000);
  assert.equal(monthlyDollarsToCents("180.00"), 18000);
  assert.equal(monthlyDollarsToCents("1.5"), 150);
  assert.equal(monthlyDollarsToCents("0"), 0);
  assert.equal(monthlyDollarsToCents(60), 6000);
});

test("monthlyDollarsToCents rounds to the nearest cent", () => {
  assert.equal(monthlyDollarsToCents("1.236"), 124);
  assert.equal(monthlyDollarsToCents("1.234"), 123);
  assert.equal(monthlyDollarsToCents("1.999"), 200);
});

test("monthlyDollarsToCents rejects missing, negative, and non-numeric values", () => {
  assert.equal(monthlyDollarsToCents(""), null);
  assert.equal(monthlyDollarsToCents(null), null);
  assert.equal(monthlyDollarsToCents(undefined), null);
  assert.equal(monthlyDollarsToCents("-5"), null);
  assert.equal(monthlyDollarsToCents("abc"), null);
  assert.equal(monthlyDollarsToCents("12.5.6"), null);
  assert.equal(monthlyDollarsToCents(Infinity), null);
  assert.equal(monthlyDollarsToCents(NaN), null);
});

test("centsToDollars mirrors the conversion", () => {
  assert.equal(centsToDollars(18000), "180");
  assert.equal(centsToDollars(1500), "15");
  assert.equal(centsToDollars(5), "0.05");
  assert.equal(centsToDollars(0), "0");
  assert.equal(centsToDollars(null), "");
  assert.equal(centsToDollars(17.5), "");
  assert.equal(centsToDollars(-100), "");
});

test("globalMonthlyBody: active save requires a valid price and sends only monthly lanes", () => {
  const body = globalMonthlyBody("180", true);
  assert.deepEqual(body, { monthlyPriceCents: 18000, monthlyActive: true });
  assert.ok(!("basePrice" in body));
});

test("globalMonthlyBody: active save with missing or invalid price is null", () => {
  assert.equal(globalMonthlyBody("", true), null);
  assert.equal(globalMonthlyBody("abc", true), null);
  assert.equal(globalMonthlyBody("-1", true), null);
});

test("globalMonthlyBody: inactive save with a valid price still persists the price", () => {
  const body = globalMonthlyBody("180", false);
  assert.deepEqual(body, { monthlyActive: false, monthlyPriceCents: 18000 });
});

test("globalMonthlyBody: inactive save with empty price turns monthly off only", () => {
  const body = globalMonthlyBody("", false);
  assert.deepEqual(body, { monthlyActive: false });
  assert.ok(!("monthlyPriceCents" in body));
});

test("globalMonthlyBody: invalid non-empty input is rejected even when inactive", () => {
  assert.equal(globalMonthlyBody("-5", false), null);
  assert.equal(globalMonthlyBody("abc", false), null);
});

test("customerMonthlyBody: sets the monthly override without touching the one-time price", () => {
  const body = customerMonthlyBody("cus_123", "180");
  assert.deepEqual(body, { customerId: "cus_123", monthlyPriceCents: 18000 });
  assert.ok(!("price" in body));
  assert.equal(customerMonthlyBody("", "180"), null);
  assert.equal(customerMonthlyBody("cus_123", "abc"), null);
});

test("customerMonthlyClearBody: clears ONLY the monthly override via PUT null semantics", () => {
  assert.deepEqual(customerMonthlyClearBody("cus_123"), { customerId: "cus_123", monthlyPriceCents: null });
  assert.ok(!("price" in customerMonthlyClearBody("cus_123")));
  assert.equal(customerMonthlyClearBody(""), null);
});