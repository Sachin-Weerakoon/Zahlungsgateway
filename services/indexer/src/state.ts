import { prisma } from '@cryptopay/db';
import type { PublicClient } from 'viem';

export interface Cursor {
  lastProcessedBlock: bigint;
  lastBlockHash: string;
}

const ZERO_HASH = `0x${'0'.repeat(64)}`;
export { ZERO_HASH };

/**
 * Load the persisted block cursor, creating it on first run.
 *
 * A fresh indexer starts either at INDEXER_START_BLOCK or `head - confirmations`, so it never
 * replays the whole chain during a demo.
 */
export async function loadCursor(
  client: PublicClient,
  chainId: number,
  startBlock: number | undefined,
  confirmations: number,
): Promise<Cursor> {
  const existing = await prisma.indexerState.findUnique({ where: { chainId } });
  if (existing) {
    return {
      lastProcessedBlock: existing.lastProcessedBlock,
      lastBlockHash: existing.lastBlockHash,
    };
  }

  const head = await client.getBlockNumber();
  const firstBlock =
    startBlock !== undefined
      ? BigInt(startBlock)
      : head > BigInt(confirmations)
        ? head - BigInt(confirmations)
        : 0n;

  const cursor: Cursor =
    firstBlock === 0n
      ? { lastProcessedBlock: -1n, lastBlockHash: ZERO_HASH }
      : {
          lastProcessedBlock: firstBlock - 1n,
          lastBlockHash: (await client.getBlock({ blockNumber: firstBlock - 1n })).hash,
        };

  await saveCursor(chainId, cursor);
  return cursor;
}

export async function saveCursor(chainId: number, cursor: Cursor): Promise<void> {
  await prisma.indexerState.upsert({
    where: { chainId },
    create: {
      chainId,
      lastProcessedBlock: cursor.lastProcessedBlock,
      lastBlockHash: cursor.lastBlockHash,
    },
    update: {
      lastProcessedBlock: cursor.lastProcessedBlock,
      lastBlockHash: cursor.lastBlockHash,
    },
  });
}

/**
 * Detect a reorg by re-reading the hash of the last processed block. Returns the block to rewind
 * to when the hash changed, otherwise null.
 */
export async function detectReorg(
  client: PublicClient,
  cursor: Cursor,
  depth: number,
): Promise<bigint | null> {
  if (cursor.lastProcessedBlock < 0n) return null;

  let block;
  try {
    block = await client.getBlock({ blockNumber: cursor.lastProcessedBlock });
  } catch {
    // Pruned or unavailable block: keep going, the next range re-verifies.
    return null;
  }
  if (block.hash === cursor.lastBlockHash) return null;

  const rewindTo = cursor.lastProcessedBlock - BigInt(depth);
  return rewindTo < -1n ? -1n : rewindTo;
}
