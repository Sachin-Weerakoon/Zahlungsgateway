import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { startHealthServer, type HealthState } from './health.js';
import { createLogger } from './logger.js';

/**
 * Indexer entrypoint (Phase 0 skeleton).
 *
 * Phase 2 replaces the placeholder loop with:
 *  - ordered eth_getLogs polling with a persisted block cursor
 *  - idempotent writes on (txHash, logIndex)
 *  - confirmation tracking, reorg detection and RPC failover
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, 'indexer');

  const state: HealthState = {
    startedAt: Date.now(),
    lastProcessedBlock: null,
    rpcHealthy: false,
  };

  const health = startHealthServer(config.HEALTH_PORT, logger, state);
  logger.info(
    {
      chainId: config.CHAIN_ID,
      paymentProcessor: config.PAYMENT_PROCESSOR_ADDRESS,
      confirmations: config.INDEXER_CONFIRMATIONS,
    },
    'indexer starting (skeleton)',
  );

  let running = true;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'indexer shutting down');
    running = false;
    await health.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  while (running) {
    // Placeholder: the real polling loop lands in Phase 2.
    logger.debug('indexer heartbeat');
    await sleep(config.INDEXER_POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
