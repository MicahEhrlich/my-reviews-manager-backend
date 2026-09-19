CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "Tone" AS ENUM ('WARM_PERSONAL', 'PROFESSIONAL', 'SHORT_DIRECT');
CREATE TYPE "ReviewStatus" AS ENUM ('QUEUED', 'PROCESSING', 'PENDING_APPROVAL', 'APPROVING', 'AUTO_SENT', 'APPROVED', 'FAILED', 'DELETED');
CREATE TYPE "PostTopicType" AS ENUM ('STANDARD', 'OFFER', 'EVENT');
CREATE TYPE "PostStatus" AS ENUM ('SCHEDULED', 'PUBLISHING', 'ACTIVE', 'PAUSED', 'FAILED');
CREATE TYPE "AccountStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "Agency" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "agencyId" TEXT NOT NULL, "googleSubject" TEXT UNIQUE, "email" TEXT NOT NULL UNIQUE, "displayName" TEXT NOT NULL, "role" "UserRole" NOT NULL DEFAULT 'MEMBER', "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Account" ("id" TEXT PRIMARY KEY, "agencyId" TEXT NOT NULL, "googleAccountId" TEXT NOT NULL UNIQUE, "googleEmail" TEXT NOT NULL, "encryptedRefreshToken" TEXT, "encryptedAccessToken" TEXT, "tokenExpiresAt" TIMESTAMP(3), "status" "AccountStatus" NOT NULL DEFAULT 'CONNECTED', "lastReviewSyncAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Location" ("id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "googleLocationId" TEXT NOT NULL UNIQUE, "displayName" TEXT NOT NULL, "businessCategory" TEXT NOT NULL, "defaultTone" "Tone" NOT NULL DEFAULT 'WARM_PERSONAL', "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT true, "whatsappAlertNumber" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Review" ("id" TEXT PRIMARY KEY, "locationId" TEXT NOT NULL, "googleReviewId" TEXT NOT NULL UNIQUE, "reviewerName" TEXT NOT NULL, "starRating" INTEGER NOT NULL, "comment" TEXT NOT NULL, "aiDraftReply" TEXT, "publishedReply" TEXT, "googleCreatedAt" TIMESTAMP(3) NOT NULL, "googleUpdatedAt" TIMESTAMP(3) NOT NULL, "queuedAt" TIMESTAMP(3), "processingStartedAt" TIMESTAMP(3), "processedAt" TIMESTAMP(3), "failureCode" TEXT, "failureMessage" TEXT, "status" "ReviewStatus" NOT NULL DEFAULT 'QUEUED', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Review_rating_check" CHECK ("starRating" BETWEEN 1 AND 5));
CREATE TABLE "LocalPost" ("id" TEXT PRIMARY KEY, "locationId" TEXT NOT NULL, "googlePostId" TEXT UNIQUE, "topicType" "PostTopicType" NOT NULL, "summaryText" TEXT NOT NULL, "structuredPayload" JSONB, "isRecurring" BOOLEAN NOT NULL DEFAULT false, "frequencyDays" INTEGER NOT NULL DEFAULT 6, "nextPublishAt" TIMESTAMP(3), "lastPublishedAt" TIMESTAMP(3), "status" "PostStatus" NOT NULL DEFAULT 'SCHEDULED', "failureCode" TEXT, "failureMessage" TEXT, "publicationKey" TEXT UNIQUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LocalPost_frequency_check" CHECK ("frequencyDays" BETWEEN 1 AND 30), CONSTRAINT "LocalPost_schedule_check" CHECK (NOT "isRecurring" OR "nextPublishAt" IS NOT NULL));
CREATE TABLE "NotificationLog" ("id" TEXT PRIMARY KEY, "locationId" TEXT NOT NULL, "reviewId" TEXT, "destination" TEXT NOT NULL, "templateName" TEXT NOT NULL, "payload" JSONB NOT NULL, "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING', "providerId" TEXT, "failureMessage" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMP(3));
CREATE TABLE "ProviderEvent" ("id" TEXT PRIMARY KEY, "provider" TEXT NOT NULL, "action" TEXT NOT NULL, "resourceId" TEXT, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);

ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE;
ALTER TABLE "Account" ADD CONSTRAINT "Account_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE;
ALTER TABLE "Location" ADD CONSTRAINT "Location_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE;
ALTER TABLE "LocalPost" ADD CONSTRAINT "LocalPost_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL;

CREATE INDEX "User_agencyId_isActive_idx" ON "User"("agencyId", "isActive");
CREATE INDEX "Account_agencyId_status_idx" ON "Account"("agencyId", "status");
CREATE INDEX "Account_status_lastReviewSyncAt_idx" ON "Account"("status", "lastReviewSyncAt");
CREATE INDEX "Location_accountId_idx" ON "Location"("accountId");
CREATE INDEX "Review_locationId_status_idx" ON "Review"("locationId", "status");
CREATE INDEX "Review_status_queuedAt_idx" ON "Review"("status", "queuedAt");
CREATE INDEX "Review_locationId_googleUpdatedAt_idx" ON "Review"("locationId", "googleUpdatedAt");
CREATE INDEX "LocalPost_locationId_status_idx" ON "LocalPost"("locationId", "status");
CREATE INDEX "LocalPost_isRecurring_status_nextPublishAt_idx" ON "LocalPost"("isRecurring", "status", "nextPublishAt");
CREATE INDEX "NotificationLog_locationId_createdAt_idx" ON "NotificationLog"("locationId", "createdAt");
CREATE INDEX "NotificationLog_reviewId_idx" ON "NotificationLog"("reviewId");
CREATE INDEX "ProviderEvent_provider_action_createdAt_idx" ON "ProviderEvent"("provider", "action", "createdAt");
