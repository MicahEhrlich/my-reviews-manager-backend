CREATE TYPE "GoogleConnectionStatus" AS ENUM ('DISCOVERING', 'CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "Capability" AS ENUM ('READ_REVIEWS', 'REPLY_TO_REVIEWS', 'PUBLISH_POSTS', 'AUTO_REPLY');
CREATE TYPE "LocationSyncStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'SYNCING', 'COMPLETE', 'FAILED');

ALTER TABLE "Agency"
  ADD COLUMN "capabilities" "Capability"[] NOT NULL DEFAULT ARRAY['READ_REVIEWS']::"Capability"[];

CREATE TABLE "GoogleConnection" (
  "id" TEXT PRIMARY KEY,
  "agencyId" TEXT NOT NULL,
  "googleSubject" TEXT NOT NULL,
  "googleEmail" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT,
  "encryptedAccessToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "GoogleConnectionStatus" NOT NULL DEFAULT 'DISCOVERING',
  "discoveryCompletedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "Account"
  DROP COLUMN "googleEmail",
  DROP COLUMN "encryptedRefreshToken",
  DROP COLUMN "encryptedAccessToken",
  DROP COLUMN "tokenExpiresAt",
  ADD COLUMN "googleConnectionId" TEXT,
  ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Account" DROP CONSTRAINT "Account_googleAccountId_key";
CREATE UNIQUE INDEX "Account_agencyId_googleAccountId_key" ON "Account"("agencyId", "googleAccountId");

ALTER TABLE "Location"
  ADD COLUMN "googleResourceName" TEXT,
  ADD COLUMN "isSelected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "syncStatus" "LocationSyncStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "lastReviewSyncAt" TIMESTAMP(3),
  ADD COLUMN "syncFailureMessage" TEXT;

UPDATE "Location" SET "googleResourceName" = 'locations/' || "googleLocationId";
ALTER TABLE "Location" ALTER COLUMN "googleResourceName" SET NOT NULL;

CREATE UNIQUE INDEX "GoogleConnection_agencyId_googleSubject_key" ON "GoogleConnection"("agencyId", "googleSubject");
CREATE INDEX "GoogleConnection_agencyId_status_idx" ON "GoogleConnection"("agencyId", "status");
CREATE INDEX "Account_googleConnectionId_idx" ON "Account"("googleConnectionId");
ALTER TABLE "Location" DROP CONSTRAINT "Location_googleLocationId_key";
CREATE UNIQUE INDEX "Location_accountId_googleLocationId_key" ON "Location"("accountId", "googleLocationId");
CREATE UNIQUE INDEX "Location_accountId_googleResourceName_key" ON "Location"("accountId", "googleResourceName");
ALTER TABLE "Review" DROP CONSTRAINT "Review_googleReviewId_key";
CREATE UNIQUE INDEX "Review_locationId_googleReviewId_key" ON "Review"("locationId", "googleReviewId");

ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Account" ADD CONSTRAINT "Account_googleConnectionId_fkey" FOREIGN KEY ("googleConnectionId") REFERENCES "GoogleConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
