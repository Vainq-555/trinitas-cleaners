// Pure, DOM-free view helpers for the employee portal (Phase 2B-1).
// No React imports: kept unit-testable via `node --test` like lib/profile.mjs
// and lib/schedule.mjs.
//
// These helpers are DISPLAY ONLY. They never authorize anything and never decide
// what an employee may see — `GET /employee/assignments` is already server-scoped
// to the session employee AND `visibleToEmployee = true`, so every function here
// operates on rows the server has already approved.

import { formatChicagoSchedule } from "./schedule.mjs";

// Shown when an assignment exists but the admin has not set a start time for it.
// Deliberately NOT the customer's requested date: an unscheduled assignment must
// read as unscheduled rather than borrowing a time it was never given.
export const NO_START_TIME_TEXT = "No start time set yet";

// Shown when the admin has not recorded a service location on the booking.
export const NO_LOCATION_TEXT = "No service location on file";

// The employee's own schedule for an assignment.
//
// Source of truth is `assignment.scheduledStartAt` (BookingAssignment), the
// admin-set employee start. The customer's own requested time
// (Booking.scheduledStartAt) is never exposed by the API and must never be
// substituted here.
//
// Returns { date, time, timezone } for a valid start, or null when the
// assignment has no admin-set start time.
export function assignedStart(assignment) {
  return formatChicagoSchedule(assignment?.scheduledStartAt);
}

// True when the admin has scheduled this assignment.
export function isScheduled(assignment) {
  return assignedStart(assignment) !== null;
}

// The customer's REQUESTED date, kept clearly separate from the employee's
// assigned schedule. Null-safe; an invalid or absent date yields null so the UI
// omits the row instead of printing "Invalid Date".
export function requestedDate(assignment) {
  const iso = assignment?.booking?.requestedDate;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Service location, as an array of display lines derived ONLY from the narrow
// `location` object the assignment endpoint already projects. Blank fields are
// dropped, so an absent address line 2 or country never renders an empty line.
export function locationLines(location) {
  const l = location || {};
  const clean = (value) => (value == null ? "" : String(value).trim());

  const city = clean(l.city);
  const state = clean(l.state);
  const postal = clean(l.postalCode);

  // "St Paul, MN 55101" — the comma belongs after the city, and any missing
  // segment simply drops out rather than leaving a dangling comma.
  let cityLine = city;
  if (city && (state || postal)) cityLine += ",";
  if (state) cityLine += (city ? " " : "") + state;
  if (postal) cityLine += (city || state ? " " : "") + postal;

  return [clean(l.addressLine1), clean(l.addressLine2), cityLine.trim(), clean(l.country)]
    .filter(Boolean);
}

// True when the customer has location instructions the employee needs on site.
export function hasInstructions(assignment) {
  const text = assignment?.booking?.location?.instructions;
  return typeof text === "string" && text.trim() !== "";
}

// How many assigned services the employee can currently see.
//
// Derived from the array the API already returned, so it can never disagree with
// the server's authorization. Never counts anything the server did not send.
export function visibleAssignmentCount(assignments) {
  return Array.isArray(assignments) ? assignments.length : 0}

// Dashboard copy. Kept here so the wording is unit-tested and stays free of
// customer terminology ("booking", "receipt", "payment") that does not apply to
// an employee account.
export function assignedServiceLabel(count) {
  return count === 1 ? "1 assigned service" : `${count} assigned services`;
}

export const DASHBOARD_EMPTY_TITLE = "No services assigned yet";
export const DASHBOARD_EMPTY_BODY =
  "When an administrator assigns you a service, it will appear here.";
