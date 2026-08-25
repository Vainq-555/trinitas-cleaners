import { Prisma } from "@prisma/client";

// Locks the booking before atomically reserving one promotion use. This makes
// repeated confirmation requests for the same booking idempotent.
export async function claimPromotionUsage(tx, booking) {
  if (!booking.promotionId) return false;

  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT "promotionUsageClaimedAt"
    FROM "Booking"
    WHERE "id" = ${booking.id}
    FOR UPDATE
  `);
  if (!rows[0]) throw Object.assign(new Error("Booking not found"), { code: "BOOKING_NOT_FOUND" });
  if (rows[0].promotionUsageClaimedAt) return false;

  const claimed = await tx.$executeRaw(Prisma.sql`
    UPDATE "Promotion"
    SET "usageCount" = "usageCount" + 1
    WHERE "id" = ${booking.promotionId}
      AND ("maxUses" IS NULL OR "usageCount" < "maxUses")
  `);
  if (claimed !== 1) throw Object.assign(new Error("This promotion is no longer available"), { code: "PROMOTION_UNAVAILABLE" });

  await tx.booking.update({ where: { id: booking.id }, data: { promotionUsageClaimedAt: new Date() } });
  return true;
}
