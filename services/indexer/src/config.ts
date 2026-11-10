import 'dotenv/config';
import { z } from 'zod';

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  CHAIN_ID: z.coerce.number().int().positive(),
  RPC_URL_PRIMARY: z.string().url(),
  RPC_URL_FALLBACK: z.string().url().optional(),
  PAYMENT_PROCESSOR_ADDRESS: hexAddress,
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(3_000),
  INDEXER_BLOCK_RANGE: z.coerce.number().int().min(1).max(10_000).default(1_000),
  INDEXER_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(5),
  INDEXER_START_BLOCK: z.coerce.number().int().min(0).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
});

export type IndexerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid indexer configuration: ${issues}`);
  }
  return parsed.data;
}
