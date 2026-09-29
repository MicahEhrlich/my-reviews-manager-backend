CREATE TYPE "PostPublicationStatus" AS ENUM ('QUEUED', 'GENERATING', 'PUBLISHING', 'PUBLISHED', 'FAILED');

ALTER TABLE "LocalPost"
  ADD COLUMN "imageObjectKey" TEXT,
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "brief" TEXT;

CREATE TABLE "PostPublication" (
  "id" TEXT PRIMARY KEY,
  "localPostId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "generatedText" TEXT,
  "googlePostId" TEXT UNIQUE,
  "status" "PostPublicationStatus" NOT NULL DEFAULT 'QUEUED',
  "generationStartedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PostPublication_localPostId_fkey" FOREIGN KEY ("localPostId") REFERENCES "LocalPost"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "PostPublication_localPostId_scheduledAt_key" ON "PostPublication"("localPostId", "scheduledAt");
CREATE INDEX "PostPublication_status_scheduledAt_idx" ON "PostPublication"("status", "scheduledAt");
CREATE INDEX "PostPublication_localPostId_createdAt_idx" ON "PostPublication"("localPostId", "createdAt");

INSERT INTO "PostPublication" ("id", "localPostId", "scheduledAt", "generatedText", "status", "createdAt", "updatedAt")
SELECT 'legacy-' || "id", "id", "nextPublishAt", "summaryText", 'QUEUED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "LocalPost"
WHERE "nextPublishAt" IS NOT NULL AND "status" IN ('SCHEDULED', 'ACTIVE', 'FAILED');
