import { describe, expect, it } from 'vitest';
import { googleResourceId } from '../src/google/discovery.js';

describe('Google Business resource parsing', () => {
  it('extracts account and location ids from canonical resource names', () => {
    expect(googleResourceId('accounts/123456', 'accounts')).toBe('123456');
    expect(googleResourceId('locations/abc_DEF-9', 'locations')).toBe('abc_DEF-9');
  });

  it('rejects malformed or mismatched resource names', () => {
    expect(() => googleResourceId('locations/123', 'accounts')).toThrow(/Invalid Google accounts/);
    expect(() => googleResourceId('123', 'locations')).toThrow(/Invalid Google locations/);
  });
});
