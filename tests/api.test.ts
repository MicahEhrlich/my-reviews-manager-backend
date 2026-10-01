import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Queues } from '../src/queues.js';

const user = { id: 'user', agencyId: 'agency', googleSubject: null, email: 'admin@revu.local', displayName: 'מנהל', role: 'ADMIN', isActive: true, createdAt: new Date(), updatedAt: new Date() } as const;
const db = { user: { findFirst: async () => user }, agency: { findUniqueOrThrow: async () => ({ capabilities: ['READ_REVIEWS'] }) }, googleConnection: { findFirst: async () => null }, $queryRaw: async () => [{ '?column?': 1 }] } as unknown as PrismaClient;
const redis = { ping: async () => 'PONG', get: async () => null, getdel: async () => null, set: async () => 'OK', del: async () => 0 } as unknown as Redis;
const queues = {} as Queues;
const config = loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'dev', PROVIDER_MODE: 'mock', DATABASE_URL: 'postgresql://x:x@localhost/x', REDIS_URL: 'redis://localhost:6379', COOKIE_SECRET: '12345678901234567890123456789012' });
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('Fastify API boundary', () => {
  it('exposes unauthenticated liveness and the standard session contract', async () => {
    const app = await buildApp(config, db, redis, queues); apps.push(app);
    expect((await app.inject({ method: 'GET', url: '/health/live' })).json()).toEqual({ status: 'ok' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/session' });
    expect(response.statusCode).toBe(200); expect(response.json().user).toMatchObject({ email: 'admin@revu.local', role: 'ADMIN' }); expect(response.json().csrfToken).toBeTruthy();
  });

  it('enforces exact-origin CORS and returns the error envelope', async () => {
    const app = await buildApp(config, db, redis, queues); apps.push(app);
    const denied = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { origin: 'https://evil.example' } });
    expect(denied.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(denied.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    const missing = await app.inject({ method: 'GET', url: '/missing' });
    expect(missing.statusCode).toBe(404); expect(missing.json().error).toMatchObject({ code: 'NOT_FOUND', message: 'הנתיב לא נמצא' }); expect(missing.json().error.requestId).toBeTruthy();
  });
});
