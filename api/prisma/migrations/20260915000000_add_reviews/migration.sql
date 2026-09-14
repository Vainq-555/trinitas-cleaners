-- Additive: introduce the Review model (customer ratings on completed
-- bookings). New reviews start as "pending"; only "approved" reviews are ever
-- exposed by the public API. At most one review per booking is enforced by the
-- UNIQUE constraint on bookingId.
--
-- This migration creates only the Review table. No existing table or column
-- is altered and no existing data is touched.

CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- One review per booking (matches Prisma @unique on bookingId; P2002 is mapped
-- to a friendly client error in the controller).
CREATE UNIQUE INDEX "Review_bookingId_key" ON "Review"("bookingId");

-- Moderation queue, per-service public filtering, and "my reviews" lookups.
CREATE INDEX "Review_status_idx" ON "Review"("status");
CREATE INDEX "Review_serviceId_idx" ON "Review"("serviceId");
CREATE INDEX "Review_customerId_idx" ON "Review"("customerId");

-- Ownership cascades follow the existing project conventions: deleting a
-- customer account removes their reviews (User owns all of its children),
-- and deleting a Booking/Service removes its dependent reviews (Booking ->
-- Payment and Service -> CustomPrice already cascade the same way).
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId")
  REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_serviceId_fkey" FOREIGN KEY ("serviceId")
  REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;