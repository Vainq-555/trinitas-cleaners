-- Community V2 — Customer Groups: owner-issued invite codes (G1f).
--
-- Additive only: adds the nullable, unique Group.inviteCode column. No existing
-- table or column is altered and no rows are touched. The unique constraint
-- mirrors the Prisma "@unique" convention ("Group_inviteCode_key").

ALTER TABLE "Group" ADD COLUMN "inviteCode" TEXT;

CREATE UNIQUE INDEX "Group_inviteCode_key" ON "Group"("inviteCode");