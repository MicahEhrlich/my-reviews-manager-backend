import type { ReviewStatus } from '@prisma/client';
import type { Config } from '../config.js';

const locationIds = ['eli', 'lock', 'nona'] as const;

const samples = [
  { locationId: 'eli', reviewerName: 'לקוחת בדיקה א׳', starRating: 1, comment: 'חיכיתי זמן רב לתור, לא קיבלתי עדכון ובסוף יצאתי מאוד מאוכזבת מהחוויה.' },
  { locationId: 'lock', reviewerName: 'לקוח בדיקה ב׳', starRating: 2, comment: 'ההגעה התעכבה והמחיר הסופי היה גבוה יותר ממה שהבנתי בשיחה.' },
  { locationId: 'nona', reviewerName: 'לקוחת בדיקה ג׳', starRating: 3, comment: 'האוכל היה טעים, אבל המנות הגיעו באיחור משמעותי והשירות לא עדכן אותנו.' },
] as const;

export interface NegativeReviewSampleInput {
  locationId: string;
  googleReviewId: string;
  reviewerName: string;
  starRating: number;
  comment: string;
  googleCreatedAt: Date;
  googleUpdatedAt: Date;
  queuedAt: Date;
  aiDraftReply: null;
  status: 'QUEUED';
}

export interface CreatedNegativeReviewSample {
  id: string;
  locationId: string;
  starRating: number;
}

export interface NegativeReviewSampleResult extends CreatedNegativeReviewSample {
  status: ReviewStatus;
  aiDraftReply: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface NegativeReviewSampleDependencies {
  findLocationIds(ids: readonly string[]): Promise<string[]>;
  createReviews(inputs: NegativeReviewSampleInput[]): Promise<CreatedNegativeReviewSample[]>;
  enqueueReview(reviewId: string, jobId: string): Promise<void>;
  findReviews(ids: string[]): Promise<NegativeReviewSampleResult[]>;
  sleep(milliseconds: number): Promise<void>;
  randomUUID(): string;
  now(): Date;
}

export interface NegativeReviewSamplesRun {
  reviews: NegativeReviewSampleResult[];
  successful: boolean;
  timedOut: boolean;
}

function validateConfig(config: Config) {
  if (config.NODE_ENV === 'production') throw new Error('Negative review samples are disabled in production');
  if (config.PROVIDER_MODE !== 'mock') throw new Error('Negative review samples require PROVIDER_MODE=mock to prevent live integration side effects');
  if (config.REPLY_PROVIDER_MODE !== 'anthropic') throw new Error('Negative review samples require REPLY_PROVIDER_MODE=anthropic');
  if (!config.ANTHROPIC_API_KEY) throw new Error('Negative review samples require ANTHROPIC_API_KEY');
}

export async function addNegativeReviewSamples(
  config: Config,
  dependencies: NegativeReviewSampleDependencies,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<NegativeReviewSamplesRun> {
  validateConfig(config);
  const foundLocationIds = await dependencies.findLocationIds(locationIds);
  const missing = locationIds.filter((id) => !foundLocationIds.includes(id));
  if (missing.length) throw new Error(`Missing seeded locations: ${missing.join(', ')}. Run npm run db:seed first.`);

  const runId = dependencies.randomUUID();
  const timestamp = dependencies.now();
  const created = await dependencies.createReviews(samples.map((sample) => ({
    ...sample,
    googleReviewId: `dev-negative-${runId}-${sample.starRating}`,
    googleCreatedAt: timestamp,
    googleUpdatedAt: timestamp,
    queuedAt: timestamp,
    aiDraftReply: null,
    status: 'QUEUED',
  })));
  await Promise.all(created.map((review) => dependencies.enqueueReview(review.id, `dev-negative-${review.id}`)));

  const ids = created.map((review) => review.id);
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 90_000;
  let elapsed = 0;
  let reviews = await dependencies.findReviews(ids);
  const finished = () => reviews.length === ids.length && reviews.every((review) => review.status === 'PENDING_APPROVAL' || review.status === 'FAILED');
  while (!finished() && elapsed < timeoutMs) {
    await dependencies.sleep(pollIntervalMs);
    elapsed += pollIntervalMs;
    reviews = await dependencies.findReviews(ids);
  }

  const timedOut = !finished();
  return {
    reviews,
    timedOut,
    successful: !timedOut && reviews.every((review) => review.status === 'PENDING_APPROVAL' && Boolean(review.aiDraftReply)),
  };
}

