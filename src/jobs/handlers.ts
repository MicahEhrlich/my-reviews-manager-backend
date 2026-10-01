import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { nextFutureOccurrence } from '../lib/recurrence.js';
import type { Providers } from '../providers/types.js';
import type { Queues } from '../queues.js';
import { agencyCapabilities, requireProviderCapability } from '../capabilities.js';

export function createHandlers(db: PrismaClient, providers: Providers, queues: Queues, config: Config) {
  return {
    async syncReviews() {
      const accounts = await db.account.findMany({ where: { status: 'CONNECTED', agency: { capabilities: { has: 'READ_REVIEWS' } }, OR: [{ isDemo: true }, { googleConnection: { status: 'CONNECTED' } }] }, include: { googleConnection: true, locations: { where: { isSelected: true, isActive: true } } } });
      for (const account of accounts) for (const location of account.locations) {
        await db.location.update({ where: { id: location.id }, data: { syncStatus: 'SYNCING', syncFailureMessage: null } });
        try {
          const external = await providers.google.listReviews(account, location);
          for (const item of external) {
            const existing = await db.review.findUnique({ where: { locationId_googleReviewId: { locationId: location.id, googleReviewId: item.googleReviewId } } });
            if (!existing) {
              const review = await db.review.create({ data: { locationId: location.id, googleReviewId: item.googleReviewId, reviewerName: item.reviewerName, starRating: item.starRating, comment: item.comment, googleCreatedAt: item.createdAt, googleUpdatedAt: item.updatedAt, queuedAt: new Date(), status: 'QUEUED' } });
              await queues.reviewAi.add('process-review', { reviewId: review.id }, { jobId: `review-${review.id}-${item.updatedAt.getTime()}` });
            } else if (item.updatedAt > existing.googleUpdatedAt && !['AUTO_SENT', 'APPROVED', 'DELETED'].includes(existing.status)) {
              await db.review.update({ where: { id: existing.id }, data: { reviewerName: item.reviewerName, starRating: item.starRating, comment: item.comment, googleUpdatedAt: item.updatedAt, status: 'QUEUED', queuedAt: new Date() } });
              await queues.reviewAi.add('process-review', { reviewId: existing.id }, { jobId: `review-${existing.id}-${item.updatedAt.getTime()}` });
            }
          }
          const now = new Date();
          await db.location.update({ where: { id: location.id }, data: { syncStatus: 'COMPLETE', lastReviewSyncAt: now, syncFailureMessage: null } });
          await db.account.update({ where: { id: account.id }, data: { lastReviewSyncAt: now } });
        } catch (error) {
          await db.location.update({ where: { id: location.id }, data: { syncStatus: 'FAILED', syncFailureMessage: String(error).slice(0, 1000) } });
        }
      }
    },
    async processReview(reviewId: string, approve = false) {
      const target = approve ? 'APPROVING' : 'PROCESSING';
      const allowed = approve ? ['APPROVING'] : ['QUEUED', 'FAILED'];
      const claimed = await db.review.updateMany({ where: { id: reviewId, status: { in: allowed as ('APPROVING'|'QUEUED'|'FAILED')[] } }, data: { status: target, processingStartedAt: new Date(), failureCode: null, failureMessage: null } });
      if (!claimed.count) return;
      const review = await db.review.findUniqueOrThrow({ where: { id: reviewId }, include: { location: { include: { account: { include: { googleConnection: true } } } } } });
      try {
        if (approve) {
          await requireProviderCapability(db, review.location.account.agencyId, 'REPLY_TO_REVIEWS');
          if (!review.aiDraftReply) throw new Error('Approved review has no draft');
          await providers.google.replyToReview(review.location.account, review.location, review, review.aiDraftReply);
          await db.review.update({ where: { id: review.id }, data: { publishedReply: review.aiDraftReply, status: 'APPROVED', processedAt: new Date() } }); return;
        }
        const reply = await providers.replies.generate({ businessName: review.location.displayName, businessCategory: review.location.businessCategory, rating: review.starRating, reviewText: review.comment, tone: review.location.defaultTone });
        const capabilities = await agencyCapabilities(db, review.location.account.agencyId);
        if (review.starRating >= 4 && review.location.autoReplyEnabled && capabilities.includes('AUTO_REPLY') && capabilities.includes('REPLY_TO_REVIEWS')) {
          await providers.google.replyToReview(review.location.account, review.location, review, reply);
          await db.review.update({ where: { id: review.id }, data: { aiDraftReply: reply, publishedReply: reply, status: 'AUTO_SENT', processedAt: new Date() } });
        } else {
          await db.review.update({ where: { id: review.id }, data: { aiDraftReply: reply, status: 'PENDING_APPROVAL', processedAt: new Date() } });
          if (review.location.whatsappAlertNumber) await queues.notifications.add('pending-review-alert', { reviewId: review.id }, { jobId: `notify-${review.id}-${review.googleUpdatedAt.getTime()}` });
        }
      } catch (error) {
        await db.review.update({ where: { id: review.id }, data: { status: 'FAILED', failureCode: error instanceof Error && 'code' in error ? String(error.code) : 'PROCESSING_FAILED', failureMessage: String(error) } }); throw error;
      }
    },
    async notify(reviewId: string) {
      const review = await db.review.findUniqueOrThrow({ where: { id: reviewId }, include: { location: true } });
      if (!review.location.whatsappAlertNumber) return;
      await providers.whatsapp.send({ locationId: review.location.id, reviewId: review.id, destination: review.location.whatsappAlertNumber, locationName: review.location.displayName, reviewerName: review.reviewerName, rating: review.starRating, dashboardUrl: `${config.FRONTEND_URL}/reviews?review=${review.id}` });
    },
    async scanPosts() {
      const stale = new Date(Date.now() - 15 * 60_000);
      await db.postPublication.updateMany({ where: { status: { in: ['GENERATING', 'PUBLISHING'] }, updatedAt: { lt: stale } }, data: { status: 'QUEUED', failureCode: 'STALE_CLAIM', failureMessage: 'Recovered an interrupted publication' } });
      const due = await db.postPublication.findMany({ where: { status: 'QUEUED', scheduledAt: { lte: new Date() }, localPost: { status: { in: ['ACTIVE', 'SCHEDULED'] }, location: { account: { agency: { capabilities: { has: 'PUBLISH_POSTS' } } } } } } });
      for (const publication of due) await queues.postPublish.add('publish-post', { publicationId: publication.id }, { jobId: `publication-${publication.id}` });
    },
    async publishPost(publicationId: string) {
      const snapshot = await db.postPublication.findUniqueOrThrow({ where: { id: publicationId }, include: { localPost: true } });
      if (snapshot.localPost.status === 'PAUSED' || snapshot.status === 'PUBLISHED') return;
      const target = snapshot.generatedText ? 'PUBLISHING' : 'GENERATING';
      const claimed = await db.postPublication.updateMany({ where: { id: publicationId, status: { in: ['QUEUED', 'FAILED'] } }, data: { status: target, generationStartedAt: snapshot.generatedText ? undefined : new Date(), failureCode: null, failureMessage: null } });
      if (!claimed.count) return;
      let publication = await db.postPublication.findUniqueOrThrow({ where: { id: publicationId }, include: { localPost: { include: { location: { include: { account: { include: { googleConnection: true } } } } } } } });
      const post = publication.localPost;
      try {
        await requireProviderCapability(db, post.location.account.agencyId, 'PUBLISH_POSTS');
        let generatedText = publication.generatedText;
        if (!generatedText) {
          generatedText = post.brief || post.imageUrl
            ? await providers.postCopy.generate({ businessName: post.location.displayName, businessCategory: post.location.businessCategory, imageUrl: post.imageUrl, brief: post.brief })
            : post.summaryText;
          publication = await db.postPublication.update({ where: { id: publication.id }, data: { generatedText, status: 'PUBLISHING' }, include: { localPost: { include: { location: { include: { account: { include: { googleConnection: true } } } } } } } });
          await db.localPost.update({ where: { id: post.id }, data: { summaryText: generatedText } });
        }
        const result = await providers.google.createPost(post.location.account, post.location, { id: publication.id, topicType: post.topicType, summaryText: generatedText, structuredPayload: post.structuredPayload, imageUrl: post.imageUrl });
        const now = new Date(); const next = post.isRecurring ? nextFutureOccurrence(publication.scheduledAt, post.frequencyDays, now) : null;
        const nextPublication = await db.$transaction(async (tx) => {
          await tx.postPublication.update({ where: { id: publication.id }, data: { googlePostId: result.googlePostId, publishedAt: now, status: 'PUBLISHED', failureCode: null, failureMessage: null } });
          await tx.localPost.update({ where: { id: post.id }, data: { googlePostId: result.googlePostId, summaryText: generatedText, lastPublishedAt: now, nextPublishAt: next, status: 'ACTIVE', publicationKey: null, failureCode: null, failureMessage: null } });
          return next ? tx.postPublication.upsert({ where: { localPostId_scheduledAt: { localPostId: post.id, scheduledAt: next } }, create: { localPostId: post.id, scheduledAt: next }, update: {} }) : null;
        });
        if (nextPublication && next) await queues.postPublish.add('publish-post', { publicationId: nextPublication.id }, { jobId: `publication-${nextPublication.id}`, delay: Math.max(0, next.getTime() - Date.now()) });
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : 'PUBLISH_FAILED';
        await db.$transaction([db.postPublication.update({ where: { id: publication.id }, data: { status: 'FAILED', failureCode: code, failureMessage: String(error) } }), db.localPost.update({ where: { id: post.id }, data: { status: 'FAILED', failureCode: code, failureMessage: String(error) } })]);
        throw error;
      }
    },
  };
}
