import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from './crypto';

const TEST_KEY = randomBytes(32).toString('hex'); // 64-character hex string

describe('crypto', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    }
  });

  it('encrypt/decrypt roundtrip returns original plaintext', () => {
    const plaintext = 'EAAGm0PX4ZCpsBAKhZBZC1example-meta-token';
    const { ciphertext, iv } = encrypt(plaintext);
    const decrypted = decrypt(ciphertext, iv);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different IVs for the same plaintext', () => {
    const plaintext = 'same-token-encrypted-twice';
    const result1 = encrypt(plaintext);
    const result2 = encrypt(plaintext);
    expect(result1.iv).not.toBe(result2.iv);
  });

  it('throws when decrypting with wrong key', () => {
    const plaintext = 'secret-token';
    const { ciphertext, iv } = encrypt(plaintext);

    // Switch to a different key
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');

    expect(() => decrypt(ciphertext, iv)).toThrow();
  });

  it('throws on invalid ciphertext format', () => {
    expect(() => decrypt('not-valid-ciphertext', 'dGVzdA==')).toThrow('Invalid ciphertext format');
  });

  it('throws with clear message when TOKEN_ENCRYPTION_KEY is missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt('anything')).toThrow(
      'TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
    );
  });
});
