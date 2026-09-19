import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('configuration', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://x:x@localhost/x', REDIS_URL: 'redis://localhost:6379', COOKIE_SECRET: '12345678901234567890123456789012' };
  it('defaults to offline providers and dev auth', () => { const config = loadConfig(base); expect(config.PROVIDER_MODE).toBe('mock'); expect(config.AUTH_MODE).toBe('dev'); });
  it('rejects dev auth in production', () => expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/forbidden/));
  it('validates live credentials before any request', () => expect(() => loadConfig({ ...base, PROVIDER_MODE: 'live' })).toThrow(/Live providers require/));
});
