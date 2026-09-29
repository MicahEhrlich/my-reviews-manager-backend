import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Queues } from '../src/queues.js';
import type { ImageStorage } from '../src/storage.js';

const user = { id: 'user', agencyId: 'agency', googleSubject: null, email: 'admin@revu.local', displayName: 'מנהל', role: 'ADMIN', isActive: true, createdAt: new Date(), updatedAt: new Date() } as const;
const location = { id: 'location', displayName: 'עסק', businessCategory: 'מסעדה', account: { agencyId: 'agency' } };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function setup() {
  const created = { id: 'post', locationId: location.id, topicType: 'STANDARD', summaryText: '', imageObjectKey: null, imageUrl: null, brief: 'ספרו ללקוחות על התפריט החדש', structuredPayload: null, isRecurring: true, frequencyDays: 7, nextPublishAt: new Date(), lastPublishedAt: null, status: 'SCHEDULED', failureCode: null, failureMessage: null, googlePostId: null, publicationKey: null, createdAt: new Date(), updatedAt: new Date(), location };
  const publication = { id: 'publication', localPostId: created.id, scheduledAt: new Date(), generatedText: null, googlePostId: null, status: 'QUEUED', generationStartedAt: null, publishedAt: null, failureCode: null, failureMessage: null, createdAt: new Date(), updatedAt: new Date() };
  const tx = { localPost: { create: vi.fn().mockResolvedValue(created) }, postPublication: { create: vi.fn().mockResolvedValue(publication) } };
  const db = { user: { findFirst: vi.fn().mockResolvedValue(user) }, location: { findFirst: vi.fn().mockResolvedValue(location) }, $transaction: vi.fn().mockImplementation((work) => work(tx)), $queryRaw: vi.fn() } as unknown as PrismaClient;
  const redis = { ping: vi.fn(), get: vi.fn(), getdel: vi.fn(), set: vi.fn(), del: vi.fn() } as unknown as Redis;
  const add = vi.fn(); const queues = { postPublish: { getJob: vi.fn().mockResolvedValue(null), add } } as unknown as Queues;
  const storage = { store: vi.fn(), delete: vi.fn() } satisfies ImageStorage;
  const app = await buildApp(loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: '12345678901234567890123456789012' }), db, redis, queues, storage); apps.push(app);
  const session = await app.inject({ method: 'GET', url: '/api/v1/session' });
  const csrf = session.json().csrfToken as string; const setCookie = session.headers['set-cookie']; const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
  return { app, add, storage, csrf, cookie, publication, tx };
}

describe('AI post creation API', () => {
  it('accepts a required brief and queues a text-only occurrence', async () => {
    const { app, add, storage, csrf, cookie, publication, tx } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/v1/posts', headers: { 'x-csrf-token': csrf, ...(cookie ? { cookie } : {}) }, payload: { locationId: location.id, brief: 'ספרו ללקוחות על התפריט החדש', isRecurring: true, frequencyDays: 7 } });
    expect(response.statusCode).toBe(202);
    expect(storage.store).not.toHaveBeenCalled();
    expect(tx.localPost.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ imageUrl: expect.anything() }) }));
    expect(add).toHaveBeenCalledWith('publish-post', { publicationId: publication.id }, expect.objectContaining({ jobId: `publication-${publication.id}` }));
  });

  it('stores a future publication time supplied as UTC', async () => {
    const { app, csrf, cookie, tx } = await setup();
    const publishAt = '2030-01-02T10:30:00.000Z';
    const response = await app.inject({ method: 'POST', url: '/api/v1/posts', headers: { 'x-csrf-token': csrf, ...(cookie ? { cookie } : {}) }, payload: { locationId: location.id, brief: 'ספרו ללקוחות על התפריט החדש', publishAt, isRecurring: false, frequencyDays: 7 } });
    expect(response.statusCode).toBe(202);
    expect(tx.postPublication.create).toHaveBeenCalledWith({ data: { localPostId: 'post', scheduledAt: new Date(publishAt) } });
  });

  it.each([
    [{ locationId: location.id }, 'missing'],
    [{ locationId: location.id, brief: '   ' }, 'blank'],
    [{ locationId: location.id, brief: 'קצר מדי' }, 'short'],
    [{ locationId: location.id, brief: 'א'.repeat(1_001) }, 'oversized'],
  ])('rejects an invalid brief', async (payload, _kind) => {
    const { app, csrf, cookie } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/v1/posts', headers: { 'x-csrf-token': csrf, ...(cookie ? { cookie } : {}) }, payload });
    expect(response.statusCode).toBe(400);
  });
});
