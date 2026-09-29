-- Employee System Phase 2B-4 — AVAILABILITY + AVAILABLE SHIFTS.
--
-- STRICTLY ADDITIVE, in the same style as
-- 20260927000000_add_employee_accounts_and_assignments and
-- 20260927010000_add_broadcast_audience:
--   * 3 new tables
--   * their indexes, unique constraints and foreign keys
--   * ZERO changes to any existing table, column, row or constraint
--
-- There is no ALTER TABLE against an existing table anywhere in this file: the
-- only pre-existing objects referenced are "User" and "Booking", which are read
-- (FK targets) but never written. No DROP, no data rewrite, no native enum, and
-- no change to any existing customer/admin/payment record.
--
-- WHY NEW TABLES (and not a new column somewhere)
-- ---------------------------------------------
-- Inspection found no existing model for availability, shifts or shift
-- requests, and no existing model could be repurposed:
--   * Booking holds customer work, not employee availability, and adding
--     employee fields to it would put employee data on the customer record.
--   * BookingAssignment is the SOURCE OF TRUTH FOR ACTUAL WORK and is 1:1 with
--     a booking (bookingId @unique). A "shift" here is NOT an assignment — an
--     employee merely requests one — so writing offers into BookingAssignment
--     would fabricate work assignments that nobody approved.
-- Three genuinely new tables are therefore the minimum, and none of them
-- duplicates an existing one: a ShiftOffer POINTS at an existing Booking and
-- always reads service/date/location through that relation, so a shift can never
-- disagree with the booking it advertises.
--
-- 1) "EmployeeAvailability" — one "I can work this window" entry.
--    * employeeId FK ON DELETE CASCADE: availability is the employee's own
--      preference data with no operational history, so it is removed with the
--      account. (Deliberately different from BookingAssignment, which uses
--      SET NULL so real work is never destroyed.)
--    * The composite UNIQUE (employeeId, date, startTime, endTime, kind) stops
--      the same window being saved twice by accident while still permitting
--      several different windows on one day. (Unlike the availability of a
--      shared resource, a duplicate here is pure noise — it would double every
--      count and read to the employee as a mistake.)
--    * date/startTime/endTime are America/Chicago WALL-CLOCK strings, matching
--      the customer appointment convention in utils/schedule.js. Availability is
--      a stated preference, so the wall clock the employee wrote is stored
--      verbatim rather than lossily converted to a UTC instant.
--    * Strings, not enums, matching the documented schema-wide convention.
--
-- 2) "ShiftOffer" — an admin-published offer for an existing booking.
--    * bookingId UNIQUE + FK ON DELETE CASCADE: at most one pool offer per
--      booking, so the same work can never be double-published, and an offer
--      can never outlive the booking it advertises.
--    * publishedAt NULL = created but CLOSED/unpublished, and therefore
--      invisible to employees. Publication is a stored state rather than a
--      client flag, so an employee can never "see" an unpublished shift by
--      editing a request.
--    * createdById FK ON DELETE SET NULL: removing the publishing admin must not
--      unpublish the shift other employees are looking at.
--    * There is NO admin-only notes column on purpose. `notes` is the
--      employee-facing instruction field and is the only text on this table, so
--      a private admin note cannot leak into an employee's shift by someone
--      later forgetting to filter it out.
--
-- 3) "ShiftRequest" — one employee's request for one published shift.
--    * The UNIQUE (shiftId, employeeId) is the duplicate-request guard enforced
--      by the database, not by a read-then-write check that two concurrent
--      requests could both pass.
--    * FKs ON DELETE CASCADE: a request is meaningless without its shift or its
--      employee. decidedById is SET NULL so removing the deciding admin keeps
--      the decision and its timestamp.
--    * status defaults to 'requested'. A request NEVER assigns anybody: the
--      only thing that creates real work is a BookingAssignment, still written
--      exclusively by the existing admin assignment path.
--
-- UNCHANGED BY THIS MIGRATION: BookingAssignment (still the sole source of
-- truth for work), Booking.customerId, Booking.scheduledStartAt, every
-- Stripe/payment table, and every existing row of every existing table.

-- CreateTable
CREATE TABLE "EmployeeAvailability" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'available',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftOffer" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "notes" TEXT,
    "closesAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRequest" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAvailability_employeeId_date_startTime_endTime_kind_key" ON "EmployeeAvailability"("employeeId", "date", "startTime", "endTime", "kind");

-- CreateIndex
CREATE INDEX "EmployeeAvailability_employeeId_date_idx" ON "EmployeeAvailability"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftOffer_bookingId_key" ON "ShiftOffer"("bookingId");

-- CreateIndex
CREATE INDEX "ShiftOffer_publishedAt_idx" ON "ShiftOffer"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRequest_shiftId_employeeId_key" ON "ShiftRequest"("shiftId", "employeeId");

-- CreateIndex
CREATE INDEX "ShiftRequest_employeeId_status_idx" ON "ShiftRequest"("employeeId", "status");

-- AddForeignKey
ALTER TABLE "EmployeeAvailability" ADD CONSTRAINT "EmployeeAvailability_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRequest" ADD CONSTRAINT "ShiftRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ShiftOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRequest" ADD CONSTRAINT "ShiftRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRequest" ADD CONSTRAINT "ShiftRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
