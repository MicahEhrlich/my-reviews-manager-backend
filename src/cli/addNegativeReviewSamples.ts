import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { createRedis } from '../lib/redis.js';
import { createQueues } from '../queues.js';
import { addNegativeReviewSamples, type NegativeReviewSampleDependencies, type NegativeReviewSamplesRun } from './negativeReviewSamples.js';

export interface NegativeReviewSamplesCliResources {
  run(): Promise<NegativeReviewSamplesRun>;
  close(): Promise<void>;
  print(result: NegativeReviewSamplesRun): void;
  printError(error: unknown): void;
}

export async function executeNegativeReviewSamplesCli(resources: NegativeReviewSamplesCliResources): Promise<number> {
  try {
    const result = await resources.run();
    resources.print(result);
    return result.successful ? 0 : 1;
  } catch (error) {
    resources.printError(error);
    return 1;
  } finally {
    await resources.close();
  }
}

async function main() {
  const config = loadConfig();
  const redis = createRedis(config.REDIS_URL);
  const queues = createQueues(redis);
  const dependencies: NegativeReviewSampleDependencies = {
    async findLocationIds(ids) {
      const locations = await prisma.location.findMany({ where: { id: { in: [...ids] } }, select: { id: true } });
      return locations.map((location) => location.id);
    },
    async createReviews(inputs) {
      return prisma.$transaction(inputs.map((data) => prisma.review.create({ data, select: { id: true, locationId: true, starRating: true } })));
    },
    enqueueReview(reviewId, jobId) {
      return queues.reviewAi.add('process-review', { reviewId }, { jobId }).then(() => undefined);
    },
    findReviews(ids) {
      return prisma.review.findMany({ where: { id: { in: ids } }, select: { id: true, locationId: true, starRating: true, status: true, aiDraftReply: true, failureCode: true, failureMessage: true }, orderBy: { starRating: 'asc' } });
    },
    sleep: (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
    randomUUID,
    now: () => new Date(),
  };

  const exitCode = await executeNegativeReviewSamplesCli({
    run: () => addNegativeReviewSamples(config, dependencies),
    close: async () => {
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
      await redis.quit();
      await prisma.$disconnect();
    },
    print: (result) => {
      console.table(result.reviews.map((review) => ({ id: review.id, location: review.locationId, rating: review.starRating, status: review.status, draft: review.aiDraftReply ?? '', failure: review.failureCode ?? '' })));
      if (result.timedOut) console.error('Timed out waiting for the worker. Make sure npm run dev:worker is running.');
      else if (!result.successful) console.error('One or more Anthropic draft jobs failed. See the failure columns and worker logs.');
      else console.log('Created three negative reviews and saved their Anthropic drafts in PostgreSQL.');
    },
    printError: (error) => console.error(error instanceof Error ? error.message : String(error)),
  });
  process.exitCode = exitCode;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) await main();

