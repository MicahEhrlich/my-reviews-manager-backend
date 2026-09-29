import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { AnthropicPostCopyGenerator, AnthropicReplyGenerator, LiveGoogleProvider, MetaWhatsAppNotifier } from './live.js';
import { MockGoogleProvider, MockPostCopyGenerator, MockReplyGenerator, MockWhatsAppNotifier } from './mock.js';
import type { Providers } from './types.js';

export function createProviders(config: Config, db: PrismaClient): Providers {
  const liveIntegrations = config.PROVIDER_MODE === 'live';
  return {
    google: liveIntegrations ? new LiveGoogleProvider(db, config) : new MockGoogleProvider(db, config),
    replies: config.REPLY_PROVIDER_MODE === 'anthropic' ? new AnthropicReplyGenerator(config) : new MockReplyGenerator(config),
    postCopy: liveIntegrations || config.REPLY_PROVIDER_MODE === 'anthropic' ? new AnthropicPostCopyGenerator(config) : new MockPostCopyGenerator(config),
    whatsapp: liveIntegrations ? new MetaWhatsAppNotifier(config) : new MockWhatsAppNotifier(db, config),
  };
}
