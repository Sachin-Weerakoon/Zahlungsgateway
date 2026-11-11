import { setTimeout as sleep } from 'node:timers/promises';
import { prisma } from '@cryptopay/db';
import { WebhookDeliveryStatus } from '@cryptopay/shared';
import { loadConfig } from './config.js';
import { deliverDueWebhooks } from './delivery.js';
import { expireDueInvoices } from './expiry.js';
import { startHealthServer, type WorkerHealthStats } from './health.js';
import { createLogger } from './logger.js';

/**
 * Webhook worker entrypoint (FR-WH-1..5).
 *
 * Deliveries are a durable database queue (`WebhookDelivery` rows) rather than an external
 * broker, so retries survive restarts without adding Redis to the demo stack. Each row is one
 * attempt; a failed attempt schedules the next one with the SRS backoff schedule.
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, 'worker');

  const getStats = async (): Promise<WorkerHealthStats> => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [pending, failedLast24h, succeededLast24h, last] = await Promise.all([
      prisma.webhookDelivery.count({ where: { status: WebhookDeliveryStatus.PENDING } }),
      prisma.webhookDelivery.count({
        where: { status: WebhookDeliveryStatus.FAILED, createdAt: { gte: dayAgo } },
      }),
      prisma.webhookDelivery.count({
        where: { status: WebhookDeliveryStatus.SUCCEEDED, createdAt: { gte: dayAgo } },
      }),
      prisma.webhookDelivery.findFirst({
        where: { status: WebhookDeliveryStatus.SUCCEEDED },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      pending,
      failedLast24h,
      succeededLast24h,
      lastDeliveryAt: last?.createdAt.toISOString() ?? null,
    };
  };

  const health = startHealthServer(config.WORKER_HEALTH_PORT, logger, getStats);

  logger.info(
    {
      concurrency: config.WORKER_CONCURRENCY,
      maxAttempts: config.WEBHOOK_MAX_ATTEMPTS,
      chainId: config.CHAIN_ID,
    },
    'worker starting',
  );

  let running = true;
  let lastExpirySweep = 0;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    running = false;
    await health.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  while (running) {
    try {
      const stats = await deliverDueWebhooks(config, logger, config.WORKER_CONCURRENCY * 2);
      if (stats.delivered + stats.retried + stats.failed > 0) {
        logger.debug(stats, 'webhook pass complete');
      }

      if (Date.now() - lastExpirySweep >= config.WORKER_EXPIRY_INTERVAL_MS) {
        lastExpirySweep = Date.now();
        await expireDueInvoices(config.CHAIN_ID, logger);
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'worker pass failed; retrying after the poll interval',
      );
    }

    if (running) await sleep(config.WORKER_POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
