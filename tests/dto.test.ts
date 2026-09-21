import { describe, expect, it } from 'vitest';
import type { Location, Review } from '@prisma/client';
import { reviewDto } from '../src/dto.js';

describe('review DTO', () => {
  it('returns the PostgreSQL AI draft as aiResponse', () => {
    const date = new Date('2026-09-21T10:00:00.000Z');
    const value = { id: 'review', locationId: 'location', reviewerName: 'לקוח', starRating: 2, comment: 'משוב', aiDraftReply: 'טיוטה שנשמרה', publishedReply: null, status: 'PENDING_APPROVAL', googleCreatedAt: date, updatedAt: date, location: { displayName: 'עסק' } } as unknown as Review & { location: Location };
    expect(reviewDto(value)).toMatchObject({ id: 'review', aiResponse: 'טיוטה שנשמרה', status: 'PENDING_APPROVAL' });
  });
});
