-- Employee leave requests.
--
-- STRICTLY ADDITIVE, in the same style as
-- 20260927000000_add_employee_accounts_and_assignments,
-- 20260927010000_add_broadcast_audience,
-- 20260927020000_add_employee_availability_and_shifts and
-- 20260927030000_add_employee_community:
--   * 1 new table
--   * its indexes and foreign keys
--   * ZERO changes to any existing table, column, row or constraint
--
-- There is no ALTER TABLE against a PRE-EXISTING table anywhere in this file. The
-- two ALTER TABLE statements below both target "EmployeeLeaveRequest", the table
-- created moments earlier in this same file; the only pre-existing objects
-- referenced are "User", which is read as an FK target and never written. No DROP,
-- no data rewrite, no native enum, and no change to any existing
-- customer/admin/employee/payment record.
--
-- WHY A NEW TABLE (and not a new column or a repurposed model)
-- -------------------------------------------------------
-- Inspection found no existing model for leave, absence, vacation or time off, and
-- nothing that could be repurposed:
--   * User is the account/identity record. Its `status` is presence-only
--     ("online"/"offline" heartbeat) and must never express leave; its `disabledAt`
--     is the account lifecycle, which an employee cannot set for themselves.
--   * EmployeeAvailability is the employee's own stated PREFERENCE ("when I can
--     work"). Leave is a REQUEST FOR TIME OFF THAT ONLY AN ADMIN DECIDES. Writing
--     leave into availability would make an admin decision indistinguishable from a
--     self-declared preference and would let the two silently overwrite each other.
--     They therefore stay separate systems with separate tables.
--   * ShiftOffer/ShiftRequest are about a specific booking's work, and
--     BookingAssignment is the sole source of truth for real work. Leave never
--     creates, removes or reassigns work, so none of those models can represent it.
--
-- 1) "EmployeeLeaveRequest" — one employee's request to be off for a span of days.
--    * employeeId FK ON DELETE CASCADE, matching ShiftRequest.employeeId: a request
--      is meaningless without its employee. This destroys no history, because an
--      employee User row is NEVER deleted — DELETE /auth/account refuses employee
--      accounts, and the admin-only disable clears disabledAt rather than removing
--      the row — so an employee's assignments and work history can never cascade
--      away. (Deliberately different from BookingAssignment, which uses SET NULL so
--      real work is never destroyed.)
--    * decidedById FK ON DELETE SET NULL, matching ShiftRequest.decidedById:
--      removing the deciding admin keeps the decision and its timestamp.
--    * startsOn/endsOn are America/Chicago WALL-CLOCK "YYYY-MM-DD" strings, matching
--      EmployeeAvailability.date and the customer appointment convention. A leave
--      day is a day, not an instant, so the wall clock the employee wrote is stored
--      verbatim rather than lossily converted to a UTC instant (which could shift a
--      leave across a day boundary). Both ends are inclusive, so startsOn = endsOn
--      is a genuine one-day leave.
--    * kind and note are NULLABLE: a request with no kind and no note is a complete,
--      valid request ("I am off these days"). The kind buckets live in
--      config.js (LEAVE_KIND) and are validated in the API, so this column cannot
--      become unbounded free text.
--    * status defaults to 'requested'. A request is only ever 'requested' on
--      creation; only an admin approve/decline moves it to 'approved' or 'declined',
--      and a decided request can never be re-decided. The decision is recorded in
--      decidedAt/decidedById from the authenticated admin session, never from a
--      client field.
--    * (employeeId, status) is the index the employee's own portal list reads on
--      every load; status is the admin's pending-first queue.
--
-- UNCHANGED BY THIS MIGRATION: User (including `status` and `disabledAt`),
-- EmployeeAvailability, ShiftOffer, ShiftRequest, BookingAssignment (still the sole
-- source of truth for work), Booking, every Stripe/payment table, and every
-- existing row of every existing table.

-- CreateTable
CREATE TABLE "EmployeeLeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "kind" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeLeaveRequest_employeeId_status_idx" ON "EmployeeLeaveRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "EmployeeLeaveRequest_status_idx" ON "EmployeeLeaveRequest"("status");

-- AddForeignKey
ALTER TABLE "EmployeeLeaveRequest" ADD CONSTRAINT "EmployeeLeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeaveRequest" ADD CONSTRAINT "EmployeeLeaveRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
