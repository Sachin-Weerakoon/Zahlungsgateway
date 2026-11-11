import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Symmetric encryption for webhook signing secrets at rest.
 *
 * Secrets are never stored in plaintext and never returned after creation (SRS SEC-2).
 * Format: `v1:<base64(iv || authTag || ciphertext)>` with AES-256-GCM.
 */

const VERSION = 'v1';
const KEY_SALT = 'cryptopay-webhook-secret';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(encryptionKey: string): Buffer {
  if (encryptionKey.length < 32) {
    throw new Error('WEBHOOK_ENCRYPTION_KEY must be at least 32 characters');
  }
  return scryptSync(encryptionKey, KEY_SALT, 32);
}

export function encryptSecret(plaintext: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decryptSecret(payload: string, encryptionKey: string): string {
  const [version, encoded] = payload.split(':');
  if (version !== VERSION || !encoded) {
    throw new Error('Unsupported encrypted secret format');
  }
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted secret is truncated');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(encryptionKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Generate a webhook signing secret with the documented prefix. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/** Generate an API key. The full value is shown once; only the hash is stored. */
export function generateApiKey(): { key: string; prefix: string } {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { key: `cp_test_${prefix}_${secret}`, prefix };
}

/** SHA-256 hash of a full API key, stored instead of the key itself. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
