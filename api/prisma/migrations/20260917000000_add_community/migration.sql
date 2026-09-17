-- Additive: introduce the CommunityMessage model (customer-to-customer global
-- community chat) and the User.communityBlockedAt moderation flag.
--
-- Customers post messages that are visible to all other customers; admins
-- moderate by blocking/unblocking a customer (communityBlockedAt set/cleared)
-- but never author posts themselves. Deleting a customer account cascades to
-- their posts.
--
-- This migration creates only the CommunityMessage table and adds one nullable
-- column to User. No existing table or column is altered beyond that and no
-- existing data is touched or backfilled. Existing customers receive
-- communityBlockedAt = NULL.

-- CreateTable
CREATE TABLE "CommunityMessage" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMessage_pkey" PRIMARY KEY ("id")
);

-- Feed queries order by recency (createdAt DESC, id DESC cursor pagination).
CREATE INDEX "CommunityMessage_createdAt_idx" ON "CommunityMessage"("createdAt");

-- Per-customer lookups and block/participant filters.
CREATE INDEX "CommunityMessage_customerId_idx" ON "CommunityMessage"("customerId");

-- Deleting a customer account removes their posts (User owns all of its
-- children; Booking -> Payment and Review -> Booking already cascade the same
-- way).
ALTER TABLE "CommunityMessage"
  ADD CONSTRAINT "CommunityMessage_customerId_fkey" FOREIGN KEY ("customerId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Moderation flag: set when a customer is blocked from posting; NULL = may post.
ALTER TABLE "User" ADD COLUMN "communityBlockedAt" TIMESTAMP(3);