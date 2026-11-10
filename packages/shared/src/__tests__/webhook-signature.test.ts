import { describe, expect, it } from 'vitest';
import {
  isTimestampFresh,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../webhook-signature.js';

const SECRET = 'whsec_test_only_value';
const BODY = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });

describe('webhook signatures', () => {
  it('produces a deterministic HMAC-SHA256 over timestamp.body', () => {
    const signature = signWebhookPayload(SECRET, '1700000000', BODY);
    expect(signature).toBe(signWebhookPayload(SECRET, '1700000000', BODY));
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a valid signature', () => {
    const timestamp = '1700000000';
    const signature = signWebhookPayload(SECRET, timestamp, BODY);
    expect(verifyWebhookSignature(SECRET, timestamp, BODY, signature)).toBe(true);
  });

  it('rejects a modified body, timestamp or secret', () => {
    const timestamp = '1700000000';
    const signature = signWebhookPayload(SECRET, timestamp, BODY);
    expect(verifyWebhookSignature(SECRET, timestamp, `${BODY} `, signature)).toBe(false);
    expect(verifyWebhookSignature(SECRET, '1700000001', BODY, signature)).toBe(false);
    expect(verifyWebhookSignature('other', timestamp, BODY, signature)).toBe(false);
  });

  it('checks timestamp freshness with a tolerance window', () => {
    const now = 1_700_000_000_000;
    expect(isTimestampFresh('1700000000', 300, now)).toBe(true);
    expect(isTimestampFresh('1699999000', 300, now)).toBe(false);
    expect(isTimestampFresh('not-a-number', 300, now)).toBe(false);
  });
});
