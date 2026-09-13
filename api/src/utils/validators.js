import { BOOKING_STATUS, BROADCAST_TARGET, BROADCAST_TYPE, ROLES } from "../config.js";

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

// Slugs of admin-controllable content pages served by this API. Pages are
// opted in here (never arbitrary), so public content routes stay closed.
export const CONTENT_PAGES = ["how-it-works"];

export function isValidContentPage(v) {
  return typeof v === "string" && CONTENT_PAGES.includes(v);
}
