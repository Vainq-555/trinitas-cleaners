-- Additive: admin-controlled content sections for public pages.
-- Each section belongs to a whitelisted page slug (e.g. "how-it-works") and
-- is uniquely identified by (page, sectionKey). isActive gates public visibility.

-- CreateTable
CREATE TABLE "ContentSection" (
    "id" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentSection_page_sectionKey_key" ON "ContentSection"("page", "sectionKey");
CREATE INDEX "ContentSection_page_idx" ON "ContentSection"("page");