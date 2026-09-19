import { describe, expect, it } from 'vitest';
import { isRetryable, ProviderError } from '../src/lib/errors.js';
describe('provider retry classification', () => {
  it('preserves transient versus permanent failures', () => { expect(isRetryable(new ProviderError('rate limit', true))).toBe(true); expect(isRetryable(new ProviderError('invalid phone', false))).toBe(false); });
});
