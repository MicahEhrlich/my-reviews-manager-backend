import { loadConfig } from '../config.js';
import { createRedis } from '../lib/redis.js';
import { createQueues } from '../queues.js';
const redis = createRedis(loadConfig().REDIS_URL); const queues = createQueues(redis);
await queues.maintenance.add('manual-review-sync', { task: 'sync-reviews' }, { jobId: `manual-sync-${Date.now()}` });
await queues.maintenance.add('manual-post-scan', { task: 'scan-posts' }, { jobId: `manual-posts-${Date.now()}` });
console.log('Queued review sync and recurring-post scan');
await Promise.all(Object.values(queues).map((queue) => queue.close())); await redis.quit();
