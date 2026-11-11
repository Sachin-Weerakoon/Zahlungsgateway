import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateWebhookSecret,
} from '../crypto.js';

const KEY = 'test-encryption-key-0123456789abcdef';

describe('webhook secret encryption', () => {
  it('round-trips a secret', () => {
    const secret = generateWebhookSecret();
    const encrypted = encryptSecret(secret, KEY);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(decryptSecret(encrypted, KEY)).toBe(secret);
  });

  it('produces a different ciphertext for the same plaintext', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('rejects the wrong key and tampered payloads', () => {
    const encrypted = encryptSecret('secret', KEY);
    expect(() => decryptSecret(encrypted, 'another-key-0123456789abcdefgh')).toThrow();
    expect(() => decryptSecret(`${encrypted.slice(0, -2)}AA`, KEY)).toThrow();
  });

  it('rejects short encryption keys', () => {
    expect(() => encryptSecret('secret', 'short')).toThrow(/32 characters/);
  });
});

describe('credential generation', () => {
  it('generates prefixed, high-entropy webhook secrets', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith('whsec_')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('generates API keys with a unique prefix', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key.startsWith(`cp_test_${a.prefix}_`)).toBe(true);
    expect(a.prefix).toMatch(/^[0-9a-f]{12}$/);
    expect(a.prefix).not.toBe(b.prefix);
    expect(a.key).not.toBe(b.key);
  });
});
