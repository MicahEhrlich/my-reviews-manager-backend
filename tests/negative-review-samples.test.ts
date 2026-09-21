import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { executeNegativeReviewSamplesCli } from '../src/cli/addNegativeReviewSamples.js';
import { addNegativeReviewSamples, type NegativeReviewSampleDependencies, type NegativeReviewSampleInput, type NegativeReviewSampleResult } from '../src/cli/negativeReviewSamples.js';

const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: '12345678901234567890123456789012', PROVIDER_MODE: 'mock', REPLY_PROVIDER_MODE: 'anthropic', ANTHROPIC_API_KEY: 'test-key' });

const completed = (id: string, locationId: string, starRating: number): NegativeReviewSampleResult => ({
  id,
  locationId,
  starRating,
  status: 'PENDING_APPROVAL',
  aiDraftReply: `טיוטה לדירוג ${starRating}`,
  failureCode: null,
  failureMessage: null,
});

function dependencies(overrides: Partial<NegativeReviewSampleDependencies> = {}) {
  let createdInputs: NegativeReviewSampleInput[] = [];
  const created = [
    { id: 'review-1', locationId: 'eli', starRating: 1 },
    { id: 'review-2', locationId: 'lock', starRating: 2 },
    { id: 'review-3', locationId: 'nona', starRating: 3 },
  ];
  const values: NegativeReviewSampleDependencies = {
    findLocationIds: vi.fn().mockResolvedValue(['eli', 'lock', 'nona']),
    createReviews: vi.fn().mockImplementation(async (inputs: NegativeReviewSampleInput[]) => { createdInputs = inputs; return created; }),
    enqueueReview: vi.fn().mockResolvedValue(undefined),
    findReviews: vi.fn().mockResolvedValue(created.map((review) => completed(review.id, review.locationId, review.starRating))),
    sleep: vi.fn().mockResolvedValue(undefined),
    randomUUID: () => 'run-uuid',
    now: () => new Date('2026-09-21T10:00:00.000Z'),
    ...overrides,
  };
  return { values, created, inputs: () => createdInputs };
}

describe('negative review sample workflow', () => {
  it('creates and queues one-, two-, and three-star reviews across all seeded locations', async () => {
    const setup = dependencies();
    const result = await addNegativeReviewSamples(config, setup.values);

    expect(result).toMatchObject({ successful: true, timedOut: false });
    expect(setup.inputs().map(({ locationId, starRating, status, aiDraftReply }) => ({ locationId, starRating, status, aiDraftReply }))).toEqual([
      { locationId: 'eli', starRating: 1, status: 'QUEUED', aiDraftReply: null },
      { locationId: 'lock', starRating: 2, status: 'QUEUED', aiDraftReply: null },
      { locationId: 'nona', starRating: 3, status: 'QUEUED', aiDraftReply: null },
    ]);
    expect(setup.inputs().map((input) => input.googleReviewId)).toEqual(['dev-negative-run-uuid-1', 'dev-negative-run-uuid-2', 'dev-negative-run-uuid-3']);
    expect(setup.values.enqueueReview).toHaveBeenCalledTimes(3);
    expect(setup.values.enqueueReview).toHaveBeenNthCalledWith(1, 'review-1', 'dev-negative-review-1');
  });

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['live integrations', { PROVIDER_MODE: 'live' }],
    ['mock replies', { REPLY_PROVIDER_MODE: 'mock' }],
    ['missing Anthropic key', { ANTHROPIC_API_KEY: '' }],
  ])('refuses unsafe configuration: %s', async (_label, patch) => {
    const setup = dependencies();
    await expect(addNegativeReviewSamples({ ...config, ...patch } as Config, setup.values)).rejects.toThrow();
    expect(setup.values.createReviews).not.toHaveBeenCalled();
  });

  it('fails before creating reviews when a seeded location is missing', async () => {
    const setup = dependencies({ findLocationIds: vi.fn().mockResolvedValue(['eli', 'lock']) });
    await expect(addNegativeReviewSamples(config, setup.values)).rejects.toThrow(/nona/);
    expect(setup.values.createReviews).not.toHaveBeenCalled();
  });

  it('reports a completed Anthropic failure', async () => {
    const setup = dependencies({ findReviews: vi.fn().mockResolvedValue([{ ...completed('review-1', 'eli', 1), status: 'FAILED', aiDraftReply: null, failureCode: 'ANTHROPIC_ERROR', failureMessage: 'request failed' }, completed('review-2', 'lock', 2), completed('review-3', 'nona', 3)]) });
    const result = await addNegativeReviewSamples(config, setup.values);
    expect(result).toMatchObject({ successful: false, timedOut: false });
    expect(result.reviews[0]).toMatchObject({ status: 'FAILED', failureCode: 'ANTHROPIC_ERROR' });
  });

  it('times out when the worker leaves reviews queued', async () => {
    const setup = dependencies({ findReviews: vi.fn().mockResolvedValue([
      { ...completed('review-1', 'eli', 1), status: 'QUEUED', aiDraftReply: null },
      { ...completed('review-2', 'lock', 2), status: 'QUEUED', aiDraftReply: null },
      { ...completed('review-3', 'nona', 3), status: 'QUEUED', aiDraftReply: null },
    ]) });
    const result = await addNegativeReviewSamples(config, setup.values, { pollIntervalMs: 10, timeoutMs: 20 });
    expect(result).toMatchObject({ successful: false, timedOut: true });
    expect(setup.values.sleep).toHaveBeenCalledTimes(2);
  });
});

describe('negative review sample CLI lifecycle', () => {
  it('closes resources after success', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const result = { reviews: [], successful: true, timedOut: false };
    await expect(executeNegativeReviewSamplesCli({ run: vi.fn().mockResolvedValue(result), close, print: vi.fn(), printError: vi.fn() })).resolves.toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes resources and returns failure when execution throws', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const printError = vi.fn();
    await expect(executeNegativeReviewSamplesCli({ run: vi.fn().mockRejectedValue(new Error('boom')), close, print: vi.fn(), printError })).resolves.toBe(1);
    expect(printError).toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});

