import {
  createPublicClient,
  fallback,
  http,
  parseAbiItem,
  type PublicClient,
} from 'viem';
import type { IndexerConfig } from './config.js';

/**
 * Contract events the indexer consumes. Kept as local ABI fragments so the service does not
 * depend on generated artifacts at runtime; `packages/shared/src/abi.ts` remains the API copy.
 */
export const paymentReceivedEvent = parseAbiItem(
  'event PaymentReceived(bytes32 indexed invoiceRef, address indexed merchant, address indexed payer, address token, uint256 grossAmount, uint256 fee)',
);

export const paymentRefundedEvent = parseAbiItem(
  'event PaymentRefunded(bytes32 indexed invoiceRef, address indexed merchant, address payer, uint256 amount)',
);

export function createChainClient(config: IndexerConfig): PublicClient {
  const transport = config.RPC_URL_FALLBACK
    ? fallback(
        [
          http(config.RPC_URL_PRIMARY, { retryCount: 2, timeout: 15_000 }),
          http(config.RPC_URL_FALLBACK, { retryCount: 2, timeout: 15_000 }),
        ],
        { rank: false },
      )
    : http(config.RPC_URL_PRIMARY, { retryCount: 3, timeout: 15_000 });

  return createPublicClient({ transport }) as PublicClient;
}

/** Minimal structured logger contract used by the processor, keeps it testable. */
export interface ProcessorLogger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}
