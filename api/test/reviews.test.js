import test from "node:test";
import assert from "node:assert/strict";
import router from "../src/routes/index.js";
import { authenticate, requireAdmin, requireCustomer } from "../src/middleware/auth.js";
import { REVIEW_STATUS } from "../src/config.js";
import {
  listPublicReviews,
  listMyReviews,
  createReview,
  adminListReviews,
  adminSetReviewStatus,
} from "../src/controllers/reviews.js";

const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

const P2025 = () => { const e = new Error("Record not found"); e.code = "P2025"; return e; };
const P2002 = () => { const e = new Error("Unique constraint failed"); e.code = "P2002"; return e; };

const reviewFixture = (overrides = {}) => ({
  id: "rv1",
  rating: 5,
  title: "Great job",
  body: "Spotless windows, on time, friendly.",
  status: "approved",
  customerId: "cus1",
  bookingId: "bk1",
  serviceId: "svc",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  customer: { id: "cus1", name: "Alice" },
  service: { name: "Window Cleaning" },
  ...overrides,
});

const bookingFixture = (overrides = {}) => ({
  id: "bk1",
  customerId: "cus1",
  serviceId: "svc",
  date: new Date("2026-09-10T00:00:00Z"),
  status: "worked",
  price: 120,
  archivedAt: null,
  review: null,
  ...overrides,
});

// In-memory fake of prisma.review (+ booking/relations) with real P2002/P2025
// semantics. Rows may embed their `customer`/`service` relation shapes (as the
// makeDb conventions in content.test.js do); the fake never joins, it simply
// returns stored rows, honoring scalar where-filters and createdAt ordering.
const makeDb = ({ reviews = [], bookings = [] } = {}) => {
  const reviewRows = reviews.map((r) => ({ ...r }));
  const bookingRows = bookings.map((b) => ({ ...b }));
  let seq = reviewRows.length;
  return {
    review: {
      findMany: async ({ where = {}, orderBy } = {}) => {
        const out = reviewRows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
        if (orderBy) {
          const key = Object.keys(orderBy)[0];
          const dir = orderBy[key];
          out.sort((a, b) => (dir === "desc" ? b[key] - a[key] : a[key] - b[key]));
        }
        return out;
      },
      findUnique: async ({ where } = {}) => reviewRows.find((r) => r.id === where.id) ?? null,
      create: async ({ data }) => {
        // DB-level one-review-per-booking (mirrors the UNIQUE "bookingId")
        if (reviewRows.some((r) => r.bookingId === data.bookingId)) throw P2002();
        const r = {
          id: `rv${++seq}`,
          createdAt: new Date("2026-09-20T00:00:00Z"),
          updatedAt: new Date("2026-09-20T00:00:00Z"),
          ...data,
        };
        reviewRows.push(r);
        return r;
      },
      update: async ({ where, data }) => {
        const i = reviewRows.findIndex((r) => r.id === where.id);
        if (i < 0) throw P2025();
        reviewRows[i] = { ...reviewRows[i], ...data, updatedAt: new Date("2026-09-21T00:00:00Z") };
        return reviewRows[i];
      },
    },
    booking: {
      findUnique: async ({ where } = {}) => bookingRows.find((b) => b.id === where.id) ?? null,
    },
  };
};

// ---- Public: GET /reviews ----

test("public endpoint returns approved reviews only", async () => {
  const db = makeDb({
    reviews: [
      reviewFixture({ id: "a", status: "approved" }),
      reviewFixture({ id: "b", status: "pending" }),
      reviewFixture({ id: "c", status: "rejected" }),
    ],
  });
  const res = response();
  await listPublicReviews({ query: {} }, res, db);
  assert.deepEqual(res.body.reviews.map((r) => r.id), ["a"]);
});

test("pending reviews are excluded from the public endpoint", async () => {
  const db = makeDb({ reviews: [reviewFixture({ id: "p", status: "pending" })] });
  const res = response();
  await listPublicReviews({ query: {} }, res, db);
  assert.deepEqual(res.body.reviews, []);
});

test("rejected reviews are excluded from the public endpoint", async () => {
  const db = makeDb({ reviews: [reviewFixture({ id: "x", status: "rejected" })] });
  const res = response();
  await listPublicReviews({ query: {} }, res, db);
  assert.deepEqual(res.body.reviews, []);
});

test("public endpoint returns newest approved reviews first", async () => {
  const db = makeDb({
    reviews: [
      reviewFixture({ id: "old", createdAt: new Date("2026-09-01T00:00:00Z") }),
      reviewFixture({ id: "new", createdAt: new Date("2026-09-20T00:00:00Z") }),
      reviewFixture({ id: "mid", createdAt: new Date("2026-09-10T00:00:00Z") }),
    ],
  });
  const res = response();
  await listPublicReviews({ query: {} }, res, db);
  assert.deepEqual(res.body.reviews.map((r) => r.id), ["new", "mid", "old"]);
});

