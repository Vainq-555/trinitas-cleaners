-- Additive Phase-5.1: close the two unique-constraint drifts identified in the
-- production migration readiness audit. STRICTLY additive: ALTER TABLE ... ADD
-- CONSTRAINT only. No column/table changes, no data changes, no enums. Both
-- columns are NULL/empty until the monthly flow runs, so the constraints apply
-- cleanly on existing rows.

ALTER TABLE "User"
ADD CONSTRAINT "User_stripeCustomerId_key"
UNIQUE ("stripeCustomerId");

ALTER TABLE "SubscriptionBooking"
ADD CONSTRAINT "SubscriptionBooking_stripeInvoiceId_key"
UNIQUE ("stripeInvoiceId");
