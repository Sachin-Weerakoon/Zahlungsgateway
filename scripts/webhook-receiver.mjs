#!/usr/bin/env node
/**
 * Sample merchant webhook receiver for local testing (AC-7, AC-8).
 *
 * Usage:
 *   node scripts/webhook-receiver.mjs
 *   WEBHOOK_SECRET=whsec_... PORT=4000 node scripts/webhook-receiver.mjs
 *
 * It verifies X-Signature = hex(HMAC-SHA256(secret, `${X-Timestamp}.${rawBody}`)),
 * rejects stale timestamps, and logs every delivery attempt.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4000);
const SECRET = process.env.WEBHOOK_SECRET ?? 'whsec_local_test_secret';
const TOLERANCE_SECONDS = 5 * 60;

function verify(timestamp, rawBody, signature) {
  const expected = createHmac('sha256', SECRET)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature ?? '', 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

const server = createServer((request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405).end();
    return;
  }

  let rawBody = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    rawBody += chunk;
  });
  request.on('end', () => {
    const timestamp = request.headers['x-timestamp'];
    const signature = request.headers['x-signature'];
    const eventId = request.headers['x-event-id'];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fresh =
      typeof timestamp === 'string' &&
      Math.abs(nowSeconds - Number(timestamp)) <= TOLERANCE_SECONDS;

    if (!fresh || typeof timestamp !== 'string' || !verify(timestamp, rawBody, signature)) {
      console.warn(`[reject] event=${eventId ?? '?'} reason=invalid-signature-or-stale`);
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_signature' }));
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }

    console.log(`[accept] event=${eventId} type=${payload.type} sequence=${payload.sequence}`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ received: true }));
  });
});

server.listen(PORT, () => {
  console.log(`Webhook receiver listening on http://localhost:${PORT}/webhook`);
  console.log(`Using secret: ${SECRET.slice(0, 8)}…`);
});
