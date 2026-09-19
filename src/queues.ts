import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export interface ReviewJob { reviewId: string }
export interface PostJob { postId: string }
export interface NotificationJob { reviewId: string }
export interface MaintenanceJob { task: 'sync-reviews' | 'scan-posts' }

const defaults = { attempts: 5, backoff: { type: 'exponential', delay: 2_000, jitter: 0.25 }, removeOnComplete: 500, removeOnFail: 2_000 } as const;
export function createQueues(connection: Redis) {
  return {
    maintenance: new Queue<MaintenanceJob, void, string>('maintenance', { connection, defaultJobOptions: defaults }),
    reviewAi: new Queue<ReviewJob, void, string>('review-ai', { connection, defaultJobOptions: defaults }),
    postPublish: new Queue<PostJob, void, string>('post-publish', { connection, defaultJobOptions: defaults }),
    notifications: new Queue<NotificationJob, void, string>('notifications', { connection, defaultJobOptions: defaults }),
  };
}
export type Queues = ReturnType<typeof createQueues>;

export async function registerSchedulers(queues: Queues) {
  await queues.maintenance.upsertJobScheduler('review-sync-5m', { every: 5 * 60_000 }, { name: 'review-sync', data: { task: 'sync-reviews' }, opts: { attempts: 3 } });
  await queues.maintenance.upsertJobScheduler('post-renewal-0300', { pattern: '0 3 * * *' }, { name: 'post-renewal', data: { task: 'scan-posts' }, opts: { attempts: 3 } });
}
