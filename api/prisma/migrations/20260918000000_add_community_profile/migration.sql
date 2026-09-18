-- Community V2 Phase 1 — Social profiles.
--
-- Additive only: creates a 1:1 CommunityProfile row per customer. No existing
-- table or column is altered. Account deletion cascades the profile away
-- (same convention as every other User child).

CREATE TABLE "CommunityProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "locationCity" TEXT,
    "locationState" TEXT,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "profileVisible" BOOLEAN NOT NULL DEFAULT true,
    "moderationHiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityProfile_userId_key" ON "CommunityProfile"("userId");

CREATE INDEX "CommunityProfile_displayName_idx" ON "CommunityProfile"("displayName");

ALTER TABLE "CommunityProfile" ADD CONSTRAINT "CommunityProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;