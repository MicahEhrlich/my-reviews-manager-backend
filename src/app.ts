import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Config } from './config.js';
import { AppError } from './lib/errors.js';
import type { Queues } from './queues.js';
import { registerAuth } from './auth.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerGoogleBusinessRoutes } from './routes/googleBusiness.js';
import { createImageStorage, type ImageStorage } from './storage.js';

export async function buildApp(config: Config, db: PrismaClient, redis: Redis, queues: Queues, imageStorage: ImageStorage = createImageStorage(config)) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' ? { level: config.LOG_LEVEL } : false, genReqId: () => crypto.randomUUID() }).withTypeProvider<TypeBoxTypeProvider>();
  await app.register(cookie, { secret: config.COOKIE_SECRET });
  await app.register(cors, { origin: config.FRONTEND_ORIGIN, credentials: true, allowedHeaders: ['content-type', 'x-csrf-token', 'x-dev-user-email'] });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 8, parts: 9 } });
  await app.register(swagger, { openapi: { info: { title: 'Revu Local API', version: '0.1.0', description: 'Local backend for Google Business Profile review automation' }, servers: [{ url: `http://localhost:${config.PORT}` }] } });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async () => { await Promise.all([db.$queryRaw`SELECT 1`, redis.ping()]); return { status: 'ready' }; });
  registerAuth(app, config, db, redis);
  app.get<{ Params: { key: string } }>('/api/v1/post-images/:key', async (request, reply) => {
    if (!imageStorage.readLocal) throw new AppError(404, 'IMAGE_NOT_FOUND', 'התמונה לא נמצאה');
    const image = await imageStorage.readLocal(request.params.key);
    return reply.header('content-type', 'image/jpeg').header('cache-control', 'public, max-age=31536000, immutable').send(image);
  });
  registerGoogleBusinessRoutes(app, config, db, redis);
  registerDashboardRoutes(app, db, queues);
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'הנתיב לא נמצא', requestId: request.id } }));
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const clientStatus = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : undefined;
    const statusCode = error instanceof AppError ? error.statusCode : 'validation' in error ? 400 : clientStatus ?? 500;
    const code = error instanceof AppError ? error.code : 'validation' in error ? 'VALIDATION_ERROR' : statusCode === 413 ? 'IMAGE_TOO_LARGE' : 'REQUEST_ERROR';
    if (statusCode >= 500) request.log.error(error);
    return reply.code(statusCode).send({ error: { code, message: statusCode >= 500 ? 'אירעה שגיאה פנימית' : error.message, requestId: request.id } });
  });
  return app;
}
