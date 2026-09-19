import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type KeyRing = Map<string, Buffer>;

export function parseKeyRing(value: string): KeyRing {
  const ring = new Map<string, Buffer>();
  for (const entry of value.split(',')) {
    const separator = entry.indexOf(':');
    if (separator < 1) throw new Error('Encryption keys must use version:base64');
    const version = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (key.length !== 32) throw new Error(`Encryption key ${version} must decode to 32 bytes`);
    ring.set(version, key);
  }
  if (!ring.size) throw new Error('At least one encryption key is required');
  return ring;
}

export function encryptToken(plaintext: string, ring: KeyRing): string {
  const [version, key] = ring.entries().next().value as [string, Buffer];
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [version, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptToken(encoded: string, ring: KeyRing): string {
  const [version, ivText, tagText, encryptedText] = encoded.split('.');
  if (!version || !ivText || !tagText || encryptedText === undefined) throw new Error('Invalid encrypted token');
  const key = ring.get(version);
  if (!key) throw new Error(`Unknown encryption key version: ${version}`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}
