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
export const CONTENT_PAGES = ["how-it-works"];

export function isValidContentPage(v) {
  return typeof v === "string" && CONTENT_PAGES.includes(v);
}
