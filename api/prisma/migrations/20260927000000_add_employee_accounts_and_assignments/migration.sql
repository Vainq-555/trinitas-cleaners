-- Employee System Phase 2A — EMPLOYEE ACCOUNT FOUNDATION + ASSIGNMENT MODEL.
--
-- STRICTLY ADDITIVE, in the same style as
-- 20260926000000_add_service_location_schedule:
--   * 1 nullable ADD COLUMN on the existing User table
--   * 2 new tables
--   * new indexes + foreign keys
-- No DROP COLUMN, no DROP TABLE, no data rewrite, no native enum, and no
-- change to any existing customer/admin record. Every existing row stays valid
-- and untouched (User.disabledAt is NULL for all of them, which is defined as
-- "account not disabled").
--
-- 1) User.disabledAt — the EMPLOYEE ACCOUNT LIFECYCLE, deliberately separate
--    from User.status, which stays presence-only (online/offline heartbeat).
--    NULL = account enabled, non-NULL = account disabled by an admin.
--    Disabling never deletes the user and never cascades; the employee's
--    identity, assignments and history all remain. It is re-read from the
--    database on every authenticated request (never cached in the JWT), so a
--    disable immediately invalidates existing sessions.
--
-- 2) EmployeeInvitation — dedicated single-use, expiring employee invitation
--    token. Kept SEPARATE from PasswordResetToken so the security semantics are
--    unambiguous; only the token digest is stored.
--
-- 3) BookingAssignment — which employee performs a customer's booking.
--    CRITICAL: Booking.customerId is NOT touched and NOT repurposed here, and
--    Booking.scheduledStartAt (the customer's requested schedule) is NOT
--    overwritten. The employee's own schedule is BookingAssignment
--    .scheduledStartAt, so the two concepts remain separate.
--    Referential safety: employeeId and assignedById are nullable with
--    ON DELETE SET NULL, so removing an employee (or the admin who assigned the
--    work) can never delete a booking, receipt, customer or any history. Only
--    the assignment's own booking uses ON DELETE CASCADE, which removes at most
--    the assignment row.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmployeeInvitation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAssignment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "employeeId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledStartAt" TIMESTAMP(3),
    "visibleToEmployee" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeInvitation_tokenHash_key" ON "EmployeeInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "EmployeeInvitation_userId_idx" ON "EmployeeInvitation"("userId");

-- CreateIndex
CREATE INDEX "EmployeeInvitation_expiresAt_idx" ON "EmployeeInvitation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingAssignment_bookingId_key" ON "BookingAssignment"("bookingId");

-- CreateIndex
CREATE INDEX "BookingAssignment_employeeId_idx" ON "BookingAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "BookingAssignment_assignedById_idx" ON "BookingAssignment"("assignedById");

-- AddForeignKey
ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAssignment" ADD CONSTRAINT "BookingAssignment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAssignment" ADD CONSTRAINT "BookingAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAssignment" ADD CONSTRAINT "BookingAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
