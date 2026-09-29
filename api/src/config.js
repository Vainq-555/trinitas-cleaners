import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

export const PORT = Number(process.env.PORT || 4000);
export const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
export const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
export const COOKIE_NAME = "tc_token";

export const TAX_RATE = 0.0725; // MN default; override per-receipt if desired

// Three roles, deliberately NOT a hierarchy. "employee" is a separate internal
// role that inherits NO customer and NO admin privilege: every employee
// capability is granted by an explicit employee-only guard
// (middleware/auth.js `requireEmployee`) on top of `authenticate`.
// Public registration can only ever create a customer (see controllers/auth.js).
export const ROLES = { ADMIN: "admin", CUSTOMER: "customer", EMPLOYEE: "employee" };
export const BOOKING_STATUS = ["pending", "accepted", "declined", "worked"];
export const BROADCAST_TYPE = ["notification", "announcement"];
export const BROADCAST_TARGET = ["public", "all", "specific_user"];
// Which AUDIENCE a broadcast belongs to — Phase 2B-2. Orthogonal to
// BROADCAST_TARGET: the target says who-within-an-audience, the audience says
// which audience. `target = "all"` therefore never means "everybody"; it means
// "all of `audience`". The default is "customer" so anything that predates this
// field, or omits it, keeps the customer-only meaning it always had.
export const BROADCAST_AUDIENCE = ["customer", "employee"];
export const BROADCAST_AUDIENCE_DEFAULT = "customer";

// Employee availability + available shifts (Phase 2B-4). Availability is
// INFORMATIONAL and a shift request is a REQUEST: neither ever creates work.
// BookingAssignment remains the only source of truth for an actual assignment.
export const AVAILABILITY_KIND = ["available", "unavailable"];
export const AVAILABILITY_KIND_DEFAULT = "available";
// A request is only ever "requested" on creation. Only an admin approve/decline
// moves it to a decision, and nothing else — in particular not a request — ever
// creates a BookingAssignment.
export const SHIFT_REQUEST_STATUS = ["requested", "approved", "declined"];
export const SHIFT_REQUEST_STATUS_DEFAULT = "requested";
export const REVIEW_STATUS = ["pending", "approved", "rejected"];

// COMMUNITY AUDIENCE — Phase 2B-5. The community chat wall is served to TWO
// disjoint audiences from one table, so which audience a row belongs to is stored
// EXPLICITLY rather than inferred from its author's role at read time. This is
// the same decision Broadcast made in Phase 2B-2 (see BROADCAST_AUDIENCE above)
// and for the same reason: an inferred audience is a convention that fails open,
// while a stored one fails closed.
//
//   audience = "customer" -> the customer community (unchanged by this phase)
//   audience = "employee" -> the employee community (Phase 2B-5)
//
// `target = "all"` style ambiguity has no equivalent here: there is no value of
// `audience` that means "everybody", and a customer query can therefore never
// match an employee row even if the audience filter were ever dropped.
export const COMMUNITY_AUDIENCE = ["customer", "employee"];
// The DEFAULT is the safe legacy value, so a caller that omits the column creates
// a CUSTOMER post, never an employee one. Reaching the employee audience always
// requires naming it explicitly, which is what makes "customer" the right
// default rather than merely the convenient one.
export const COMMUNITY_AUDIENCE_DEFAULT = "customer";
// Named so the employee controllers never spell the audience as a bare literal
// that could drift between the read query and the write.
export const COMMUNITY_EMPLOYEE_AUDIENCE = "employee";

// Users idle longer than this (ms) are considered offline.
export const ONLINE_TTL_MS = 5 * 60 * 1000;

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
export const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL || "http://localhost:3000";

// Stripe secret-key mode gate. A key is usable only when its mode matches the
// environment: live keys (sk_live_) in production only, test keys (sk_test_) in
// non-production only. Any other key (or none) yields null, so no Stripe call
// can ever be made with an invalid key, test environments can never charge
// live Stripe, and production can never accidentally run in test mode. The
// optional `key` argument exists purely so unit tests can exercise every mode.
export function stripeSecretKeyMode(key = STRIPE_SECRET_KEY) {
  const production = process.env.NODE_ENV === "production";
  if (production && typeof key === "string" && key.startsWith("sk_live_")) return "live";
  if (!production && typeof key === "string" && key.startsWith("sk_test_")) return "test";
  return null;
}

// Email delivery (password recovery). RESEND_API_KEY and EMAIL_FROM must be set
// in production; see api/.env.example. These value NAMES are committed, never
// the secrets themselves.
export const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "resend";
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const EMAIL_FROM = process.env.EMAIL_FROM;
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO;
