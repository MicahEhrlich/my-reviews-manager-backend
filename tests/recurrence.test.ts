import { describe, expect, it } from 'vitest';
import { nextFutureOccurrence } from '../src/lib/recurrence.js';

describe('recurrence', () => {
  it('advances overdue schedules to the first future occurrence', () => {
    expect(nextFutureOccurrence(new Date('2026-09-01T03:00:00Z'), 6, new Date('2026-09-19T04:00:00Z')).toISOString()).toBe('2026-09-25T03:00:00.000Z');
  });
  it('rejects unsafe frequencies', () => expect(() => nextFutureOccurrence(new Date(), 0)).toThrow());
});
