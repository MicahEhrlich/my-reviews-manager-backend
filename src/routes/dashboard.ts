import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, ReviewStatus } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { locationDto, postDto, reviewDto } from '../dto.js';
import { tenantLocation } from '../auth.js';
import type { Queues } from '../queues.js';

const paging = Type.Object({ locationId: Type.Optional(Type.String()), cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) });
const reviewQuery = Type.Intersect([paging, Type.Object({ status: Type.Optional(Type.String()), rating: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })), q: Type.Optional(Type.String({ maxLength: 200 })) })]);

export function registerDashboardRoutes(app: FastifyInstance, db: PrismaClient, queues: Queues) {
  app.get('/api/v1/locations', async (request) => {
    const values = await db.location.findMany({ where: { account: { agencyId: request.currentUser.agencyId } }, orderBy: { displayName: 'asc' } });
    return { locations: values.map(locationDto) };
  });
  app.get('/api/v1/bootstrap', async (request) => {
    const locations = await db.location.findMany({ where: { account: { agencyId: request.currentUser.agencyId } }, orderBy: { displayName: 'asc' } });
    const reviews = await db.review.findMany({ where: { location: { account: { agencyId: request.currentUser.agencyId } }, status: { not: 'DELETED' } }, include: { location: true }, orderBy: { googleCreatedAt: 'desc' }, take: 100 });
    const posts = await db.localPost.findMany({ where: { location: { account: { agencyId: request.currentUser.agencyId } } }, include: { location: true, publications: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { locations: locations.map(locationDto), reviews: reviews.map(reviewDto), posts: posts.map(postDto) };
  });
  app.get<{ Querystring: { locationId?: string } }>('/api/v1/overview/stats', { schema: { querystring: Type.Object({ locationId: Type.Optional(Type.String()) }) } }, async (request) => {
    const where = { location: { account: { agencyId: request.currentUser.agencyId }, ...(request.query.locationId ? { id: request.query.locationId } : {}) }, status: { not: 'DELETED' as const } };
    const [aggregate, pending, responded] = await Promise.all([
      db.review.aggregate({ where, _count: true, _avg: { starRating: true } }),
      db.review.count({ where: { ...where, status: 'PENDING_APPROVAL' } }),
      db.review.count({ where: { ...where, status: { in: ['AUTO_SENT', 'APPROVED'] } } }),
    ]);
    return { totalReviews: aggregate._count, averageRating: Number((aggregate._avg.starRating ?? 0).toFixed(1)), responseRate: aggregate._count ? Math.round((responded / aggregate._count) * 100) : 0, pendingApprovalCount: pending };
  });
  app.get<{ Querystring: { locationId?: string; cursor?: string; limit?: number; status?: string; rating?: number; q?: string } }>('/api/v1/reviews', { schema: { querystring: reviewQuery } }, async (request) => {
    const limit = request.query.limit ?? 25;
    const allowed = new Set<ReviewStatus>(['QUEUED', 'PROCESSING', 'PENDING_APPROVAL', 'APPROVING', 'AUTO_SENT', 'APPROVED', 'FAILED', 'DELETED']);
    const status = request.query.status && allowed.has(request.query.status as ReviewStatus) ? request.query.status as ReviewStatus : undefined;
    const values = await db.review.findMany({ where: { location: { account: { agencyId: request.currentUser.agencyId }, ...(request.query.locationId ? { id: request.query.locationId } : {}) }, ...(status ? { status } : { status: { not: 'DELETED' } }), ...(request.query.rating ? { starRating: request.query.rating } : {}), ...(request.query.q ? { OR: [{ reviewerName: { contains: request.query.q, mode: 'insensitive' } }, { comment: { contains: request.query.q, mode: 'insensitive' } }] } : {}) }, include: { location: true }, orderBy: [{ googleCreatedAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(request.query.cursor ? { cursor: { id: request.query.cursor }, skip: 1 } : {}) });
    const hasMore = values.length > limit; const page = values.slice(0, limit);
    return { reviews: page.map(reviewDto), nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
  });
  app.get<{ Querystring: { locationId?: string; cursor?: string; limit?: number } }>('/api/v1/posts', { schema: { querystring: paging } }, async (request) => {
    const limit = request.query.limit ?? 25;
    const values = await db.localPost.findMany({ where: { location: { account: { agencyId: request.currentUser.agencyId }, ...(request.query.locationId ? { id: request.query.locationId } : {}) } }, include: { location: true, publications: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(request.query.cursor ? { cursor: { id: request.query.cursor }, skip: 1 } : {}) });
    const page = values.slice(0, limit); return { posts: page.map(postDto), nextCursor: values.length > limit ? page.at(-1)?.id ?? null : null };
  });

  app.put<{ Params: { id: string }; Body: { draft: string } }>('/api/v1/reviews/:id/draft', { schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({ draft: Type.String({ minLength: 1, maxLength: 4000 }) }) } }, async (request) => {
    const review = await ownedReview(db, request.currentUser.agencyId, request.params.id); if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'הביקורת לא נמצאה');
    if (review.status !== 'PENDING_APPROVAL') throw new AppError(409, 'REVIEW_NOT_EDITABLE', 'לא ניתן לערוך ביקורת במצב זה');
    const updated = await db.review.update({ where: { id: review.id }, data: { aiDraftReply: request.body.draft.trim() }, include: { location: true } }); return { review: reviewDto(updated) };
  });
  app.post<{ Params: { id: string } }>('/api/v1/reviews/:id/approve', { schema: { params: Type.Object({ id: Type.String() }) } }, async (request, reply) => {
    const review = await ownedReview(db, request.currentUser.agencyId, request.params.id); if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'הביקורת לא נמצאה');
    if (review.status !== 'PENDING_APPROVAL' || !review.aiDraftReply) throw new AppError(409, 'REVIEW_NOT_APPROVABLE', 'אין תשובה הממתינה לאישור');
    await db.review.update({ where: { id: review.id }, data: { status: 'APPROVING' } });
    await queues.reviewAi.add('approve-review', { reviewId: review.id }, { jobId: `approve-${review.id}-${review.updatedAt.getTime()}` });
    return reply.code(202).send({ id: review.id, status: 'APPROVING' });
  });
  app.delete<{ Params: { id: string } }>('/api/v1/reviews/:id', { schema: { params: Type.Object({ id: Type.String() }) } }, async (request, reply) => {
    const review = await ownedReview(db, request.currentUser.agencyId, request.params.id); if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'הביקורת לא נמצאה');
    await db.review.update({ where: { id: review.id }, data: { status: 'DELETED' } }); return reply.code(204).send();
  });
  app.post<{ Body: { locationId: string; brief: string; publishAt?: string; isRecurring?: boolean; frequencyDays?: number } }>('/api/v1/posts', { schema: { body: Type.Object({ locationId: Type.String(), brief: Type.String({ minLength: 1, maxLength: 1_000 }), publishAt: Type.Optional(Type.String({ format: 'date-time' })), isRecurring: Type.Optional(Type.Boolean()), frequencyDays: Type.Optional(Type.Integer()) }) } }, async (request, reply) => {
    const location = await tenantLocation(db, request, request.body.locationId); if (!location) throw new AppError(404, 'LOCATION_NOT_FOUND', 'המיקום לא נמצא');
    const brief = request.body.brief.trim(); if (brief.length < 10) throw new AppError(400, 'BRIEF_TOO_SHORT', 'הבריף חייב להכיל לפחות 10 תווים');
    const isRecurring = request.body.isRecurring ?? false;
    const frequencyDays = request.body.frequencyDays ?? 7; if (isRecurring && ![3, 5, 7, 14].includes(frequencyDays)) throw new AppError(400, 'INVALID_FREQUENCY', 'יש לבחור תדירות חוקית');
    const requestedAt = request.body.publishAt ? new Date(request.body.publishAt) : new Date(); if (Number.isNaN(requestedAt.getTime())) throw new AppError(400, 'INVALID_PUBLISH_AT', 'מועד הפרסום אינו תקין');
    const scheduledAt = requestedAt.getTime() < Date.now() ? new Date() : requestedAt;
    const post = await db.$transaction(async (tx) => {
      const created = await tx.localPost.create({ data: { locationId: location.id, topicType: 'STANDARD', summaryText: '', brief, isRecurring, frequencyDays, nextPublishAt: scheduledAt, status: 'SCHEDULED' }, include: { location: true } });
      const publication = await tx.postPublication.create({ data: { localPostId: created.id, scheduledAt } });
      return { ...created, publications: [publication] };
    });
    const publication = post.publications[0]; if (!publication) throw new Error('Publication was not created');
    await enqueuePublication(queues, publication.id, Math.max(0, scheduledAt.getTime() - Date.now())).catch((error) => request.log.error(error, 'Initial post enqueue failed; recovery scan will retry'));
    return reply.code(202).send({ post: postDto(post) });
  });
  app.patch<{ Params: { id: string }; Body: { status: 'ACTIVE'|'PAUSED' } }>('/api/v1/posts/:id/status', { schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({ status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('PAUSED')]) }) } }, async (request) => {
    const post = await db.localPost.findFirst({ where: { id: request.params.id, location: { account: { agencyId: request.currentUser.agencyId } } } }); if (!post) throw new AppError(404, 'POST_NOT_FOUND', 'הפוסט לא נמצא');
    if (request.body.status === 'PAUSED') {
      const [updated, queued] = await Promise.all([db.localPost.update({ where: { id: post.id }, data: { status: 'PAUSED' }, include: { location: true, publications: { orderBy: { createdAt: 'desc' }, take: 1 } } }), db.postPublication.findMany({ where: { localPostId: post.id, status: 'QUEUED' }, select: { id: true } })]);
      await Promise.all(queued.map(async ({ id }) => { const job = await queues.postPublish.getJob(`publication-${id}`); await job?.remove(); }));
      return { post: postDto(updated) };
    }
    let nextPublishAt = post.nextPublishAt;
    if (post.isRecurring && post.status === 'PAUSED') {
      nextPublishAt = new Date(Date.now() + post.frequencyDays * 86_400_000);
      await db.$transaction([db.postPublication.deleteMany({ where: { localPostId: post.id, status: 'QUEUED' } }), db.postPublication.create({ data: { localPostId: post.id, scheduledAt: nextPublishAt } })]);
    }
    const updated = await db.localPost.update({ where: { id: post.id }, data: { status: 'ACTIVE', nextPublishAt, failureCode: null, failureMessage: null }, include: { location: true, publications: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    const queued = updated.publications[0];
    if (post.isRecurring && nextPublishAt && queued) await enqueuePublication(queues, queued.id, Math.max(0, nextPublishAt.getTime() - Date.now()));
    return { post: postDto(updated) };
  });
  app.post<{ Params: { id: string } }>('/api/v1/posts/:id/retry', { schema: { params: Type.Object({ id: Type.String() }) } }, async (request, reply) => {
    const post = await db.localPost.findFirst({ where: { id: request.params.id, location: { account: { agencyId: request.currentUser.agencyId } } }, include: { location: true, publications: { where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!post) throw new AppError(404, 'POST_NOT_FOUND', 'הפוסט לא נמצא');
    const publication = post.publications[0]; if (!publication) throw new AppError(409, 'POST_NOT_RETRYABLE', 'אין פרסום שניתן לנסות שוב');
    await db.$transaction([db.postPublication.update({ where: { id: publication.id }, data: { status: 'QUEUED', failureCode: null, failureMessage: null } }), db.localPost.update({ where: { id: post.id }, data: { status: 'SCHEDULED', failureCode: null, failureMessage: null } })]);
    await enqueuePublication(queues, publication.id);
    const updated = await db.localPost.findUniqueOrThrow({ where: { id: post.id }, include: { location: true, publications: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    return reply.code(202).send({ post: postDto(updated) });
  });
  app.patch<{ Params: { id: string }; Body: { defaultTone?: 'WARM_PERSONAL'|'PROFESSIONAL'|'SHORT_DIRECT'; autoReplyEnabled?: boolean; whatsappAlertNumber?: string|null } }>('/api/v1/locations/:id/settings', { schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({ defaultTone: Type.Optional(Type.Union([Type.Literal('WARM_PERSONAL'), Type.Literal('PROFESSIONAL'), Type.Literal('SHORT_DIRECT')])), autoReplyEnabled: Type.Optional(Type.Boolean()), whatsappAlertNumber: Type.Optional(Type.Union([Type.String({ pattern: '^\\+[1-9]\\d{7,14}$' }), Type.Null()])) }, { minProperties: 1 }) } }, async (request) => {
    const location = await tenantLocation(db, request, request.params.id); if (!location) throw new AppError(404, 'LOCATION_NOT_FOUND', 'המיקום לא נמצא');
    const updated = await db.location.update({ where: { id: location.id }, data: request.body }); return { location: locationDto(updated) };
  });
}

function ownedReview(db: PrismaClient, agencyId: string, id: string) { return db.review.findFirst({ where: { id, location: { account: { agencyId } } } }); }

async function enqueuePublication(queues: Queues, publicationId: string, delay = 0) {
  const jobId = `publication-${publicationId}`; const existing = await queues.postPublish.getJob(jobId);
  if (existing) { if (await existing.getState() === 'failed') await existing.retry(); return; }
  await queues.postPublish.add('publish-post', { publicationId }, { jobId, delay });
}
