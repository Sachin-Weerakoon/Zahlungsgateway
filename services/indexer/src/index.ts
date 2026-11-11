import { setTimeout as sleep } from 'node:timers/promises';
import { prisma } from '@cryptopay/db';
import { loadConfig } from './config.js';
import { createChainClient, paymentReceivedEvent, paymentRefundedEvent } from './chain.js';
import { startHealthServer, type HealthState } from './health.js';
import { claimLease, createInstanceId, releaseLease, renewLease } from './lease.js';
import { createLogger } from './logger.js';
import {
  processPaymentLog,
  processRefundLog,
  rewindForReorg,
  settleConfirmedInvoices,
  type PaymentLog,
  type RefundLog,
} from './processor.js';
import { ZERO_HASH, detectReorg, loadCursor, saveCursor } from './state.js';

/**
 * Indexer entrypoint (FR-IDX-1..4).
 *
 * Polls `eth_getLogs` in bounded ranges, writes payments idempotently on (txHash, logIndex),
 * tracks confirmations, settles invoices and rewinds on chain reorganisations. The chain is the
 * source of truth; the database is a projection that can be rebuilt from the deployment block.
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, 'indexer');
  const client = createChainClient(config);
  const processorAddress = config.PAYMENT_PROCESSOR_ADDRESS as `0x${string}`;
  const context = { chainId: config.CHAIN_ID, logger };
  const instanceId = createInstanceId();

  const state: HealthState = {
    startedAt: Date.now(),
    lastProcessedBlock: null,
    latestBlock: null,
    rpcHealthy: false,
    lastError: null,
  };

  const health = startHealthServer(config.INDEXER_HEALTH_PORT, logger, state);
  logger.info(
    {
      chainId: config.CHAIN_ID,
      paymentProcessor: config.PAYMENT_PROCESSOR_ADDRESS,
      confirmations: config.INDEXER_CONFIRMATIONS,
      blockRange: config.INDEXER_BLOCK_RANGE,
    },
    'indexer starting',
  );

  let running = true;
  let cursor = await loadCursor(
    client,
    config.CHAIN_ID,
    config.INDEXER_START_BLOCK,
    config.INDEXER_CONFIRMATIONS,
  );
  state.lastProcessedBlock = cursor.lastProcessedBlock;
  logger.info(
    { lastProcessedBlock: Number(cursor.lastProcessedBlock) },
    'indexer cursor loaded',
  );

  // Only one instance may advance the cursor (NFR-SCAL-1). This blocks until the current
  // holder releases the lease or its lease expires.
  logger.info({ instanceId }, 'acquiring indexer lease');
  await claimLease(config.CHAIN_ID, instanceId, config.INDEXER_LEASE_SECONDS);
  logger.info({ instanceId }, 'indexer lease acquired');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'indexer shutting down');
    running = false;
    await health.close();
    await releaseLease(config.CHAIN_ID, instanceId).catch((error: unknown) => {
      logger.warn({ error: String(error) }, 'failed to release indexer lease');
    });
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  while (running) {
    try {
      // Renew before doing any work. If another instance has taken over, stop rather than
      // write the cursor from two processes.
      if (!(await renewLease(config.CHAIN_ID, instanceId, config.INDEXER_LEASE_SECONDS))) {
        logger.error({ instanceId }, 'indexer lease lost; exiting');
        await health.close();
        await prisma.$disconnect();
        process.exit(1);
      }

      const latest = await client.getBlockNumber();
      state.latestBlock = latest;
      state.rpcHealthy = true;
      state.lastError = null;

      // Reorg detection: the hash of the last processed block must still match.
      const rewindTo = await detectReorg(client, cursor, config.INDEXER_REORG_DEPTH);
      if (rewindTo !== null) {
        await rewindForReorg(rewindTo, context);
        const hash =
          rewindTo < 0n ? ZERO_HASH : (await client.getBlock({ blockNumber: rewindTo })).hash;
        cursor = { lastProcessedBlock: rewindTo, lastBlockHash: hash };
        await saveCursor(config.CHAIN_ID, cursor);
        state.lastProcessedBlock = rewindTo;
      }

      // Only index blocks that reached the confirmation depth; those logs cannot be reorged
      // away by the time they are written.
      const safeHead = latest - BigInt(config.INDEXER_CONFIRMATIONS);
      const fromBlock = cursor.lastProcessedBlock + 1n;

      if (safeHead >= fromBlock) {
        const toBlock =
          fromBlock + BigInt(config.INDEXER_BLOCK_RANGE) - 1n > safeHead
            ? safeHead
            : fromBlock + BigInt(config.INDEXER_BLOCK_RANGE) - 1n;

        const [received, refunded] = await Promise.all([
          client.getLogs({
            address: processorAddress,
            event: paymentReceivedEvent,
            fromBlock,
            toBlock,
          }),
          client.getLogs({
            address: processorAddress,
            event: paymentRefundedEvent,
            fromBlock,
            toBlock,
          }),
        ]);

        const entries: Array<{ blockNumber: bigint; logIndex: number; apply: () => Promise<void> }> =
          [];

        for (const log of received) {
          const args = log.args;
          if (
            !args?.invoiceRef ||
            !args.merchant ||
            !args.payer ||
            !args.token ||
            args.grossAmount === undefined ||
            args.fee === undefined ||
            log.blockNumber === null ||
            log.blockHash === null
          ) {
            continue;
          }
          const entry: PaymentLog = {
            invoiceRef: args.invoiceRef,
            merchant: args.merchant,
            payer: args.payer,
            token: args.token,
            gross: args.grossAmount,
            fee: args.fee,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
          };
          entries.push({
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            apply: () => processPaymentLog(entry, context),
          });
        }

        for (const log of refunded) {
          const args = log.args;
          if (!args?.invoiceRef || args.amount === undefined || log.blockNumber === null) continue;
          const entry: RefundLog = {
            invoiceRef: args.invoiceRef,
            amount: args.amount,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: log.blockNumber,
          };
          entries.push({
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            apply: () => processRefundLog(entry, context),
          });
        }

        entries.sort((a, b) =>
          a.blockNumber === b.blockNumber
            ? a.logIndex - b.logIndex
            : a.blockNumber < b.blockNumber
              ? -1
              : 1,
        );

        for (const entry of entries) {
          await entry.apply();
        }

        const block = await client.getBlock({ blockNumber: toBlock });
        cursor = { lastProcessedBlock: toBlock, lastBlockHash: block.hash };
        await saveCursor(config.CHAIN_ID, cursor);
        state.lastProcessedBlock = toBlock;

        logger.debug(
          { fromBlock: Number(fromBlock), toBlock: Number(toBlock), logs: entries.length },
          'block range indexed',
        );
      }

      await settleConfirmedInvoices(latest, config.INDEXER_CONFIRMATIONS, context);
      state.lastProcessedBlock = cursor.lastProcessedBlock;
    } catch (error) {
      state.rpcHealthy = false;
      state.lastError = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: state.lastError },
        'indexer tick failed; retrying after the poll interval',
      );
    }

    if (running) await sleep(config.INDEXER_POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
