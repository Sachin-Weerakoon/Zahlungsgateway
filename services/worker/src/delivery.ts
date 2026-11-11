import { lookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { prisma } from '@cryptopay/db';
import {
  HEADERS,
  WEBHOOK_RETRY_DELAYS_SECONDS,
  WEBHOOK_TIMEOUT_MS,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  isBlockedAddress,
  validateWebhookUrl,
} from '@cryptopay/shared';
import { signWebhookPayload } from '@cryptopay/shared/webhook-signature';
import { decryptSecret } from '@cryptopay/shared/crypto';
import type { WorkerConfig } from './config.js';
import type { Logger } from './logger.js';

export type DeliveryOutcome = 'delivered' | 'retried' | 'failed' | 'skipped';

export interface DeliveryStats {
  delivered: number;
  retried: number;
  failed: number;
  skipped: number;
}

const USER_AGENT = 'CryptoPay-Webhook/1.0';

/** Upper bound on how much of a response body is read before the socket is dropped. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export class BlockedAddressError extends Error {
  constructor(address: string) {
    super(`webhook host resolved to a private or reserved address (${address})`);
    this.name = 'BlockedAddressError';
  }
}

/**
 * DNS lookup that refuses private and reserved addresses. It is used as the socket's `lookup`, so
 * the address that is validated is exactly the address that is connected to; a rebinding DNS
 * server cannot answer differently between validation and connection (SEC-10).
 */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 4);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0) {
      callback(new Error(`webhook host ${hostname} did not resolve`), '', 4);
      return;
    }
    const blocked = list.find((entry) => isBlockedAddress(entry.address));
    if (blocked) {
      callback(new BlockedAddressError(blocked.address), '', 4);
      return;
    }
    if (options.all) {
      callback(null, list);
    } else {
      const first = list[0]!;
      callback(null, first.address, first.family);
    }
  });
};

/** POST a JSON body over HTTPS with pinned, SSRF-checked DNS. Redirects are never followed. */
export function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() },
        lookup: safeLookup,
        timeout: timeoutMs,
      },
      (response) => {
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) response.destroy();
        });
        response.on('close', () => resolve(response.statusCode ?? 0));
        response.on('error', () => resolve(response.statusCode ?? 0));
      },
    );
    request.on('timeout', () => request.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    request.on('error', reject);
    request.end(body);
  });
}

async function markPermanentFailure(
  deliveryId: string,
  reason: string,
  statusCode: number | null = null,
): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: WebhookDeliveryStatus.FAILED,
      statusCode,
      error: reason.slice(0, 500),
      nextRetryAt: null,
    },
  });
}

/**
 * Deliver one queued webhook attempt.
 *
 * Security properties:
 *  - The URL is re-validated structurally and by DNS immediately before every attempt, so a
 *    public hostname cannot rebind to a private address (SEC-10, AC-9).
 *  - Redirects are never followed.
 *  - The body is signed with HMAC-SHA256 over `${timestamp}.${rawBody}` (FR-WH-2).
 */
