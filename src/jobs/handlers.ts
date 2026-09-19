import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { nextFutureOccurrence } from '../lib/recurrence.js';
import type { Providers } from '../providers/types.js';
import type { Queues } from '../queues.js';

export function createHandlers(db: PrismaClient, providers: Providers, queues: Queues, config: Config) {
  return {
    async syncReviews() {
      const accounts = await db.account.findMany({ where: { status: 'CONNECTED' }, include: { locations: true } });
      for (const account of accounts) for (const location of account.locations) {
        const external = await providers.google.listReviews(account, location);
        for (const item of external) {
          const existing = await db.review.findUnique({ where: { googleReviewId: item.googleReviewId } });
          if (!existing) {
            const review = await db.review.create({ data: { locationId: location.id, googleReviewId: item.googleReviewId, reviewerName: item.reviewerName, starRating: item.starRating, comment: item.comment, googleCreatedAt: item.createdAt, googleUpdatedAt: item.updatedAt, queuedAt: new Date(), status: 'QUEUED' } });
            await queues.reviewAi.add('process-review', { reviewId: review.id }, { jobId: `review-${review.id}-${item.updatedAt.getTime()}` });
          } else if (item.updatedAt > existing.googleUpdatedAt && !['AUTO_SENT', 'APPROVED', 'DELETED'].includes(existing.status)) {
            await db.review.update({ where: { id: existing.id }, data: { reviewerName: item.reviewerName, starRating: item.starRating, comment: item.comment, googleUpdatedAt: item.updatedAt, status: 'QUEUED', queuedAt: new Date() } });
            await queues.reviewAi.add('process-review', { reviewId: existing.id }, { jobId: `review-${existing.id}-${item.updatedAt.getTime()}` });
          }
        }
        await db.account.update({ where: { id: account.id }, data: { lastReviewSyncAt: new Date() } });
      }
    },
    async processReview(reviewId: string, approve = false) {
      const target = approve ? 'APPROVING' : 'PROCESSING';
      const allowed = approve ? ['APPROVING'] : ['QUEUED', 'FAILED'];
      const claimed = await db.review.updateMany({ where: { id: reviewId, status: { in: allowed as ('APPROVING'|'QUEUED'|'FAILED')[] } }, data: { status: target, processingStartedAt: new Date(), failureCode: null, failureMessage: null } });
      if (!claimed.count) return;
      const review = await db.review.findUniqueOrThrow({ where: { id: reviewId }, include: { location: { include: { account: true } } } });
      try {
        if (approve) {
          if (!review.aiDraftReply) throw new Error('Approved review has no draft');
          await providers.google.replyToReview(review.location.account, review.location, review, review.aiDraftReply);
          await db.review.update({ where: { id: review.id }, data: { publishedReply: review.aiDraftReply, status: 'APPROVED', processedAt: new Date() } }); return;
        }
        const reply = await providers.replies.generate({ businessName: review.location.displayName, businessCategory: review.location.businessCategory, reviewerName: review.reviewerName, rating: review.starRating, reviewText: review.comment, tone: review.location.defaultTone });
        if (review.starRating >= 4 && review.location.autoReplyEnabled) {
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
      const due = await db.localPost.findMany({ where: { isRecurring: true, status: { in: ['ACTIVE', 'SCHEDULED'] }, nextPublishAt: { lte: new Date() } } });
      for (const post of due) await queues.postPublish.add('publish-post', { postId: post.id }, { jobId: `post-${post.id}-${post.nextPublishAt?.getTime() ?? 0}` });
    },
    async publishPost(postId: string) {
      const publicationKey = `claim-${postId}-${Date.now()}`;
      const claimed = await db.localPost.updateMany({ where: { id: postId, status: { in: ['SCHEDULED', 'ACTIVE', 'FAILED'] }, OR: [{ publicationKey: null }, { publicationKey }] }, data: { status: 'PUBLISHING', publicationKey } });
      if (!claimed.count) return;
      const post = await db.localPost.findUniqueOrThrow({ where: { id: postId }, include: { location: { include: { account: true } } } });
      try {
        const result = await providers.google.createPost(post.location.account, post.location, post);
        const now = new Date(); const next = post.isRecurring ? nextFutureOccurrence(post.nextPublishAt ?? now, post.frequencyDays, now) : null;
        await db.localPost.update({ where: { id: post.id }, data: { googlePostId: result.googlePostId, lastPublishedAt: now, nextPublishAt: next, status: 'ACTIVE', publicationKey: null, failureCode: null, failureMessage: null } });
      } catch (error) { await db.localPost.update({ where: { id: post.id }, data: { status: 'FAILED', publicationKey: null, failureCode: error instanceof Error && 'code' in error ? String(error.code) : 'PUBLISH_FAILED', failureMessage: String(error) } }); throw error; }
    },
  };
}
