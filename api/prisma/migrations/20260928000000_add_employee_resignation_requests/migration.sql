-- Employee resignation requests.
--
-- STRICTLY ADDITIVE, in the same style as
-- 20260927000000_add_employee_accounts_and_assignments,
-- 20260927020000_add_employee_availability_and_shifts,
-- 20260927030000_add_employee_community and
-- 20260927040000_add_employee_leave_requests:
--   * 1 new table
--   * its indexes and foreign keys
--   * ZERO changes to any existing table, column, row or constraint
--
-- There is no ALTER TABLE against a PRE-EXISTING table anywhere in this file. The
-- three ALTER TABLE statements below all target "EmployeeResignationRequest", the
-- table created moments earlier in this same file; the only pre-existing object
-- referenced is "User", which is read as an FK target and never written. No DROP,
-- no RENAME, no ALTER COLUMN, no data rewrite, no native enum, and no change to
-- any existing customer/admin/employee/payment record.
--
-- WHY A NEW TABLE (and not columns on User)
-- ----------------------------------------
-- Resignation finalization transitions User.role "employee" -> "customer"; it does
-- NOT set User.disabledAt, because disabling is a separate admin-controlled access
-- lifecycle and reusing it would deny a person who is now an ordinary customer.
--
-- NO resignedAt / resignedById column is added to User. This row IS the permanent
-- audit record: it is queryable, it survives the role change, and it carries the
-- whole decision (who decided, when, and why any outstanding work was abandoned).
-- Consequently this migration adds NO column, and no constraint of any kind, to
-- "User" — only three foreign keys that REFERENCE it.
--
-- The three User back-relations (resignationRequestsAsEmployee / AsDecider /
-- AsOrphanAcknowledger) are Prisma-level declarations only. They are satisfied
-- entirely by this new table's own foreign keys and emit no SQL against "User",
-- which is why adding them cannot alter an existing table.
--
-- 1) "EmployeeResignationRequest" — one employee's request to end the employment
--    relationship.
--    * employeeId FK ON DELETE CASCADE, matching EmployeeLeaveRequest.employeeId
--      and ShiftRequest.employeeId: a request is meaningless without its employee.
--      This destroys no history, because an employee User row is NEVER deleted —
--      DELETE /auth/account refuses employee accounts, and the admin-only disable
--      clears disabledAt rather than removing the row — so an employee's
--      assignments and work history can never cascade away. (Deliberately
--      different from BookingAssignment, which uses SET NULL so real work is never
--      destroyed.)
--    * decidedById FK ON DELETE SET NULL, matching EmployeeLeaveRequest.decidedById:
--      removing the deciding admin keeps the decision and its timestamp.
--    * orphanAcknowledgedById FK ON DELETE SET NULL for the same reason: an
--      override that abandoned outstanding work is an irreversible
--      administrative act, so losing the actor must never erase the record that
--      it happened.
--    * status defaults to 'requested' and has exactly three values — 'requested',
--      'approved', 'declined' — mirroring EmployeeLeaveRequest. A request is only
--      ever 'requested' on creation; only an admin approve/decline moves it, and a
--      decided request is never re-decided. Approving WITH an orphan
--      acknowledgement is still status 'approved': the acknowledgement is
--      expressed by the orphan* columns, never by a fourth status.
--    * note is NULLABLE: a request with no note is a complete, valid request.
--      The status buckets are validated in config.js, so status cannot become
--      unbounded free text.
--    * orphanedAssignmentCount / orphanReason / orphanAcknowledgedAt /
--      orphanAcknowledgedById are the AUDITED orphan-acknowledgement path. All four
--      stay NULL on an ordinary approval; when an admin approves over outstanding
--      accepted, non-archived work, the API requires a reason and records the count
--      plus the acknowledging admin and the moment they acknowledged it. Without
--      the actor and the timestamp a reason alone would not be an audit trail.
--      This table stores only the COUNT — there is deliberately no relation to
--      Booking or BookingAssignment, and BookingAssignment remains the sole source
--      of truth for real work.
--    * (employeeId, status) is the index the employee's own portal list reads on
--      every load; status is the admin's pending-first queue.
--
-- WHY A PARTIAL UNIQUE INDEX, AND WHY NOT @@unique([employeeId, status])
-- ------------------------------------------------------------------
-- The rule to enforce is "at most ONE OPEN request per employee". It is NOT
-- "one row per (employee, status)": a plain UNIQUE(employeeId, status) would
-- allow only one 'approved' row per employee for the whole of time, so somebody
-- who resigned once could never resign again, and several declined requests over
-- a career would collide. Historical approved and declined rows must coexist
-- freely, so no such constraint is created here.
--
-- The rule is enforced by the database, not by a read-then-write check in
-- application code (matching the duplicate-request guard on ShiftRequest), so
-- concurrent submissions cannot both win. PostgreSQL is required for this, and a
-- partial UNIQUE index is exactly the right tool: uniqueness applies only to the
-- rows where status = 'requested'.
--
-- Prisma 5.22 cannot MODEL a partial index, so this predicate deliberately lives
-- only in migration SQL and is absent from schema.prisma — the same established
-- pattern as the global-content partial index in
-- 20260914000000_add_service_content ("ContentSection_page_sectionKey_key" ...
-- WHERE "serviceId" IS NULL). The migration SQL is authoritative for this
-- constraint; the application catches the unique violation.
--
-- The predicate is "status" = 'requested' and deliberately NOT a generic
-- "status IS NOT NULL": the latter would apply to every decided row and so would
-- forbid resigning again after a first approval or after any past decline, which
-- is precisely the history this table exists to keep.
--
-- UNCHANGED BY THIS MIGRATION: User (including `role`, `status` and
-- `disabledAt`), BookingAssignment (still the sole source of truth for work),
-- Booking, EmployeeLeaveRequest, EmployeeAvailability, ShiftOffer, ShiftRequest,
-- EmployeeInvitation, every Stripe/payment table, and every existing row of every
-- existing table.

-- CreateTable
CREATE TABLE "EmployeeResignationRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "orphanedAssignmentCount" INTEGER,
    "orphanReason" TEXT,
    "orphanAcknowledgedAt" TIMESTAMP(3),
    "orphanAcknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeResignationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeResignationRequest_employeeId_status_idx" ON "EmployeeResignationRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "EmployeeResignationRequest_status_idx" ON "EmployeeResignationRequest"("status");

-- CreateIndex
-- The one-request-at-a-time guard: at most ONE 'requested' resignation per
-- employee, enforced by the database. See the header for why this is partial
-- rather than a plain UNIQUE(employeeId, status), and why the "ON (...)" list is
-- kept on a single line.
CREATE UNIQUE INDEX "EmployeeResignationRequest_employeeId_requested_key"
    ON "EmployeeResignationRequest"("employeeId") WHERE "status" = 'requested';

-- AddForeignKey
ALTER TABLE "EmployeeResignationRequest" ADD CONSTRAINT "EmployeeResignationRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeResignationRequest" ADD CONSTRAINT "EmployeeResignationRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeResignationRequest" ADD CONSTRAINT "EmployeeResignationRequest_orphanAcknowledgedById_fkey" FOREIGN KEY ("orphanAcknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
