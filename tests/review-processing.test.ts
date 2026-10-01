import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Review } from '@prisma/client';
import { loadConfig } from '../src/config.js';
import { createHandlers } from '../src/jobs/handlers.js';
import { ProviderError } from '../src/lib/errors.js';
import type { Providers } from '../src/providers/types.js';
import type { Queues } from '../src/queues.js';

const review = {
  id: 'review-low',
  reviewerName: 'שם שלא יישלח',
  starRating: 2,
  comment: 'המתנתי זמן רב לקבלת שירות',
  aiDraftReply: 'טיוטה קודמת',
  location: {
    id: 'location',
    displayName: 'עסק לדוגמה',
    businessCategory: 'שירותים',
    defaultTone: 'PROFESSIONAL',
    autoReplyEnabled: true,
    whatsappAlertNumber: null,
    account: { agencyId: 'agency' },
  },
} as unknown as Review & { location: { id: string; displayName: string; businessCategory: string; defaultTone: 'PROFESSIONAL'; autoReplyEnabled: boolean; whatsappAlertNumber: string | null; account: object } };

function setup(generate: Providers['replies']['generate'], reviewValue = review, capabilities = ['READ_REVIEWS', 'REPLY_TO_REVIEWS', 'AUTO_REPLY']) {
  const update = vi.fn().mockResolvedValue(review);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = {
    agency: { findUnique: vi.fn().mockResolvedValue({ capabilities }) },
    review: {
      updateMany,
      findUniqueOrThrow: vi.fn().mockResolvedValue(reviewValue),
      update,
    },
  } as unknown as PrismaClient;
  const providers = {
    replies: { generate },
    google: { listReviews: vi.fn(), replyToReview: vi.fn(), createPost: vi.fn() },
    whatsapp: { send: vi.fn() },
  } as unknown as Providers;
  const queues = { notifications: { add: vi.fn() } } as unknown as Queues;
  const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: '12345678901234567890123456789012' });
  return { handlers: createHandlers(db, providers, queues, config), providers, update, updateMany };
}

describe('review reply processing', () => {
  it('persists a generated low-review draft for approval without publishing it', async () => {
    const generate = vi.fn().mockResolvedValue('תודה על המשוב. נשמח לבדוק את הנושא באופן פרטי.');
    const { handlers, providers, update, updateMany } = setup(generate);

    await handlers.processReview(review.id);

    expect(updateMany).toHaveBeenCalledWith({ where: { id: review.id, status: { in: ['QUEUED', 'FAILED'] } }, data: { status: 'PROCESSING', processingStartedAt: expect.any(Date), failureCode: null, failureMessage: null } });
    expect(generate).toHaveBeenCalledWith({ businessName: 'עסק לדוגמה', businessCategory: 'שירותים', rating: 2, reviewText: review.comment, tone: 'PROFESSIONAL' });
    expect(generate.mock.calls[0]?.[0]).not.toHaveProperty('reviewerName');
    expect(providers.google.replyToReview).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith({ where: { id: review.id }, data: { aiDraftReply: 'תודה על המשוב. נשמח לבדוק את הנושא באופן פרטי.', status: 'PENDING_APPROVAL', processedAt: expect.any(Date) } });
  });

  it('keeps the existing positive-review auto-publish behavior', async () => {
    const positiveReview = { ...review, starRating: 5 } as typeof review;
    const { handlers, providers, update } = setup(vi.fn().mockResolvedValue('תודה על המשוב החיובי.'), positiveReview);

    await handlers.processReview(positiveReview.id);

    expect(providers.google.replyToReview).toHaveBeenCalledWith(positiveReview.location.account, positiveReview.location, positiveReview, 'תודה על המשוב החיובי.');
    expect(update).toHaveBeenLastCalledWith({ where: { id: positiveReview.id }, data: { aiDraftReply: 'תודה על המשוב החיובי.', publishedReply: 'תודה על המשוב החיובי.', status: 'AUTO_SENT', processedAt: expect.any(Date) } });
  });

  it('keeps positive reviews as local drafts when the workspace is read-only', async () => {
    const positiveReview = { ...review, starRating: 5 } as typeof review;
    const { handlers, providers, update } = setup(vi.fn().mockResolvedValue('טיוטה מקומית בלבד.'), positiveReview, ['READ_REVIEWS']);

    await handlers.processReview(positiveReview.id);

    expect(providers.google.replyToReview).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith({ where: { id: positiveReview.id }, data: { aiDraftReply: 'טיוטה מקומית בלבד.', status: 'PENDING_APPROVAL', processedAt: expect.any(Date) } });
  });

  it('persists failure metadata without clearing a previous successful draft', async () => {
    const failure = new ProviderError('Anthropic unavailable', true, 'ANTHROPIC_UNAVAILABLE');
    const { handlers, update } = setup(vi.fn().mockRejectedValue(failure));

    await expect(handlers.processReview(review.id)).rejects.toBe(failure);

    const failureUpdate = update.mock.calls.at(-1)?.[0];
    expect(failureUpdate).toEqual({ where: { id: review.id }, data: { status: 'FAILED', failureCode: 'ANTHROPIC_UNAVAILABLE', failureMessage: String(failure) } });
    expect(failureUpdate.data).not.toHaveProperty('aiDraftReply');
  });
});
