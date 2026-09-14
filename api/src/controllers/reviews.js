import prisma from "../utils/prisma.js";
import {
  badRequest,
  isValidRating,
  isValidReviewBody,
  isValidReviewStatus,
  isValidReviewTitle,
  REVIEW_BODY_MAX_LENGTH,
  REVIEW_TITLE_MAX_LENGTH,
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

const reviewInclude = {
  customer: { select: { id: true, name: true } },
  service: { select: { name: true } },
};

// Public whitelist: new reviews stay hidden until an admin approves them, and
// even approved reviews expose only id, rating, title, body, createdAt, the
// customer's display name, and the service name. Never email/phone/address.
const publicShape = (r) => ({
  id: r.id,
  rating: r.rating,
  title: r.title ?? null,
  body: r.body,
  createdAt: r.createdAt,
  customer: { name: r.customer?.name ?? null },
  service: { name: r.service?.name ?? null },
});

// Customer + admin shapes add the moderation status and the review's own
// booking/service references so the owner and the moderator can act on it.
// No email/phone/address is ever included.
const ownerShape = (r) => ({
  id: r.id,
  rating: r.rating,
  title: r.title ?? null,
  body: r.body,
  status: r.status,
  customerId: r.customerId,
  bookingId: r.bookingId,
  serviceId: r.serviceId,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  customer: { id: r.customer?.id ?? null, name: r.customer?.name ?? null },
  service: { name: r.service?.name ?? null },
});

// ---- Public main site ----
// Only approved reviews, newest first. Optional ?serviceId=<id> filters to a
// single service. No authentication required.
export const listPublicReviews = wrap(async function listPublicReviews(req, res, next, db = prisma) {
  const serviceId = req.query?.serviceId;
  if (serviceId !== undefined && serviceId !== null && (typeof serviceId !== "string" || !serviceId.trim())) {
    return badRequest(res, "serviceId must be a string");
  }
  const where = { status: "approved" };
  if (serviceId) where.serviceId = serviceId;

  const reviews = await db.review.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: reviewInclude,
  });
  res.json({ reviews: reviews.map(publicShape) });
});

// ---- Customer side ----

export const listMyReviews = wrap(async function listMyReviews(req, res, next, db = prisma) {
  const reviews = await db.review.findMany({
    where: { customerId: req.user.id },
    orderBy: { createdAt: "desc" },
    include: reviewInclude,
  });
  res.json({ reviews: reviews.map(ownerShape) });
});

// Create a review for a completed booking. Ownership, reviewability, and the
// one-review-per-booking rule are all enforced server-side; customerId is taken
// from the authenticated session, never from the request body.
export const createReview = wrap(async function createReview(req, res, next, db = prisma) {
  const { bookingId, rating, title, body } = req.body || {};

  if (!isValidRating(rating)) return badRequest(res, "rating must be an integer from 1 to 5");
  if (typeof body !== "string" || !body.trim()) return badRequest(res, "body is required");
  if (!isValidReviewBody(body)) return badRequest(res, `body must be ${REVIEW_BODY_MAX_LENGTH} characters or fewer`);
  if (title !== undefined && title !== null && typeof title !== "string") {
    return badRequest(res, "title must be a string");
  }
  if (typeof title === "string" && title.trim() && !isValidReviewTitle(title)) {
    return badRequest(res, `title must be ${REVIEW_TITLE_MAX_LENGTH} characters or fewer`);
  }

  const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { review: true } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.customerId !== req.user.id) {
    return res.status(403).json({ error: "You can only review your own bookings" });
  }
  // Only completed (worked) bookings are reviewable. Deliberately ignores
  // archivedAt: archived worked bookings remain reviewable.
  if (booking.status !== "worked") {
    return badRequest(res, "Only completed (worked) bookings can be reviewed");
  }
  if (booking.review) return badRequest(res, "This booking has already been reviewed");

  let review;
  try {
    review = await db.review.create({
      data: {
        rating,
        title: typeof title === "string" ? title.trim() || null : null,
        body: body.trim(),
        status: "pending", // new reviews always start pending
        customerId: req.user.id,
        bookingId: booking.id,
        serviceId: booking.serviceId, // snapshot/reference tied to the reviewed booking
      },
    });
  } catch (error) {
    if (error && error.code === "P2002") {
      return badRequest(res, "This booking has already been reviewed");
    }
    throw error;
  }

  const created = await db.review.findUnique({ where: { id: review.id }, include: reviewInclude });
  res.status(201).json({ review: ownerShape(created) });
});

// ---- Admin side ----
// Moderation list: all statuses, newest first, with optional ?status=pending
// and ?serviceId=<id> filters.
export const adminListReviews = wrap(async function adminListReviews(req, res, next, db = prisma) {
  const { status, serviceId } = req.query || {};
  const where = {};
  if (status !== undefined) {
    if (!isValidReviewStatus(status)) return badRequest(res, "status must be pending | approved | rejected");
    where.status = status;
  }
  if (serviceId !== undefined) {
    if (typeof serviceId !== "string" || !serviceId.trim()) return badRequest(res, "serviceId must be a string");
    where.serviceId = serviceId;
  }

  const reviews = await db.review.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: reviewInclude,
  });
  res.json({ reviews: reviews.map(ownerShape) });
});

// Admin sets a review's moderation status (pending | approved | rejected).
export const adminSetReviewStatus = wrap(async function adminSetReviewStatus(req, res, next, db = prisma) {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!isValidReviewStatus(status)) return badRequest(res, "status must be pending | approved | rejected");

  const existing = await db.review.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Review not found" });

  const updated = await db.review.update({ where: { id }, data: { status } });
  const review = await db.review.findUnique({ where: { id: updated.id }, include: reviewInclude });
  res.json({ review: ownerShape(review) });
});