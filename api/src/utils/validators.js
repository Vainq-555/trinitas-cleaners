import {
  AVAILABILITY_KIND,
  BOOKING_STATUS,
  BROADCAST_AUDIENCE,
  BROADCAST_TARGET,
  BROADCAST_TYPE,
  COMMUNITY_AUDIENCE,
  LEAVE_KIND,
  REVIEW_STATUS,
  ROLES,
} from "../config.js";
import { isValidDateString, isValidTimeString } from "./schedule.js";

export function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

// Reserved system namespace used by former-employee account closure: a closed
// account's email is rewritten to `deleted+<userId>@deleted.invalid` (see
// deleteAccount in controllers/auth.js). Publicly-created accounts must never
// be able to occupy that namespace, or the closure's email write could collide
// with an existing account on the User.email unique constraint. The whole
// domain is reserved, case-insensitively. The closure itself writes the address
// directly, so it does not go through this validator.
export const RESERVED_EMAIL_DOMAIN = "deleted.invalid";

export function isReservedEmail(v) {
  return typeof v === "string" && v.toLowerCase().endsWith(`@${RESERVED_EMAIL_DOMAIN}`);
}

export function isEmail(v) {
  return (
    typeof v === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) &&
    !isReservedEmail(v)
  );
}

export function isDate(v) {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

// "employee" is a valid INTERNAL role, recognized here so it can be stored and
// validated. It is never accepted from public registration: POST /auth/register
// hard-codes ROLES.CUSTOMER, and employees are created by admins only.
export function isValidRole(v) {
  return v === ROLES.ADMIN || v === ROLES.CUSTOMER || v === ROLES.EMPLOYEE;
}

export function isValidBookingStatus(v) {
  return BOOKING_STATUS.includes(v);
}

export function isValidBroadcastType(v) {
  return BROADCAST_TYPE.includes(v);
}

export function isValidBroadcastTarget(v) {
  return BROADCAST_TARGET.includes(v);
}

// Phase 2B-2. An explicit audience is required before a broadcast may be created,
// so an employee announcement can never be inferred from target = "all" and a
// customer announcement can never be delivered to employees by omission.
export function isValidBroadcastAudience(v) {
  return BROADCAST_AUDIENCE.includes(v);
}

export const REVIEW_TITLE_MAX_LENGTH = 120;
export const REVIEW_BODY_MAX_LENGTH = 2000;

export function isValidReviewStatus(v) {
  return REVIEW_STATUS.includes(v);
}

export function isValidRating(v) {
  return Number.isInteger(v) && v >= 1 && v <= 5;
}

export function isValidReviewTitle(v) {
  return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= REVIEW_TITLE_MAX_LENGTH;
}

export function isValidReviewBody(v) {
  return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= REVIEW_BODY_MAX_LENGTH;
}

// Slugs of admin-controllable content pages served by this API. Pages are
// opted in here (never arbitrary), so public content routes stay closed.
export const CONTENT_PAGES = ["how-it-works", "faq"];

export function isValidContentPage(v) {
  return typeof v === "string" && CONTENT_PAGES.includes(v);
}

// ---- Business Information + Service Areas ----

// Canonical singleton id for the BusinessInfo row.
export const BUSINESS_INFO_ID = "business-info";

function isNonEmptyString(v, max = 1000) {
  return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= max;
}

export function isValidBusinessName(v) {
  return isNonEmptyString(v, 80);
}

export function isValidPhone(v) {
  if (typeof v !== "string" || !/^[\d\s()+\-.]{7,20}$/.test(v.trim())) return false;
  const digits = v.replace(/[^\d]/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function isValidCity(v) {
  return isNonEmptyString(v, 80);
}

export function isValidStateCode(v) {
  return typeof v === "string" && /^[A-Za-z]{2}$/.test(v.trim());
}

export function isValidPostalCode(v) {
  return typeof v === "string" && /^\d{5}(?:-\d{4})?$/.test(v.trim());
}

export function isValidHours(v) {
  return isNonEmptyString(v, 200);
}

export function isValidResponseTime(v) {
  return isNonEmptyString(v, 200);
}

export function isValidAddressLine(v) {
  return v === undefined || v === null || v === "" || (typeof v === "string" && v.trim().length <= 200);
}

export function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

export function isValidAreaName(v) {
  return isNonEmptyString(v, 80);
}

export function isValidAreaDescription(v) {
  return v === undefined || v === null || v === "" || (typeof v === "string" && v.trim().length <= 500);
}

// ---- Community chat ----

export const COMMUNITY_MESSAGE_MAX_LENGTH = 1000;
export const COMMUNITY_LIMIT_DEFAULT = 50;
export const COMMUNITY_LIMIT_MAX = 100;

export function isValidCommunityMessage(v) {
  return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= COMMUNITY_MESSAGE_MAX_LENGTH;
}

export function isValidCommunityLimit(v) {
  return Number.isInteger(v) && v >= 1 && v <= COMMUNITY_LIMIT_MAX;
}

// Phase 2B-5. Which audience a community post belongs to. Validated wherever an
// audience may be supplied by a caller (the admin surface); the employee and
// customer controllers never take one from the request and instead pass a
// named constant, which is why this is not on the posting path.
export function isValidCommunityAudience(v) {
  return COMMUNITY_AUDIENCE.includes(v);
}

// ---- Community profiles ----

export const PROFILE_DISPLAY_NAME_MAX = 100;
export const PROFILE_BIO_MAX = 500;
export const PROFILE_CITY_MAX = 80;

export function isValidProfileDisplayName(v) {
  return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= PROFILE_DISPLAY_NAME_MAX;
}

// Optional text fields: undefined/null/"" are cleared to null; otherwise a
// trimmed string within the bound. Keeps "" and whitespace from leaking in.
export function isValidProfileBio(v) {
  return v === undefined || v === null || v === "" || (typeof v === "string" && v.trim().length <= PROFILE_BIO_MAX);
}

// Optional general location. Reuses the business-info/city conventions.
export function isValidProfileCity(v) {
  return v === undefined || v === null || v === "" || (typeof v === "string" && v.trim().length >= 1 && v.trim().length <= PROFILE_CITY_MAX);
}

export function isValidProfileState(v) {
  return v === undefined || v === null || v === "" || (typeof v === "string" && /^[A-Za-z]{2}$/.test(v.trim()));
}

// Avatar must be an absolute https: URL with no embedded credentials. Accepts
// common image/bare paths; the upload/storage mechanism itself is out of scope
// for this phase (only the URL is stored).
export function isValidAvatarUrl(v) {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v !== "string") return false;
  let u;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return u.hostname.length > 0;
}

export function isValidProfileBoolean(v) {
  return typeof v === "boolean";
}

// ---------------------------------------------------------------------------
// Employee availability + available shifts (Phase 2B-4)
// ---------------------------------------------------------------------------

export function isValidAvailabilityKind(v) {
  return AVAILABILITY_KIND.includes(v);
}

// An availability window is a real calendar day plus a 24-hour start/end pair
// that is genuinely inside that day.
//
// The date/time FORMATS are not re-invented here: they are the exact
// America/Chicago wall-clock formats the customer appointment picker already
// uses, validated by the single source of truth in utils/schedule.js. Only the
// "end must be after start" rule is new.
//
// start === end is rejected rather than treated as "all day": a zero-length
// window is nearly always a typo, and silently storing it would tell the admin
// the employee is available for a time range that does not exist.
export function isValidAvailabilityWindow({ date, startTime, endTime } = {}) {
  if (!isValidDateString(date)) return false;
  if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) return false;
  return startTime < endTime;
}

// ---------------------------------------------------------------------------
// Employee leave requests
// ---------------------------------------------------------------------------

// An OPTIONAL leave kind. Absence is valid, so undefined/null/"" pass; a kind that
// IS supplied must be one of the known buckets. A non-string is rejected rather
// than coerced, so an object cannot be stored in a TEXT column.
export function isValidLeaveKind(v) {
  if (v === undefined || v === null || v === "") return true;
  return typeof v === "string" && LEAVE_KIND.includes(v);
}

// A leave range is a real calendar day or span of days, inclusive of both ends.
//
// The date FORMAT is not re-invented: both ends go through the single source of
// truth in utils/schedule.js, the same America/Chicago wall-clock "YYYY-MM-DD"
// calendar day the customer appointment picker and EmployeeAvailability.date use.
// Because the format is a zero-padded, validated calendar day, comparing the two
// strings compares the days themselves — so "end before start" is caught without
// any timezone conversion that could shift a leave by a day.
//
// startsOn === endsOn IS valid here: that is a genuine one-day leave, unlike an
// availability window where a zero-length range is always a typo.
export function isValidLeaveRange({ startsOn, endsOn } = {}) {
  if (!isValidDateString(startsOn) || !isValidDateString(endsOn)) return false;
  return startsOn <= endsOn;
}

// An optional free-text note, shared by availability windows and shift requests
// (both are admin-facing text an employee volunteers). Bounded so a note can
// never be used to push an unbounded blob into a row the admin has to read.
//
// Absence is valid: a note is always optional, so undefined/null/"" pass and a
// present note must be a bounded string. A non-string is rejected rather than
// coerced, so `note: { $ne: null }`-style objects cannot be stored.
export const NOTE_MAX_LENGTH = 500;

export function isValidBoundedNote(v) {
  if (v === undefined || v === null || v === "") return true;
  return typeof v === "string" && v.length <= NOTE_MAX_LENGTH;
}
