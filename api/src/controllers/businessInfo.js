import prisma from "../utils/prisma.js";
import {
  badRequest,
  BUSINESS_INFO_ID,
  isEmail,
  isValidAddressLine,
  isValidBusinessName,
  isValidCity,
  isValidHours,
  isValidPhone,
  isValidPostalCode,
  isValidResponseTime,
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

// Validates a full BusinessInfo payload and returns either { error } or the
// normalized data to persist (with the canonical singleton id applied).
function normalizeBusinessInput(body = {}) {
  const {
    businessName,
    phone,
    email,
    addressLine1,
    city,
    state,
    postalCode,
    hoursWeek,
    hoursWeekend,
    responseTime,
  } = body;

  if (!isValidBusinessName(businessName)) return { error: "businessName is required" };
  if (!isValidPhone(phone)) return { error: "phone must be a valid phone number" };
  if (!isEmail(email)) return { error: "email must be a valid email address" };
  if (!isValidAddressLine(addressLine1)) return { error: "addressLine1 is invalid" };
  if (!isValidCity(city)) return { error: "city is required" };
  if (!isValidStateCode(state)) return { error: "state must be a 2-letter US state code" };
  if (!isValidPostalCode(postalCode)) return { error: "postalCode must be a valid US ZIP code" };
  if (!isValidHours(hoursWeek)) return { error: "hoursWeek is required" };
  if (!isValidHours(hoursWeekend)) return { error: "hoursWeekend is required" };
  if (!isValidResponseTime(responseTime)) return { error: "responseTime is required" };

  return {
    data: {
      id: BUSINESS_INFO_ID,
      businessName: businessName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      addressLine1:
        typeof addressLine1 === "string" && addressLine1.trim() ? addressLine1.trim() : null,
      city: city.trim(),
      state: state.trim().toUpperCase(),
      postalCode: postalCode.trim(),
      hoursWeek: hoursWeek.trim(),
      hoursWeekend: hoursWeekend.trim(),
      responseTime: responseTime.trim(),
    },
  };
}

// ---- Public main site ----
// No auth. Returns the singleton business record, or null when unset.
export const getBusinessInfo = wrap(async function getBusinessInfo(req, res, next, db = prisma) {
  const business = await db.businessInfo.findUnique({ where: { id: BUSINESS_INFO_ID } });
  res.json({ business });
});

// ---- Admin ----
// Return the current singleton (may be null before first save).
export const adminGetBusinessInfo = wrap(async function adminGetBusinessInfo(req, res, next, db = prisma) {
  const business = await db.businessInfo.findUnique({ where: { id: BUSINESS_INFO_ID } });
  res.json({ business });
});

// Full upsert of the singleton. Validates every field first.
export const adminPutBusinessInfo = wrap(async function adminPutBusinessInfo(req, res, next, db = prisma) {
  const { error, data } = normalizeBusinessInput(req.body || {});
  if (error) return badRequest(res, error);

  const business = await db.businessInfo.upsert({
    where: { id: BUSINESS_INFO_ID },
    update: data,
    create: data,
  });
  res.json({ business });
});