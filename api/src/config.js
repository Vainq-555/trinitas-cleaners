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

export const ROLES = { ADMIN: "admin", CUSTOMER: "customer" };
export const BOOKING_STATUS = ["pending", "accepted", "declined", "worked"];
export const BROADCAST_TYPE = ["notification", "announcement"];
export const BROADCAST_TARGET = ["public", "all", "specific_user"];

// Users idle longer than this (ms) are considered offline.
export const ONLINE_TTL_MS = 5 * 60 * 1000;

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
export const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL || "http://localhost:3000";
