-- Additive: archivedAt column on Booking.
-- A Worked booking may be archived (archivedAt set) rather than hard-deleted.
-- Archived bookings are excluded from normal customer/admin booking lists.

ALTER TABLE "Booking" ADD COLUMN "archivedAt" TIMESTAMP(3);