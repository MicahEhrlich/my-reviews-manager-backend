import { loadConfig } from './config.js';
import { prisma } from './lib/prisma.js';
import { createRedis } from './lib/redis.js';
import { createQueues } from './queues.js';
import { buildApp } from './app.js';

const config = loadConfig(); const redis = createRedis(config.REDIS_URL); const queues = createQueues(redis); const app = await buildApp(config, prisma, redis, queues);
async function shutdown() { await app.close(); await Promise.all(Object.values(queues).map((queue) => queue.close())); await redis.quit(); await prisma.$disconnect(); }
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
await app.listen({ host: '0.0.0.0', port: config.PORT });
