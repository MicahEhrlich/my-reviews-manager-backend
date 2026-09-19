import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { MockReplyGenerator } from '../src/providers/mock.js';

const input = { businessName: 'מספרת אלי', businessCategory: 'מספרה', reviewerName: 'נועה', rating: 5, reviewText: 'מעולה', tone: 'WARM_PERSONAL' as const };
describe('mock reply provider', () => {
  it('produces deterministic tone-aware Hebrew without network access', async () => {
    const provider = new MockReplyGenerator(loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: '12345678901234567890123456789012' }));
    await expect(provider.generate(input)).resolves.toContain('תודה רבה');
  });
  it('can simulate terminal failures', async () => {
    const provider = new MockReplyGenerator(loadConfig({ NODE_ENV: 'test', COOKIE_SECRET: '12345678901234567890123456789012', MOCK_FAILURE_MODE: 'permanent' }));
    await expect(provider.generate(input)).rejects.toMatchObject({ retryable: false, code: 'MOCK_PERMANENT' });
  });
});
