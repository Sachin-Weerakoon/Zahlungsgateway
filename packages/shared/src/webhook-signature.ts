import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature scheme (SRS FR-WH-2):
 *   X-Signature = hex(HMAC-SHA256(secret, `${X-Timestamp}.${rawBody}`))
 */
export function signWebhookPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

/** Constant-time verification helper, also used by the sample receiver and tests. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = signWebhookPayload(secret, timestamp, rawBody);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

/** Returns true when the timestamp is within the allowed tolerance of now. */
export function isTimestampFresh(
  timestamp: string,
  toleranceSeconds: number,
  nowMs: number = Date.now(),
): boolean {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) return false;
  const timestampMs = parsed * 1000;
  return Math.abs(nowMs - timestampMs) <= toleranceSeconds * 1000;
}