test("public endpoint returns safe customer display name and service name", async () => {
  const db = makeDb({ reviews: [reviewFixture({ customer: { id: "cus1", name: "Alice" }, service: { name: "Window Cleaning" } })] });
  const res = response();
  await listPublicReviews({ query: {} }, res, db);
  assert.equal(res.body.reviews[0].customer.name, "Alice");
  assert.equal(res.body.reviews[0].service.name, "Window Cleaning");
});

test("public endpoint never exposes private customer fields or credentials", async () => {
  const db = makeDb({
    reviews: [
      reviewFixture({
        customer: { id: "cus1", name: "Alice", email: "a@x.com", phone: "555-1234", address: "1 Main St" },
      }),
    ],
  });
  const res = response();
  await listPublicReviews({ query: {} }, res, db);
  const payload = JSON.stringify(res.body);
  for (const forbidden of ["email", "phone", "address", "password", "secret", "token", "credential"]) {
    assert.ok(!payload.toLowerCase().includes(forbidden.toLowerCase()), `public payload must not contain ${forbidden}`);
  }
  assert.equal(res.body.reviews[0].customer.email, undefined);
  assert.equal(res.body.reviews[0].customer.phone, undefined);
  assert.equal(res.body.reviews[0].customer.address, undefined);
});

test("public endpoint supports serviceId filtering", async () => {
  const db = makeDb({
    reviews: [
      reviewFixture({ id: "w", serviceId: "svcW" }),
      reviewFixture({ id: "s", serviceId: "svcS" }),
    ],
  });
  const res = response();
  await listPublicReviews({ query: { serviceId: "svcS" } }, res, db);
  assert.deepEqual(res.body.reviews.map((r) => r.id), ["s"]);
});

test("public endpoint returns an empty list with the expected shape", async () => {
  const res = response();
  await listPublicReviews({ query: {} }, res, makeDb());
  assert.deepEqual(res.body.reviews, []);
});

test("public endpoint rejects an invalid serviceId type", async () => {
  const res = response();
  await listPublicReviews({ query: { serviceId: 42 } }, res, makeDb());
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "serviceId must be a string");
});

test("public reviews route is registered without any auth middleware", () => {
  const route = findRoute("/reviews", "get");
  assert.ok(route, "GET /reviews route should be registered");
  const handles = route.stack.map((layer) => layer.handle);
  assert.equal(handles.length, 1);
  assert.equal(handles[0], listPublicReviews);
});

// ---- Customer ----

test("unauthenticated create is blocked with 401", async () => {
  const res = response();
  await requireCustomer({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("non-customer is blocked from customer review routes with 403", async () => {
  const res = response();
  await requireCustomer({ user: { role: "admin" } }, res, () => assert.fail("admin should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
});

test("customer cannot review another customer's booking", async () => {
  const db = makeDb({ bookings: [bookingFixture({ customerId: "cus1" })] });
  const res = response();
  await createReview(
    { user: { id: "cus2" }, body: { bookingId: "bk1", rating: 5, body: "Good" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /own bookings/);
});

test("customer cannot review a pending booking", async () => {
  const db = makeDb({ bookings: [bookingFixture({ status: "pending" })] });
  const res = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body: "Good" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /worked/);
});

test("customer cannot review an accepted booking", async () => {
  const db = makeDb({ bookings: [bookingFixture({ status: "accepted" })] });
  const res = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body: "Good" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /worked/);
});

test("customer cannot review a declined booking", async () => {
  const db = makeDb({ bookings: [bookingFixture({ status: "declined" })] });
  const res = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body: "Good" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /worked/);
});

test("customer can review a worked booking (201, serviceId from the booking)", async () => {
  const db = makeDb({ bookings: [bookingFixture({ id: "bk1", customerId: "cus1", serviceId: "svc", status: "worked" })] });
  const res = response();
  await createReview(
    { user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, title: "  Sparkling  ", body: " Perfect. " } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.review.rating, 5);
  assert.equal(res.body.review.title, "Sparkling");
  assert.equal(res.body.review.body, "Perfect.");
  assert.equal(res.body.review.bookingId, "bk1");
  assert.equal(res.body.review.serviceId, "svc");
  assert.equal(res.body.review.customerId, "cus1");
});

test("archived worked booking remains reviewable", async () => {
  const db = makeDb({ bookings: [bookingFixture({ status: "worked", archivedAt: new Date("2026-09-12T00:00:00Z") })] });
  const res = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 4, body: "Still great" } }, res, db);
  assert.equal(res.statusCode, 201);
});

test("customerId comes from authentication, never from the request body", async () => {
  const db = makeDb({ bookings: [bookingFixture({ customerId: "cus1" })] });
  const res = response();
  await createReview(
    { user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body: "Good", customerId: "mallory" } },
    res,
    db,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.review.customerId, "cus1");
});

test("a second review for the same booking is rejected (friendly 400, not a raw DB error)", async () => {
  const db = makeDb({ bookings: [bookingFixture({ customerId: "cus1" })] });
  const first = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body: "First" } }, first, db);
  assert.equal(first.statusCode, 201);

  const second = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 4, body: "Second" } }, second, db);
  assert.equal(second.statusCode, 400);
  assert.match(second.body.error, /already been reviewed/);
  assert.equal(second.body.error.match(/Unique constraint/), null);
});

