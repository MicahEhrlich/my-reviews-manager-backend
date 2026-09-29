import { describe, expect, it } from 'vitest';
import { buildAnthropicPostContent, buildGooglePostPayload } from '../src/providers/live.js';

describe('Google post payload', () => {
  it('includes the public uploaded image as local-post media', () => {
    expect(buildGooglePostPayload({ id: 'publication', topicType: 'STANDARD', summaryText: 'טקסט', structuredPayload: null, imageUrl: 'https://images.example/posts/image.jpg' })).toEqual({ languageCode: 'he', summary: 'טקסט', topicType: 'STANDARD', media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://images.example/posts/image.jpg' }] });
  });
  it('omits media for a text-only post', () => {
    expect(buildGooglePostPayload({ id: 'publication', topicType: 'STANDARD', summaryText: 'טקסט', structuredPayload: null })).not.toHaveProperty('media');
  });
});

describe('Anthropic post content', () => {
  it('uses a text-only message when no image is present', () => {
    const content = buildAnthropicPostContent({ businessName: 'נונה', businessCategory: 'מסעדה', brief: 'ספרו על התפריט החדש' });
    expect(typeof content).toBe('string');
    expect(content).toContain('ספרו על התפריט החדש');
  });
  it('preserves image context for existing image-backed campaigns', () => {
    const content = buildAnthropicPostContent({ businessName: 'נונה', businessCategory: 'מסעדה', imageUrl: 'https://images.example/post.jpg', brief: 'תפריט חדש' });
    expect(content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image' })]));
  });
});
