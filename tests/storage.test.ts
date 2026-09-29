import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizePostImage } from '../src/storage.js';

describe('post image normalization', () => {
  it('accepts PNG input, strips it to a bounded JPEG, and preserves valid dimensions', async () => {
    const source = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#725cf2' } }).png().withMetadata().toBuffer();
    const result = await normalizePostImage(source);
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(600);
    expect(metadata.height).toBe(400);
    expect(metadata.exif).toBeUndefined();
  });

  it('rejects malformed, unsupported, and undersized images', async () => {
    await expect(normalizePostImage(Buffer.from('not-an-image'))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    const webp = await sharp({ create: { width: 300, height: 300, channels: 3, background: 'red' } }).webp().toBuffer();
    await expect(normalizePostImage(webp)).rejects.toMatchObject({ code: 'INVALID_IMAGE_TYPE' });
    const tiny = await sharp({ create: { width: 249, height: 500, channels: 3, background: 'blue' } }).jpeg().toBuffer();
    await expect(normalizePostImage(tiny)).rejects.toMatchObject({ code: 'INVALID_IMAGE_DIMENSIONS' });
  });
});
