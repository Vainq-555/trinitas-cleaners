-- Additive Phase-1: recurring monthly billing (approved Option B — true
-- Stripe subscription). STRICTLY additive: only the new columns on existing
-- tables and CREATE TABLE for brand-new models. No column drops, no table
-- drops, no data rewrites, no enums.

-- 1) New columns on existing tables (stock additions only, no data rewrites).
ALTER TABLE "User"
ADD COLUMN "stripeCustomerId" TEXT;

ALTER TABLE "Service"
ADD COLUMN "monthlyPriceCents" INTEGER,
ADD COLUMN "monthlyActive" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CustomPrice"
ADD COLUMN "monthlyPriceCents" INTEGER;

-- 2) Subscription — one recurring billing agreement (customer × service).
-- Owns the bookingId FK to its originating request booking and the
-- idempotencyKey webhook-dedup guard.
CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "months" INTEGER NOT NULL,
  "monthCompleted" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "monthlyPriceCents" INTEGER NOT NULL,
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "finalCancelPending" BOOLEAN NOT NULL DEFAULT false,
  "finalCancelPendingAt" TIMESTAMP(3),
  "finalCancelConfirmedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3),

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- 3) SubscriptionBooking — one paid month on a subscription (1:1 with a Booking).
-- [subscriptionId, periodIndex] is the unique period identity.
CREATE TABLE "SubscriptionBooking" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "periodIndex" INTEGER NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "stripeInvoiceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubscriptionBooking_pkey" PRIMARY KEY ("id")
);

-- 4) SubscriptionPayment — the Payment that paid one month on a subscription.
-- One row per paid period; the idempotencyKey dedup guard lives on Subscription.
CREATE TABLE "SubscriptionPayment" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "periodIndex" INTEGER NOT NULL,
  "stripeInvoiceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'paid',
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- Foreign keys (existing-table FKs are STRICTLY additive; no drops).

-- Subscription FKs
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SubscriptionBooking FKs
ALTER TABLE "SubscriptionBooking" ADD CONSTRAINT "SubscriptionBooking_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionBooking" ADD CONSTRAINT "SubscriptionBooking_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SubscriptionPayment FKs
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes per model (additive).
CREATE INDEX "Subscription_customerId_idx" ON "Subscription"("customerId");
CREATE INDEX "Subscription_serviceId_idx" ON "Subscription"("serviceId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "SubscriptionBooking_subscriptionId_idx" ON "SubscriptionBooking"("subscriptionId");
CREATE INDEX "SubscriptionPayment_subscriptionId_idx" ON "SubscriptionPayment"("subscriptionId");

-- Unique constraints per model (additive).
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_bookingId_key" UNIQUE ("bookingId");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_stripeSubscriptionId_key" UNIQUE ("stripeSubscriptionId");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_stripePriceId_key" UNIQUE ("stripePriceId");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_idempotencyKey_key" UNIQUE ("idempotencyKey");
ALTER TABLE "SubscriptionBooking" ADD CONSTRAINT "SubscriptionBooking_bookingId_key" UNIQUE ("bookingId");
ALTER TABLE "SubscriptionBooking" ADD CONSTRAINT "SubscriptionBooking_subscriptionId_periodIndex_key"
  UNIQUE ("subscriptionId", "periodIndex");
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_paymentId_key" UNIQUE ("paymentId");
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_stripeInvoiceId_key" UNIQUE ("stripeInvoiceId");
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_periodIndex_key"
  UNIQUE ("subscriptionId", "periodIndex");