export async function deliverWebhook(
  deliveryId: string,
  config: WorkerConfig,
  logger: Logger,
): Promise<DeliveryOutcome> {
  const now = new Date();
  const claimed = await prisma.webhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: WebhookDeliveryStatus.PENDING,
      nextRetryAt: { lte: now },
    },
    data: { nextRetryAt: new Date(now.getTime() + config.WEBHOOK_LEASE_SECONDS * 1000) },
  });
  if (claimed.count === 0) return 'skipped';

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      event: {
        include: {
          invoice: {
            include: { merchant: { include: { webhook: true } } },
          },
        },
      },
    },
  });
  if (!delivery) return 'skipped';

  const endpoint = delivery.event.invoice.merchant.webhook;
  if (!endpoint || endpoint.status !== WebhookEndpointStatus.ACTIVE) {
    await markPermanentFailure(delivery.id, 'webhook endpoint is not active');
    return 'failed';
  }

  const urlCheck = validateWebhookUrl(endpoint.url);
  if (!urlCheck.ok) {
    await markPermanentFailure(delivery.id, urlCheck.reason ?? 'webhook URL rejected');
    logger.warn(
      { deliveryId: delivery.id, eventId: delivery.eventId, reason: urlCheck.reason },
      'webhook delivery rejected by SSRF protection',
    );
    return 'failed';
  }

  let secret: string;
  try {
    secret = decryptSecret(endpoint.secretEncrypted, config.WEBHOOK_ENCRYPTION_KEY);
  } catch (cause) {
    // Wrong key or corrupted ciphertext: retrying cannot help, and throwing here would abort the
    // whole delivery batch on every pass.
    await markPermanentFailure(delivery.id, 'webhook secret could not be decrypted');
    logger.error(
      {
        deliveryId: delivery.id,
        error: cause instanceof Error ? cause.message : String(cause),
      },
      'webhook secret decryption failed',
    );
    return 'failed';
  }

  const rawBody = JSON.stringify(delivery.event.payload ?? {});
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload(secret, timestamp, rawBody);

  const startedAt = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    statusCode = await postWebhook(
      endpoint.url,
      {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        [HEADERS.eventId]: delivery.eventId,
        [HEADERS.timestamp]: timestamp,
        [HEADERS.signature]: signature,
      },
      rawBody,
      WEBHOOK_TIMEOUT_MS,
    );
    if (statusCode >= 300 && statusCode < 400) {
      error = `redirect not followed (${statusCode})`;
    } else if (statusCode < 200 || statusCode >= 300) {
      error = `HTTP ${statusCode}`;
    }
  } catch (cause) {
    if (cause instanceof BlockedAddressError) {
      await markPermanentFailure(delivery.id, cause.message);
      logger.warn(
        { deliveryId: delivery.id, eventId: delivery.eventId, reason: cause.message },
        'webhook delivery rejected by SSRF protection',
      );
      return 'failed';
    }
    error = cause instanceof Error ? cause.message : String(cause);
  }

  const durationMs = Date.now() - startedAt;

  if (!error) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.SUCCEEDED,
        statusCode,
        durationMs,
        error: null,
        nextRetryAt: null,
      },
    });
    logger.info(
      { deliveryId: delivery.id, eventId: delivery.eventId, statusCode, durationMs },
      'webhook delivered',
    );
    return 'delivered';
  }

  const canRetry = delivery.attempt < config.WEBHOOK_MAX_ATTEMPTS;
  const delaySeconds =
    WEBHOOK_RETRY_DELAYS_SECONDS[
      Math.min(delivery.attempt - 1, WEBHOOK_RETRY_DELAYS_SECONDS.length - 1)
    ] ?? 3_600;

  await prisma.$transaction(async (tx) => {
    await tx.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.FAILED,
        statusCode,
        durationMs,
        error: error.slice(0, 500),
        nextRetryAt: null,
      },
    });

    if (canRetry) {
      await tx.webhookDelivery.upsert({
        where: {
          eventId_attempt: { eventId: delivery.eventId, attempt: delivery.attempt + 1 },
        },
        create: {
          eventId: delivery.eventId,
          attempt: delivery.attempt + 1,
          status: WebhookDeliveryStatus.PENDING,
          nextRetryAt: new Date(Date.now() + delaySeconds * 1000),
        },
        update: {},
      });
    }
  });

  logger.warn(
    {
      deliveryId: delivery.id,
      eventId: delivery.eventId,
      attempt: delivery.attempt,
      statusCode,
      error,
      retryInSeconds: canRetry ? delaySeconds : null,
    },
    canRetry ? 'webhook delivery failed; retry scheduled' : 'webhook delivery exhausted retries',
  );

  return canRetry ? 'retried' : 'failed';
}

async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (current !== undefined) await worker(current);
    }
  });
  await Promise.all(runners);
}

/** Claim and deliver all due webhook attempts, up to `limit` per pass. */
export async function deliverDueWebhooks(
  config: WorkerConfig,
  logger: Logger,
  limit: number,
): Promise<DeliveryStats> {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: WebhookDeliveryStatus.PENDING,
      nextRetryAt: { lte: new Date() },
    },
    orderBy: { nextRetryAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const stats: DeliveryStats = { delivered: 0, retried: 0, failed: 0, skipped: 0 };

  await runPool(due, config.WORKER_CONCURRENCY, async (row) => {
    try {
      const outcome = await deliverWebhook(row.id, config, logger);
      stats[outcome] += 1;
    } catch (error) {
      // One bad row must not abort the batch. The claim lease expires and the row is retried.
      stats.skipped += 1;
      logger.error(
        { deliveryId: row.id, error: error instanceof Error ? error.message : String(error) },
        'webhook delivery crashed; will retry after the lease expires',
      );
    }
  });

  return stats;
}
