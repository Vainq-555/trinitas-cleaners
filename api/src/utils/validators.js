import { BOOKING_STATUS, BROADCAST_TARGET, BROADCAST_TYPE, REVIEW_STATUS, ROLES } from "../config.js";

export function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

export function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function isDate(v) {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

export function isValidRole(v) {
  return v === ROLES.ADMIN || v === ROLES.CUSTOMER;
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
