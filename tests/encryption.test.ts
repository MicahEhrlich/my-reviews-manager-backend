import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, parseKeyRing } from '../src/lib/encryption.js';

describe('token encryption', () => {
  it('round-trips and authenticates AES-256-GCM ciphertext', () => {
    const ring = parseKeyRing(`v2:${Buffer.alloc(32, 2).toString('base64')},v1:${Buffer.alloc(32, 1).toString('base64')}`);
    const encrypted = encryptToken('refresh-secret', ring);
    expect(encrypted.startsWith('v2.')).toBe(true);
    expect(decryptToken(encrypted, ring)).toBe('refresh-secret');
    expect(() => decryptToken(`${encrypted.slice(0, -1)}x`, ring)).toThrow();
  });
});
