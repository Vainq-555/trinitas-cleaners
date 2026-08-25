-- Additive unified-pricing schema. Legacy Float columns and records are untouched.

ALTER TABLE "Booking" ADD COLUMN "basePriceCents" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "discountCents" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "taxableSubtotalCents" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "taxRateBasisPoints" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "taxCents" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "finalAmountCents" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "taxCalculationId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "taxAddressLine1" TEXT;
ALTER TABLE "Booking" ADD COLUMN "taxAddressLine2" TEXT;
ALTER TABLE "Booking" ADD COLUMN "taxAddressCity" TEXT;
ALTER TABLE "Booking" ADD COLUMN "taxAddressState" TEXT;
ALTER TABLE "Booking" ADD COLUMN "taxAddressPostalCode" TEXT;
ALTER TABLE "Booking" ADD COLUMN "taxAddressCountry" TEXT;
ALTER TABLE "Booking" ADD COLUMN "promotionId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "promotionCodeSnapshot" TEXT;
ALTER TABLE "Booking" ADD COLUMN "promotionNameSnapshot" TEXT;
ALTER TABLE "Booking" ADD COLUMN "promotionDiscountTypeSnapshot" TEXT;
ALTER TABLE "Booking" ADD COLUMN "promotionDiscountValueSnapshot" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "promotionUsageClaimedAt" TIMESTAMP(3);

ALTER TABLE "Payment" ADD COLUMN "finalAmountCents" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "amountPaidCents" INTEGER;

ALTER TABLE "Receipt" ADD COLUMN "baseAmountCents" INTEGER;
ALTER TABLE "Receipt" ADD COLUMN "discountCents" INTEGER;
ALTER TABLE "Receipt" ADD COLUMN "taxableSubtotalCents" INTEGER;
ALTER TABLE "Receipt" ADD COLUMN "taxRateBasisPoints" INTEGER;
ALTER TABLE "Receipt" ADD COLUMN "taxCents" INTEGER;
ALTER TABLE "Receipt" ADD COLUMN "finalAmountCents" INTEGER;

CREATE TABLE "Promotion" (
  "id" TEXT NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "discountType" TEXT NOT NULL,
  "discountValue" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "minSubtotalCents" INTEGER,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "maxUses" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionService" (
  "promotionId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  CONSTRAINT "PromotionService_pkey" PRIMARY KEY ("promotionId", "serviceId"),
  CONSTRAINT "PromotionService_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PromotionService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");
CREATE INDEX "PromotionService_serviceId_idx" ON "PromotionService"("serviceId");
CREATE INDEX "Booking_promotionId_idx" ON "Booking"("promotionId");
