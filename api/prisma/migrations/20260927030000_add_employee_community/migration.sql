-- Employee System Phase 2B-5 — EMPLOYEE COMMUNITY.
--
-- STRICTLY ADDITIVE, in the same style as 20260927010000_add_broadcast_audience:
--   * 3 ADD COLUMN on the existing CommunityMessage table
--   * 1 new index
--   * 1 new foreign key
-- No DROP COLUMN, no DROP TABLE, no data rewrite, no native enum, and no change
-- to any existing customer/admin record.
--
-- WHY THIS IS REQUIRED (and not a convention)
-- -----------------------------------------
-- CommunityMessage had NO audience dimension before this migration: the table
-- was the customer community, and it was customer-only only because the sole
-- read routes (/community/messages and /admin/community/messages) sat behind
-- requireCustomer. That is an accident of the route guard, not something the
-- data recorded.
--
-- An employee post written into this same table would therefore have been
-- delivered to EVERY CUSTOMER immediately, and adding an employee community to
-- the same table while leaving the audience implied is exactly the fragile
-- convention this schema forbids. The audience is stored explicitly instead,
-- and every community read pins it to a literal.
--
-- 1) CommunityMessage.audience — "customer" | "employee"
--    * ADD COLUMN ... NOT NULL DEFAULT 'customer' backfills every existing row
--      to 'customer' in place. Postgres 11+ applies this without a table rewrite.
--    * Therefore every pre-existing row keeps EXACTLY the audience it already
--      had in practice, and the customer community is byte-for-byte unchanged.
--    * The DEFAULT is the SAFE value: a caller that omits the column can never
--      create an employee post by accident. Reaching the employee audience always
--      requires naming it explicitly.
--    * There is deliberately NO value meaning "everybody". A customer query
--      pinned to audience = 'customer' therefore CANNOT match an employee row,
--      so the separation fails CLOSED — a dropped or misspelled filter yields an
--      empty feed, never a leak.
--    * A String rather than a native enum, matching the existing convention for
--      role/status/type in this schema (validated in the application layer).
--
-- 2) CommunityMessage.deletedAt / deletedById — admin soft delete
--    * Mirrors GroupMessage, which already uses this exact shape for customer
--      group moderation. NULL deletedAt = the post is visible.
--    * Soft delete rather than a hard DELETE: a moderated employee post is
--      withdrawn from employees while the record an admin needs in order to
--      review the decision survives.
--    * deletedById is NULLABLE with ON DELETE SET NULL, so removing an admin can
--      never delete a post or resurrect a hidden one — the same reasoning as
--      BookingAssignment.assignedById.
--    * Both columns are NULL for every pre-existing row, so no customer post is
--      affected by their addition.
--
-- 3) CommunityMessage_audience_idx — supports the audience-pinned read that
--    every community query performs. The existing createdAt/customerId indexes
--    are retained; nothing is replaced.
--
-- NOT CHANGED, DELIBERATELY:
--   * User.communityBlockedAt is REUSED for employee posting blocks. It is
--     already role-agnostic ("blocked from posting in the community"), so this
--     migration adds no column for it and changes no customer behavior.
--   * Group / GroupMember / GroupMessage are NOT given an audience. They are
--     customer-scoped social groups and are out of scope for this phase.
--   * Broadcast is untouched; it already carries its own audience column.

-- Additive: new column, backfilled in place to the pre-existing behavior.
ALTER TABLE "CommunityMessage" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'customer';

-- Additive: nullable moderation columns. NULL on every pre-existing row.
ALTER TABLE "CommunityMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CommunityMessage" ADD COLUMN "deletedById" TEXT;

-- Additive: new index alongside the existing createdAt/customerId indexes.
CREATE INDEX "CommunityMessage_audience_idx" ON "CommunityMessage"("audience");

-- Additive: SetNull so removing the moderating admin neither deletes the post
-- nor un-hides it. Cascading here would destroy moderation history.
ALTER TABLE "CommunityMessage"
  ADD CONSTRAINT "CommunityMessage_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
