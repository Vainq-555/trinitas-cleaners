import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FALLBACK_BUSINESS,
  FALLBACK_AREAS,
  telHref,
  resolveBusiness,
  resolveAreas,
  formatAddress,
  formatAddressLong,
  compactHours,
  splitHoursRow,
  stateName,
} from "../lib/businessInfoData.mjs";

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("fallback business data exactly matches the current public values", () => {
  assert.deepEqual(FALLBACK_BUSINESS, {
    businessName: "Trinitas-Cleaners",
    phone: "1 763-620-4955",
    email: "trinitascleaner@gmail.com",
    addressLine1: null,
    city: "Anoka",
    state: "MN",
    postalCode: "55303",
    hoursWeek: "Monday – Saturday · 8:00 AM – 6:00 PM",
    hoursWeekend: "Sunday · Closed",
    responseTime: "Replies within one business day",
  });
});

test("fallback service area is exactly the approved Anoka area", () => {
  assert.deepEqual(FALLBACK_AREAS, [
    {
      name: "Anoka",
      city: "Anoka",
      state: "MN",
      postalCode: "55303",
      order: 0,
      isActive: true,
      description:
        "Proudly serving Anoka, MN 55303 and surrounding communities. Coverage can vary by location.",
    },
  ]);
});

test("telHref derives tel: from a formatted phone and stays null when there is no phone", () => {
  assert.equal(telHref("1 763-620-4955"), "tel:17636204955");
  assert.equal(telHref("612-555-0100"), "tel:6125550100");
  assert.equal(telHref(""), null);
  assert.equal(telHref(null), null);
  assert.equal(telHref(undefined), null);
});

test("resolveBusiness null/undefined/invalid stays on the exact fallback", () => {
  assert.deepEqual(resolveBusiness(null), FALLBACK_BUSINESS);
  assert.deepEqual(resolveBusiness(undefined), FALLBACK_BUSINESS);
  assert.deepEqual(resolveBusiness([]), FALLBACK_BUSINESS);
  assert.deepEqual(resolveBusiness({}), FALLBACK_BUSINESS);
});

test("resolveBusiness fills missing/null fields and preserves provided values", () => {
  const merged = resolveBusiness({ businessName: "X Co", phone: null, city: "Elk River" });
  assert.equal(merged.businessName, "X Co");
  assert.equal(merged.phone, "1 763-620-4955");
  assert.equal(merged.city, "Elk River");
  assert.equal(merged.state, "MN");
  assert.equal(merged.responseTime, "Replies within one business day");
});

test("resolveBusiness keeps an optional null address line 1", () => {
  assert.equal(resolveBusiness({ addressLine1: null }).addressLine1, null);
  assert.equal(resolveBusiness({}).addressLine1, null);
});

test("resolveAreas empty/missing/invalid lists fall back to the exact Anoka area", () => {
  assert.deepEqual(resolveAreas([]), FALLBACK_AREAS);
  assert.deepEqual(resolveAreas(null), FALLBACK_AREAS);
  assert.deepEqual(resolveAreas(undefined), FALLBACK_AREAS);
  assert.deepEqual(resolveAreas("nope"), FALLBACK_AREAS);
});

test("resolveAreas keeps active areas sorted by order then name and drops inactive only when none remain", () => {
  const areas = [
    { id: "a2", name: "Zulu", city: "Z", state: "MN", order: 2, isActive: true },
    { id: "a1", name: "Alpha", city: "A", state: "MN", order: 2, isActive: true },
    { id: "a0", name: "Zero", city: "Z", state: "MN", order: 0, isActive: true },
    { id: "aX", name: "Off", city: "O", state: "MN", order: 1, isActive: false },
  ];
  const res = resolveAreas(areas);
  assert.deepEqual(
    res.map((a) => a.name),
    ["Zero", "Alpha", "Zulu"],
  );
});

test("resolveAreas falls back when every returned area is inactive", () => {
  assert.deepEqual(
    resolveAreas([{ id: "a", name: "X", city: "X", state: "MN", order: 0, isActive: false }]),
    FALLBACK_AREAS,
  );
});

test("address formatters reproduce the current public strings", () => {
  const b = { city: "Anoka", state: "MN", postalCode: "55303" };
  assert.equal(formatAddress(b), "Anoka, MN 55303");
  assert.equal(formatAddressLong(b), "Anoka, Minnesota 55303");
  assert.equal(stateName("MN"), "Minnesota");
  assert.equal(stateName("WI"), "WI");
});

test("compactHours reproduces the footer's compact presentation from admin hours", () => {
  assert.equal(
    compactHours("Monday – Saturday · 8:00 AM – 6:00 PM"),
    "Mon–Sat · 8 AM – 6 PM",
  );
  assert.equal(compactHours("Tuesday – Friday · 9:00 AM – 5:00 PM"), "Tue–Fri · 9 AM – 5 PM");
  // Never blank on an unexpected format.
  assert.equal(compactHours("Always open (by appointment)"), "Always open (by appointment)");
  assert.equal(compactHours(""), "");
});

test("splitHoursRow splits weekday/weekend hour rows and tolerates odd formats", () => {
  assert.deepEqual(splitHoursRow("Monday – Saturday · 8:00 AM – 6:00 PM"), {
    days: "Monday – Saturday",
    time: "8:00 AM – 6:00 PM",
  });
  assert.deepEqual(splitHoursRow("Sunday · Closed"), { days: "Sunday", time: "Closed" });
  assert.equal(splitHoursRow("Odd format"), null);
  assert.equal(splitHoursRow(null), null);
});

// Removes the (intentionally untouched) server-side metadata blocks so the
// render-body contract checks below ignore SEO copy, which is out of scope.
const withoutMetadata = (src) => src.replace(/export const metadata = \{[^]*?\n\};/g, "");

test("public pages no longer hardcode the business phone, email, or tel href", () => {
  for (const rel of [
    "../components/Navbar.jsx",
    "../components/Footer.jsx",
    "../app/page.jsx",
    "../app/contact/page.jsx",
    "../app/services/page.jsx",
    "../app/how-it-works/page.jsx",
    "../app/service-areas/page.jsx",
  ]) {
    const page = withoutMetadata(source(rel));
    assert.doesNotMatch(page, /1 763-620-4955/, rel);
    assert.doesNotMatch(page, /tel:17636204955/, rel);
    assert.doesNotMatch(page, /trinitascleaner@gmail\.com/, rel);
  }
});

test("Footer hours derive from the provider rather than a hardcoded string", () => {
  const footer = source("../components/Footer.jsx");
  assert.match(footer, /compactHours>|compactHours\(/);
  assert.doesNotMatch(footer, /Mon–Sat · 8 AM – 6 PM/);
});