test("a booking that already carries a review is rejected up-front", async () => {
  const db = makeDb({ bookings: [bookingFixture({ review: { id: "existing" } })] });
  const res = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body: "Good" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /already been reviewed/);
});

test("invalid rating values are rejected", async () => {
  const db = makeDb({ bookings: [bookingFixture()] });
  for (const rating of [0, 6]) {
    const res = response();
    await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating, body: "Good" } }, res, db);
    assert.equal(res.statusCode, 400, `rating ${rating} should be rejected`);
    assert.match(res.body.error, /integer from 1 to 5/);
  }
});

test("non-integer ratings are rejected", async () => {
  const db = makeDb({ bookings: [bookingFixture()] });
  for (const rating of [2.5, "5"]) {
    const res = response();
    await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating, body: "Good" } }, res, db);
    assert.equal(res.statusCode, 400, `rating ${rating} should be rejected`);
  }
});

test("missing or empty body is rejected", async () => {
  const db = makeDb({ bookings: [bookingFixture()] });
  for (const body of [undefined, "", "   "]) {
    const res = response();
    await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body } }, res, db);
    assert.equal(res.statusCode, 400, "missing/empty body should be rejected");
    assert.equal(res.body.error, "body is required");
  }
});

test("invalid or oversized title/body text is rejected", async () => {
  const db = makeDb({ bookings: [bookingFixture()] });
  const hugeTitle = "t".repeat(121);
  const hugeBody = "b".repeat(2001);

  const title = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, title: hugeTitle, body: "Good" } }, title, db);
  assert.equal(title.statusCode, 400);
  assert.match(title.body.error, /title must be 120/);

  const body = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body: hugeBody } }, body, db);
  assert.equal(body.statusCode, 400);
  assert.match(body.body.error, /body must be 2000/);

  const badType = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, title: 42, body: "Good" } }, badType, db);
  assert.equal(badType.statusCode, 400);
  assert.match(badType.body.error, /title must be a string/);
});

test("newly created review always starts with pending status", async () => {
  const db = makeDb({ bookings: [bookingFixture()] });
  const res = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "bk1", rating: 5, body: "Good" } }, res, db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.review.status, "pending");
});

test("create review returns 404 when the booking does not exist", async () => {
  const res = response();
  await createReview({ user: { id: "cus1" }, body: { bookingId: "ghost", rating: 5, body: "Good" } }, res, makeDb());
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Booking not found");
});

test("GET /reviews/mine returns only the authenticated customer's reviews, newest first", async () => {
  const db = makeDb({
    reviews: [
      reviewFixture({ id: "mineA", customerId: "cus1", createdAt: new Date("2026-09-01T00:00:00Z") }),
      reviewFixture({ id: "mineB", customerId: "cus1", status: "pending", createdAt: new Date("2026-09-15T00:00:00Z") }),
      reviewFixture({ id: "otherC", customerId: "cus2", createdAt: new Date("2026-09-10T00:00:00Z") }),
    ],
  });
  const res = response();
  await listMyReviews({ user: { id: "cus1" } }, res, db);
  assert.deepEqual(res.body.reviews.map((r) => r.id), ["mineB", "mineA"]);
  assert.equal(res.body.reviews.some((r) => r.customerId === "cus2"), false);
});

test("customer review routes are registered behind authenticate + requireCustomer", () => {
  const routes = [
    ["/reviews/mine", "get", listMyReviews],
    ["/reviews", "post", createReview],
  ];
  for (const [path, method, handler] of routes) {
    const route = findRoute(path, method);
    assert.ok(route, `${method.toUpperCase()} ${path} should be registered`);
    const handles = route.stack.map((layer) => layer.handle);
    assert.equal(handles[0], authenticate);
    assert.equal(handles[1], requireCustomer);
    assert.equal(handles[2], handler);
  }
});

// ---- Admin ----

test("unauthenticated admin review endpoint is blocked with 401", async () => {
  const res = response();
  await requireAdmin({}, res, () => assert.fail("anonymous should not reach the endpoint"));
  assert.equal(res.statusCode, 401);
});

test("non-admin is blocked from admin review endpoints with 403", async () => {
  const res = response();
  await requireAdmin({ user: { role: "customer" } }, res, () => assert.fail("customer should not reach the endpoint"));
  assert.equal(res.statusCode, 403);
});

