import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config.js';
import { createHandlers } from '../src/jobs/handlers.js';
import type { Providers } from '../src/providers/types.js';
import type { Queues } from '../src/queues.js';

const post = { id: 'post', topicType: 'STANDARD' as const, summaryText: '', structuredPayload: null, imageUrl: 'https://images.example/post.jpg' as string | null, brief: 'תפריט חדש' as string | null, isRecurring: false, frequencyDays: 7, status: 'SCHEDULED' as const, location: { displayName: 'נונה', businessCategory: 'מסעדה', account: { agencyId: 'agency' } } };

function setup(existingText: string | null = null, postValue = post) {
  const publication = { id: 'publication', scheduledAt: new Date('2026-09-28T10:00:00.000Z'), generatedText: existingText, status: existingText ? 'FAILED' : 'QUEUED', localPost: postValue };
  const publicationUpdate = vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...publication, ...data, localPost: postValue }));
  const localPostUpdate = vi.fn().mockResolvedValue(postValue);
  const transactionClient = { postPublication: { update: publicationUpdate, upsert: vi.fn() }, localPost: { update: localPostUpdate } };
  const db = {
    agency: { findUnique: vi.fn().mockResolvedValue({ capabilities: ['READ_REVIEWS', 'PUBLISH_POSTS'] }) },
    postPublication: { findUniqueOrThrow: vi.fn().mockResolvedValue(publication), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: publicationUpdate },
    localPost: { update: localPostUpdate },
    $transaction: vi.fn().mockImplementation((work) => typeof work === 'function' ? work(transactionClient) : Promise.all(work)),
  } as unknown as PrismaClient;
  const generate = vi.fn().mockResolvedValue('טקסט חדש שנוצר מהתמונה');
  const createPost = vi.fn().mockResolvedValue({ googlePostId: 'google-post' });
  const providers = { postCopy: { generate }, google: { createPost }, replies: {}, whatsapp: {} } as unknown as Providers;
  const queues = { postPublish: { add: vi.fn() } } as unknown as Queues;
  return { handlers: createHandlers(db, providers, queues, loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: '12345678901234567890123456789012' })), generate, createPost, publicationUpdate };
}

describe('AI post publication', () => {
  it('generates, persists, and publishes image copy', async () => {
    const { handlers, generate, createPost, publicationUpdate } = setup();
    await handlers.publishPost('publication');
    expect(generate).toHaveBeenCalledWith({ businessName: 'נונה', businessCategory: 'מסעדה', imageUrl: post.imageUrl, brief: post.brief });
    expect(publicationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ generatedText: 'טקסט חדש שנוצר מהתמונה', status: 'PUBLISHING' }) }));
    expect(createPost).toHaveBeenCalledWith(post.location.account, post.location, expect.objectContaining({ summaryText: 'טקסט חדש שנוצר מהתמונה', imageUrl: post.imageUrl }));
  });

  it('reuses persisted copy when retrying a failed Google publication', async () => {
    const { handlers, generate, createPost } = setup('טקסט שכבר נוצר');
    await handlers.publishPost('publication');
    expect(generate).not.toHaveBeenCalled();
    expect(createPost).toHaveBeenCalledWith(post.location.account, post.location, expect.objectContaining({ summaryText: 'טקסט שכבר נוצר' }));
  });

  it('generates recurring copy from a brief when no image is present', async () => {
    const textPost = { ...post, imageUrl: null, brief: 'ספרו ללקוחות על התפריט החדש' };
    const { handlers, generate, createPost } = setup(null, textPost);
    await handlers.publishPost('publication');
    expect(generate).toHaveBeenCalledWith({ businessName: 'נונה', businessCategory: 'מסעדה', imageUrl: null, brief: textPost.brief });
    expect(createPost).toHaveBeenCalledWith(textPost.location.account, textPost.location, expect.objectContaining({ imageUrl: null }));
  });
});
