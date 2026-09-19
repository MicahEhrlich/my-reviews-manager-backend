import { UnrecoverableError, Worker } from 'bullmq';
import { loadConfig } from './config.js';
import { prisma } from './lib/prisma.js';
import { createRedis } from './lib/redis.js';
import { createProviders } from './providers/factory.js';
import { createQueues, registerSchedulers } from './queues.js';
import { createHandlers } from './jobs/handlers.js';

const config = loadConfig(); const redis = createRedis(config.REDIS_URL); const queues = createQueues(redis); const providers = createProviders(config, prisma); const handlers = createHandlers(prisma, providers, queues, config);
await registerSchedulers(queues);
async function run<T>(operation: () => Promise<T>) { try { return await operation(); } catch (error) { if (error && typeof error === 'object' && 'retryable' in error && error.retryable === false) throw new UnrecoverableError(String(error)); throw error; } }
const workers = [
  new Worker('maintenance', async (job) => run(() => job.data.task === 'sync-reviews' ? handlers.syncReviews() : handlers.scanPosts()), { connection: redis, concurrency: 1 }),
  new Worker('review-ai', async (job) => run(() => handlers.processReview(job.data.reviewId, job.name === 'approve-review')), { connection: redis, concurrency: 4 }),
  new Worker('post-publish', async (job) => run(() => handlers.publishPost(job.data.postId)), { connection: redis, concurrency: 2 }),
  new Worker('notifications', async (job) => run(() => handlers.notify(job.data.reviewId)), { connection: redis, concurrency: 3 }),
];
for (const worker of workers) worker.on('failed', (job, error) => console.error({ queue: worker.name, jobId: job?.id, error }, 'Job failed'));
async function shutdown() { await Promise.all(workers.map((worker) => worker.close())); await Promise.all(Object.values(queues).map((queue) => queue.close())); await redis.quit(); await prisma.$disconnect(); }
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
console.log('Revu worker running');
