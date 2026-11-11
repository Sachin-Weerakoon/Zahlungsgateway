import { lookup } from 'node:dns/promises';
import { prisma } from '@cryptopay/db';
import {
  HEADERS,
  WEBHOOK_RETRY_DELAYS_SECONDS,
  WEBHOOK_TIMEOUT_MS,
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  assertDeliverableWebhookUrl,
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

  const urlCheck = await assertDeliverableWebhookUrl(endpoint.url, async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map((entry) => entry.address);
  });
  if (!urlCheck.ok) {
    await markPermanentFailure(delivery.id, urlCheck.reason ?? 'webhook URL rejected');
    logger.warn(
      { deliveryId: delivery.id, eventId: delivery.eventId, reason: urlCheck.reason },
      'webhook delivery rejected by SSRF protection',
    );
    return 'failed';
  }

  const secret = decryptSecret(endpoint.secretEncrypted, config.WEBHOOK_ENCRYPTION_KEY);
  const rawBody = JSON.stringify(delivery.event.payload ?? {});
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload(secret, timestamp, rawBody);

  const startedAt = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        [HEADERS.eventId]: delivery.eventId,
        [HEADERS.timestamp]: timestamp,
        [HEADERS.signature]: signature,
      },
      body: rawBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    statusCode = response.status;
    if (response.status >= 300 && response.status < 400) {
      error = `redirect not followed (${response.status})`;
    } else if (!response.ok) {
      error = `HTTP ${response.status}`;
    }
  } catch (cause) {
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
    const outcome = await deliverWebhook(row.id, config, logger);
    stats[outcome] += 1;
  });

  return stats;
}
