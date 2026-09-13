-- Additive: scope ContentSection rows to an optional Service so each service
-- can carry its own admin-controlled "How It Works" steps alongside the
-- existing global content. Global rows keep serviceId NULL and are untouched;
-- every change below is confined to the ContentSection table.

-- 1) Add the nullable serviceId column. Existing rows implicitly get NULL,
--    which preserves every current global content section exactly as-is.
ALTER TABLE "ContentSection" ADD COLUMN "serviceId" TEXT;

-- 2) Foreign key. Content is auxiliary, so deleting a Service sets the
--    sections' serviceId to NULL (never blocks the delete, never cascades).
ALTER TABLE "ContentSection"
  ADD CONSTRAINT "ContentSection_serviceId_fkey" FOREIGN KEY ("serviceId")
  REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Index for per-service content lookups (public + admin).
CREATE INDEX "ContentSection_serviceId_idx" ON "ContentSection"("serviceId");

-- 4) Replace the old all-rows unique on (page, sectionKey) with the new
--    Prisma-managed composite unique on (page, serviceId, sectionKey).
--    The composite alone does NOT enforce uniqueness for global rows because
--    PostgreSQL treats NULL values as distinct, so the original index is
--    re-created below as a PARTIAL unique index scoped to global rows.
DROP INDEX "ContentSection_page_sectionKey_key";
CREATE UNIQUE INDEX "ContentSection_page_serviceId_sectionKey_key"
  ON "ContentSection"("page", "serviceId", "sectionKey");

-- 5) Global uniqueness hardening: (page, sectionKey) unique WHERE serviceId
--    IS NULL. Preserves the exact guarantee the pre-change schema provided
--    for the global /how-it-works content.
CREATE UNIQUE INDEX "ContentSection_page_sectionKey_key"
  ON "ContentSection"("page", "sectionKey") WHERE "serviceId" IS NULL;