test("admin can list all reviews for moderation, newest first, with safe info", async () => {
  const db = makeDb({
    reviews: [
      reviewFixture({ id: "old", status: "approved", createdAt: new Date("2026-09-01T00:00:00Z") }),
      reviewFixture({ id: "new", status: "pending", createdAt: new Date("2026-09-20T00:00:00Z") }),
      reviewFixture({ id: "x", status: "rejected", createdAt: new Date("2026-09-10T00:00:00Z") }),
    ],
  });
  const res = response();
  await adminListReviews({ query: {} }, res, db);
  assert.deepEqual(res.body.reviews.map((r) => r.id), ["new", "x", "old"]);
  assert.deepEqual(new Set(res.body.reviews.map((r) => r.status)), new Set(REVIEW_STATUS));
  assert.equal(res.body.reviews[0].customer.name, "Alice");
  assert.equal(res.body.reviews[0].service.name, "Window Cleaning");
});

test("admin status filtering returns only matching reviews", async () => {
  const db = makeDb({
    reviews: [
      reviewFixture({ id: "pa", status: "pending" }),
      reviewFixture({ id: "pb", status: "pending" }),
      reviewFixture({ id: "ap", status: "approved" }),
    ],
  });
  const res = response();
  await adminListReviews({ query: { status: "pending" } }, res, db);
  assert.deepEqual(res.body.reviews.map((r) => r.id).sort(), ["pa", "pb"]);
});

test("admin service filtering returns only matching reviews", async () => {
  const db = makeDb({
    reviews: [
      reviewFixture({ id: "w", serviceId: "svcW" }),
      reviewFixture({ id: "s", serviceId: "svcS" }),
    ],
  });
  const res = response();
  await adminListReviews({ query: { serviceId: "svcW" } }, res, db);
  assert.deepEqual(res.body.reviews.map((r) => r.id), ["w"]);
});

test("invalid admin status filter is rejected", async () => {
  const res = response();
  await adminListReviews({ query: { status: "bogus" } }, res, makeDb());
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "status must be pending | approved | rejected");
});

test("invalid status on PATCH is rejected", async () => {
  const db = makeDb({ reviews: [reviewFixture()] });
  const res = response();
  await adminSetReviewStatus({ params: { id: "rv1" }, body: { status: "bogus" } }, res, db);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "status must be pending | approved | rejected");
});

test("admin can approve a review", async () => {
  const db = makeDb({ reviews: [reviewFixture({ id: "rv1", status: "pending" })] });
  const res = response();
  await adminSetReviewStatus({ params: { id: "rv1" }, body: { status: "approved" } }, res, db);
  assert.equal(res.body.review.status, "approved");
  assert.equal(res.body.review.id, "rv1");
});

test("admin can reject a review", async () => {
  const db = makeDb({ reviews: [reviewFixture({ id: "rv1", status: "pending" })] });
  const res = response();
  await adminSetReviewStatus({ params: { id: "rv1" }, body: { status: "rejected" } }, res, db);
  assert.equal(res.body.review.status, "rejected");
});

test("admin can set a review status back to pending", async () => {
  const db = makeDb({ reviews: [reviewFixture({ id: "rv1", status: "pending" })] });
  const approved = response();
  await adminSetReviewStatus({ params: { id: "rv1" }, body: { status: "approved" } }, approved, db);
  assert.equal(approved.body.review.status, "approved");

  const backToPending = response();
  await adminSetReviewStatus({ params: { id: "rv1" }, body: { status: "pending" } }, backToPending, db);
  assert.equal(backToPending.body.review.status, "pending");
});

test("admin PATCH on a missing review returns 404", async () => {
  const res = response();
  await adminSetReviewStatus({ params: { id: "ghost" }, body: { status: "approved" } }, res, makeDb());
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Review not found");
});

test("admin review routes are registered behind authenticate + requireAdmin", () => {
  const routes = [
    ["/admin/reviews", "get", adminListReviews],
    ["/admin/reviews/:id/status", "patch", adminSetReviewStatus],
  ];
  for (const [path, method, handler] of routes) {
    const route = findRoute(path, method);
    assert.ok(route, `${method.toUpperCase()} ${path} should be registered`);
    const handles = route.stack.map((layer) => layer.handle);
    assert.equal(handles[0], authenticate);
    assert.equal(handles[1], requireAdmin);
    assert.equal(handles[2], handler);
  }
});

// ---- Misc ----

test("review statuses are exactly pending | approved | rejected", () => {
  assert.deepEqual(REVIEW_STATUS, ["pending", "approved", "rejected"]);
});

function findRoute(path, method) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path) {
      if (!method || layer.route.methods[method]) return layer.route;
    }
  }
  return null;
}