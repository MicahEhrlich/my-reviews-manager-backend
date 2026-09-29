import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type { Config } from './config.js';
import { AppError } from './lib/errors.js';

export interface StoredImage { key: string; publicUrl: string }
export interface ImageStorage {
  store(buffer: Buffer): Promise<StoredImage>;
  delete(key: string): Promise<void>;
  readLocal?(key: string): Promise<Buffer>;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function normalizePostImage(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw new AppError(400, 'INVALID_IMAGE_SIZE', 'יש להעלות תמונה בגודל של עד 10MB');
  try {
    const source = sharp(input, { failOn: 'warning', limitInputPixels: 40_000_000 });
    const metadata = await source.metadata();
    if (!['jpeg', 'png'].includes(metadata.format ?? '')) throw new AppError(400, 'INVALID_IMAGE_TYPE', 'ניתן להעלות תמונת JPEG או PNG בלבד');
    if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 250) throw new AppError(400, 'INVALID_IMAGE_DIMENSIONS', 'הצלע הקצרה של התמונה חייבת להיות לפחות 250 פיקסלים');
    return await source.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_IMAGE', 'קובץ התמונה אינו תקין');
  }
}

class LocalImageStorage implements ImageStorage {
  private directory: string;
  constructor(private config: Config) { this.directory = resolve(config.LOCAL_UPLOAD_DIR); }
  async store(buffer: Buffer) {
    await mkdir(this.directory, { recursive: true });
    const key = `${randomUUID()}.jpg`;
    await writeFile(resolve(this.directory, key), buffer, { flag: 'wx' });
    return { key, publicUrl: `${this.config.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/post-images/${key}` };
  }
  async delete(key: string) { await rm(resolve(this.directory, key), { force: true }); }
  async readLocal(key: string) {
    if (!/^[0-9a-f-]{36}\.jpg$/.test(key)) throw new AppError(404, 'IMAGE_NOT_FOUND', 'התמונה לא נמצאה');
    try { return await readFile(resolve(this.directory, key)); } catch { throw new AppError(404, 'IMAGE_NOT_FOUND', 'התמונה לא נמצאה'); }
  }
}

class S3ImageStorage implements ImageStorage {
  private client: S3Client;
  constructor(private config: Config) {
    this.client = new S3Client({
      region: config.S3_REGION,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT, forcePathStyle: true } : {}),
      credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
    });
  }
  async store(buffer: Buffer) {
    const key = `posts/${randomUUID()}.jpg`;
    await this.client.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
    return { key, publicUrl: `${this.config.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}` };
  }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key })); }
}

export function createImageStorage(config: Config): ImageStorage {
  return config.STORAGE_MODE === 's3' ? new S3ImageStorage(config) : new LocalImageStorage(config);
}
