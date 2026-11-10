/** Shared, chain-agnostic constants for CryptoPay Gateway. */

/** Basis points denominator (100 bps = 1%). */
export const BPS_DENOMINATOR = 10_000n;

/** Contract hard cap on the platform fee (5%). */
export const MAX_FEE_BPS = 500;

/** Default platform fee used by the test environment (1%). */
export const DEFAULT_FEE_BPS = 100;

/** Default number of confirmations before a payment is final. */
export const DEFAULT_CONFIRMATIONS = 5;

/** Invoice expiry bounds in minutes (5 minutes to 7 days). */
export const MIN_EXPIRY_MINUTES = 5;
export const MAX_EXPIRY_MINUTES = 7 * 24 * 60;
export const DEFAULT_EXPIRY_MINUTES = 30;

/** Maximum accepted invoice metadata payload (JSON serialised). */
export const MAX_METADATA_BYTES = 1024;

/** Maximum description length (characters). */
export const MAX_DESCRIPTION_LENGTH = 500;

/** Maximum merchant reference length (characters). */
export const MAX_MERCHANT_REFERENCE_LENGTH = 255;

/** Pagination defaults (SRS 6.4). */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Rate limits (requests per minute). */
export const API_KEY_RATE_LIMIT_PER_MINUTE = 100;
export const PUBLIC_IP_RATE_LIMIT_PER_MINUTE = 30;

/** Session lifetime in seconds (8 hours). */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** SIWE nonce lifetime in seconds (5 minutes). */
export const NONCE_TTL_SECONDS = 5 * 60;

/** Idempotency key retention in seconds (24 hours). */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Webhook delivery retry schedule in seconds (SRS FR-WH-3). */
export const WEBHOOK_RETRY_DELAYS_SECONDS = [60, 300, 1_800, 7_200, 43_200] as const;

/** Webhook delivery timeout in milliseconds (SRS FR-WH-3). */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Webhook timestamp tolerance in seconds (acceptance AC-8). */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

/** Webhook delivery log retention in days (SRS 8.3). */
export const WEBHOOK_LOG_RETENTION_DAYS = 30;

/** Admin audit log minimum retention in days (SRS 8.3). */
export const AUDIT_LOG_RETENTION_DAYS = 365;

/** Supported chain ids. */
export const CHAIN_IDS = {
  baseSepolia: 84532,
  ethereumSepolia: 11155111,
} as const;

export type SupportedChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export const CHAIN_NAMES: Record<SupportedChainId, string> = {
  [CHAIN_IDS.baseSepolia]: 'Base Sepolia',
  [CHAIN_IDS.ethereumSepolia]: 'Ethereum Sepolia',
};

/** Explorer base URLs per chain id. */
export const EXPLORER_URLS: Record<SupportedChainId, string> = {
  [CHAIN_IDS.baseSepolia]: 'https://sepolia.basescan.org',
  [CHAIN_IDS.ethereumSepolia]: 'https://sepolia.etherscan.io',
};

/** Canonical header names used by the REST API and webhooks. */
export const HEADERS = {
  apiKey: 'authorization',
  idempotencyKey: 'idempotency-key',
  requestId: 'x-request-id',
  eventId: 'x-event-id',
  timestamp: 'x-timestamp',
  signature: 'x-signature',
  retryAfter: 'retry-after',
} as const;
