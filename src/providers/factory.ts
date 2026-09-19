import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { AnthropicReplyGenerator, LiveGoogleProvider, MetaWhatsAppNotifier } from './live.js';
import { MockGoogleProvider, MockReplyGenerator, MockWhatsAppNotifier } from './mock.js';
import type { Providers } from './types.js';

export function createProviders(config: Config, db: PrismaClient): Providers {
  if (config.PROVIDER_MODE === 'mock') return { google: new MockGoogleProvider(db, config), replies: new MockReplyGenerator(config), whatsapp: new MockWhatsAppNotifier(db, config) };
  return { google: new LiveGoogleProvider(db, config), replies: new AnthropicReplyGenerator(config), whatsapp: new MetaWhatsAppNotifier(config) };
}
