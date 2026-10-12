// Admin shifts & availability view helpers (Phase 2B-4). Pure and DOM-free so
// they can be unit-tested with `node --test`, matching the `lib/*.mjs`
// convention.
//
// WHY THIS MODULE EXISTS: the admin API returns FLAT, deliberate view objects —
// `{ shifts: [...] }`, `{ candidates: [...] }`, and availability rows that carry
// `employeeName`. It does NOT return the nested `booking.*` / `requests[].employee.*`
// shape. The admin page used to read the nested paths anyway, so the candidate
// picker was always empty and every name/time/location rendered a placeholder.
// These helpers read exactly the fields the server sends, and each one is
// covered by a test built from a real API payload, so a re-introduced nested
// path fails a test instead of silently blanking the page.
//
// NOTHING HERE DECIDES AUTHORIZATION. Visibility, claimability and who is
// assigned are server decisions; these helpers only present the fields.
import { formatChicagoSchedule } from "./schedule.mjs";

// GET /api/admin/shifts → { shifts: [...] }
export function adminShiftList(payload) {
  return Array.isArray(payload?.shifts) ? payload.shifts : [];
}

// GET /api/admin/shifts/candidates → { candidates: [...] }
export function adminCandidateList(payload) {
  return Array.isArray(payload?.candidates) ? payload.candidates : [];
}

// GET /api/admin/availability → { availability: [...] }
export function adminAvailabilityList(payload) {
  return Array.isArray(payload?.availability) ? payload.availability : [];
}

// "1 Main St, Chicago, IL" from the flat `location` object the shift view sends.
export function adminLocationLabel(location) {
  return [location?.addressLine1, location?.city, location?.state]
    .filter(Boolean)
    .join(", ");
}

// One line for the candidate <option>. Candidates carry city/state but no street
// line, so the place is built from those two fields only.
export function adminCandidateLabel(candidate) {
  const place = [candidate?.city, candidate?.state].filter(Boolean).join(", ");
  return [candidate?.requestedDate ?? "", candidate?.serviceName ?? "Service", place || "no address"].join(
    " · ",
  );
}

// The card headline: the booking instant when present, else the requested date,
// rendered in the business timezone; a raw date string is shown verbatim rather
// than as "Invalid Date".
export function adminShiftWhen(shift) {
  const when = formatChicagoSchedule(shift?.customerScheduledStartAt);
  if (when) return `${when.date} at ${when.time}`;
  return shift?.requestedDate ?? "Time to be confirmed";
}

export function adminShiftServiceName(shift) {
  return shift?.serviceName ?? "Service";
}

// The flat `assignment` object (not `booking.employeeAssignments[0]`). Null when
// nobody holds the booking, so the page never shows an "Assigned" badge for
// unassigned work.
export function adminShiftAssigneeName(shift) {
  const assignment = shift?.assignment;
  if (!assignment) return null;
  return assignment.employeeName ?? assignment.employeeId ?? null;
}

export function adminShiftRequests(shift) {
  return Array.isArray(shift?.requests) ? shift.requests : [];
}

// The admin availability rows carry `employeeName`, not an `employee` object.
export function adminAvailabilityEmployeeName(row) {
  return row?.employeeName ?? "Employee";
}
