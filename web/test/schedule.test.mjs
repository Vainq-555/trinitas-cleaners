import test from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_TIMEZONE, formatChicagoSchedule } from "../lib/schedule.mjs";

test("formatChicagoSchedule renders CDT wall clock without timezone shifts", () => {
  // 15:00 UTC on Sep 27 2026 is 10:00 AM CDT in America/Chicago.
  const s = formatChicagoSchedule(new Date("2026-09-27T15:00:00.000Z").toISOString());
  assert.equal(s.timezone, BUSINESS_TIMEZONE);
  assert.equal(s.date, "Sun, September 27, 2026");
  assert.equal(s.time, "10:00 AM");
});

test("formatChicagoSchedule keeps the wall-clock date for late-evening appointments", () => {
  // 03:30 UTC Sep 28 2026 is 22:30 Sep 27 CDT — the calendar day must not flip.
  const s = formatChicagoSchedule(new Date("2026-09-28T03:30:00.000Z").toISOString());
  assert.equal(s.date, "Sun, September 27, 2026");
  assert.equal(s.time, "10:30 PM");
});

test("formatChicagoSchedule handles CST (winter) appointments", () => {
  // 16:00 UTC Jan 15 2026 is 10:00 AM CST in America/Chicago.
  const s = formatChicagoSchedule(new Date("2026-01-15T16:00:00.000Z").toISOString());
  assert.equal(s.date, "Thu, January 15, 2026");
  assert.equal(s.time, "10:00 AM");
});

test("formatChicagoSchedule is null-safe for unscheduled bookings", () => {
  assert.equal(formatChicagoSchedule(null), null);
  assert.equal(formatChicagoSchedule(undefined), null);
  assert.equal(formatChicagoSchedule("not-a-date"), null);
});