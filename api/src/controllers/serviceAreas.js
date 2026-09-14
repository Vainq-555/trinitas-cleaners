import prisma from "../utils/prisma.js";
import {
  badRequest,
  isNonNegativeInt,
  isValidAreaDescription,
  isValidAreaName,
  isValidCity,
  isValidPostalCode,
  isValidStateCode,
} from "../utils/validators.js";

// Express 4 does not catch rejected promises from async handlers. Route the
// rejection to the existing errorHandler instead of terminating the process.
// Handler signature is (req, res, next, db = prisma): Express passes `next` in
// the third slot; tests inject a fake db in that same third slot. A non-function
// third argument is therefore treated as the injected db. (Same as content.js.)
const wrap = (fn) => (req, res, next, db = prisma) => {
  if (typeof next !== "function") [db, next] = [next, undefined];
  return Promise.resolve(fn(req, res, next, db)).catch(next);
};

const areaOrder = [{ order: "asc" }, { name: "asc" }];

// Validates a ServiceArea payload. When partial is false every required field
// (name, city, state) must be present. Returns { error } or { data }.
function normalizeAreaInput(body = {}, { partial = false } = {}) {
  const { name, city, state, postalCode, description, order, isActive } = body || {};
  const data = {};

  if (name !== undefined) {
    if (!isValidAreaName(name)) return { error: "name is required" };
    data.name = name.trim();
  }
  if (city !== undefined) {
    if (!isValidCity(city)) return { error: "city is required" };
    data.city = city.trim();
  }
  if (state !== undefined) {
    if (!isValidStateCode(state)) return { error: "state must be a 2-letter US state code" };
    data.state = state.trim().toUpperCase();
  }
  if (postalCode !== undefined && postalCode !== null && postalCode !== "") {
    if (!isValidPostalCode(postalCode)) return { error: "postalCode must be a valid US ZIP code" };
    data.postalCode = postalCode.trim();
  } else if (postalCode !== undefined) {
    data.postalCode = null;
  }
  if (description !== undefined && description !== null && description !== "") {
    if (typeof description !== "string" || description.trim().length > 500) {
      return { error: "description is invalid" };
    }
    data.description = description.trim();
  } else if (description !== undefined) {
    data.description = null;
  }
  if (order !== undefined) {
    if (!isNonNegativeInt(order)) return { error: "order must be a non-negative integer" };
    data.order = order;
  }
  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") return { error: "isActive must be a boolean" };
    data.isActive = isActive;
  }

  if (!partial && !data.name) return { error: "name is required" };
  if (!partial && !data.city) return { error: "city is required" };
  if (!partial && !data.state) return { error: "state is required" };
  if (Object.keys(data).length === 0) return { error: "No valid fields to update" };
  return { data };
}

// ---- Public main site ----
// Only active areas, ordered by (order asc, name asc). No auth.
export const listPublicServiceAreas = wrap(async function listPublicServiceAreas(req, res, next, db = prisma) {
  const areas = await db.serviceArea.findMany({
    where: { isActive: true },
    orderBy: areaOrder,
  });
  res.json({ areas });
});

// ---- Admin ----
// List every area (including inactive) for management.
export const adminListServiceAreas = wrap(async function adminListServiceAreas(req, res, next, db = prisma) {
  const areas = await db.serviceArea.findMany({ orderBy: areaOrder });
  res.json({ areas });
});

export const adminCreateServiceArea = wrap(async function adminCreateServiceArea(req, res, next, db = prisma) {
  const { error, data } = normalizeAreaInput(req.body || {});
  if (error) return badRequest(res, error);

  let area;
  try {
    area = await db.serviceArea.create({ data });
  } catch (err) {
    if (err && err.code === "P2002") return badRequest(res, "A service area with this name already exists");
    throw err;
  }
  res.status(201).json({ area });
});

export const adminUpdateServiceArea = wrap(async function adminUpdateServiceArea(req, res, next, db = prisma) {
  const { id } = req.params;
  const existing = await db.serviceArea.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Service area not found" });

  const { error, data } = normalizeAreaInput(req.body || {}, { partial: true });
  if (error) return badRequest(res, error);

  let area;
  try {
    area = await db.serviceArea.update({ where: { id }, data });
  } catch (err) {
    if (err && err.code === "P2002") return badRequest(res, "A service area with this name already exists");
    throw err;
  }
  res.json({ area });
});

export const adminDeleteServiceArea = wrap(async function adminDeleteServiceArea(req, res, next, db = prisma) {
  const { id } = req.params;
  const existing = await db.serviceArea.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Service area not found" });

  await db.serviceArea.delete({ where: { id } });
  res.json({ ok: true });
});