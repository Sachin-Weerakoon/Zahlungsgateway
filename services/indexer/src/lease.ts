import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { prisma } from '@cryptopay/db';

/**
 * Single-indexer lease (NFR-SCAL-1).
 *
 * Only one indexer may advance a chain's cursor. Each instance claims a short lease on the
 * `IndexerState` row and renews it on every tick. A crashed instance stops renewing, so another
 * instance can take over once the lease expires. This uses a row-level lease rather than a
 * Postgres advisory lock because the connection pool makes session-scoped locks unreliable.
 */

/** Stable-enough identity for this process, capped to the column width (64 chars). */
export function createInstanceId(): string {
  const suffix = randomUUID().slice(0, 8);
  return `${hostname()}:${process.pid}:${suffix}`.slice(0, 64);
}

/**
 * Try to acquire the lease once. Returns true when this instance now holds it.
 *
 * The conditional update is atomic: if two instances race for an expired lease, Postgres
 * re-evaluates the predicate after the winner commits, so only one update matches.
 */
export async function tryClaimLease(
  chainId: number,
  instanceId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + leaseSeconds * 1_000);

  const result = await prisma.indexerState.updateMany({
    where: {
      chainId,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }, { lockedBy: instanceId }],
    },
    data: { lockedBy: instanceId, lockedUntil },
  });

  return result.count === 1;
}

/** Claim the lease, waiting until it becomes available. */
export async function claimLease(
  chainId: number,
  instanceId: string,
  leaseSeconds: number,
  pollIntervalMs = 5_000,
): Promise<void> {
  for (;;) {
    if (await tryClaimLease(chainId, instanceId, leaseSeconds)) return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Extend the lease. Returns false when another instance has taken over, in which case the caller
 * must stop indexing to avoid two writers advancing the same cursor.
 */
export async function renewLease(
  chainId: number,
  instanceId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const lockedUntil = new Date(Date.now() + leaseSeconds * 1_000);
  const result = await prisma.indexerState.updateMany({
    where: { chainId, lockedBy: instanceId },
    data: { lockedUntil },
  });
  return result.count === 1;
}

/** Release the lease so a replacement instance can start immediately. */
export async function releaseLease(chainId: number, instanceId: string): Promise<void> {
  await prisma.indexerState.updateMany({
    where: { chainId, lockedBy: instanceId },
    data: { lockedBy: null, lockedUntil: null },
  });
}
