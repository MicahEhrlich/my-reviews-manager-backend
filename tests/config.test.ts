import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('configuration', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://x:x@localhost/x', REDIS_URL: 'redis://localhost:6379', COOKIE_SECRET: '12345678901234567890123456789012' };
  it('defaults to offline providers and dev auth', () => { const config = loadConfig(base); expect(config.PROVIDER_MODE).toBe('mock'); expect(config.REPLY_PROVIDER_MODE).toBe('mock'); expect(config.AUTH_MODE).toBe('dev'); });
  it('rejects dev auth in production', () => expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/forbidden/));
  it('validates live credentials before any request', () => expect(() => loadConfig({ ...base, PROVIDER_MODE: 'live' })).toThrow(/Live providers require/));
  it('allows Anthropic replies while the other integrations stay mocked', () => {
    const config = loadConfig({ ...base, REPLY_PROVIDER_MODE: 'anthropic', ANTHROPIC_API_KEY: 'test-key' });
    expect(config.PROVIDER_MODE).toBe('mock');
    expect(config.REPLY_PROVIDER_MODE).toBe('anthropic');
  });
  it('allows live Google reads while Meta and reply generation stay mocked', () => {
    const config = loadConfig({ ...base, GOOGLE_PROVIDER_MODE: 'live', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' });
    expect(config.GOOGLE_PROVIDER_MODE).toBe('live');
    expect(config.PROVIDER_MODE).toBe('mock');
    expect(config.REPLY_PROVIDER_MODE).toBe('mock');
  });
  it('requires an API key when Anthropic replies are enabled', () => {
    expect(() => loadConfig({ ...base, REPLY_PROVIDER_MODE: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });
  it('keeps Anthropic as the default reply provider for existing live configurations', () => {
    const config = loadConfig({ ...base, PROVIDER_MODE: 'live', REPLY_PROVIDER_MODE: '', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', META_WHATSAPP_ACCESS_TOKEN: 'token', META_WHATSAPP_PHONE_NUMBER_ID: 'phone', ANTHROPIC_API_KEY: 'anthropic' });
    expect(config.REPLY_PROVIDER_MODE).toBe('anthropic');
    expect(config.STORAGE_MODE).toBe('local');
  });
});
