-- Additive: per-booking SERVICE LOCATION (WHERE the work happens) and the
-- SCHEDULED START date/time (WHEN, chosen by the customer in America/Chicago
-- and stored as a UTC instant). STRICTLY additive: stock column additions on
-- the existing Booking table only. No drops, no data rewrites, no enums.
-- Existing bookings get NULL and remain valid (no fabricated times).

ALTER TABLE "Booking"
ADD COLUMN "serviceLocationAddressLine1" TEXT,
ADD COLUMN "serviceLocationAddressLine2" TEXT,
ADD COLUMN "serviceLocationCity" TEXT,
ADD COLUMN "serviceLocationState" TEXT,
ADD COLUMN "serviceLocationPostalCode" TEXT,
ADD COLUMN "serviceLocationCountry" TEXT,
ADD COLUMN "serviceLocationInstructions" TEXT,
ADD COLUMN "scheduledStartAt" TIMESTAMP(3);