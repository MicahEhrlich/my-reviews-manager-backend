import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config.js';
import { createProviders } from '../src/providers/factory.js';
import { AnthropicReplyGenerator } from '../src/providers/live.js';
import { MockGoogleProvider, MockWhatsAppNotifier } from '../src/providers/mock.js';

describe('provider factory', () => {
  it('combines Anthropic replies with mock Google and WhatsApp providers', () => {
    const config = loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: '12345678901234567890123456789012', PROVIDER_MODE: 'mock', REPLY_PROVIDER_MODE: 'anthropic', ANTHROPIC_API_KEY: 'test-key' });
    const providers = createProviders(config, {} as PrismaClient);
    expect(providers.google).toBeInstanceOf(MockGoogleProvider);
    expect(providers.replies).toBeInstanceOf(AnthropicReplyGenerator);
    expect(providers.whatsapp).toBeInstanceOf(MockWhatsAppNotifier);
  });
});
