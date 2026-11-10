import { loadConfig } from './config.js';
import { startHealthServer } from './health.js';
import { createLogger } from './logger.js';

/**
 * Webhook worker entrypoint (Phase 0 skeleton).
 *
 * Phase 2/3 replaces this with:
 *  - a BullMQ queue for webhook deliveries and invoice expiry
 *  - HMAC-SHA256 signing, SSRF-safe delivery, retry schedule
 *  - delivery logs and endpoint auto-disable after continuous failures
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, 'worker');
  const health = startHealthServer(config.HEALTH_PORT, logger);

  logger.info(
    { concurrency: config.WORKER_CONCURRENCY, maxAttempts: config.WEBHOOK_MAX_ATTEMPTS },
    'worker starting (skeleton)',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await health.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
