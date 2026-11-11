import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  CHAIN_ID: z.coerce.number().int().positive().default(84532),
  WEBHOOK_ENCRYPTION_KEY: z.string().min(32, 'Must be at least 32 characters'),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(6),
  WEBHOOK_LEASE_SECONDS: z.coerce.number().int().min(10).max(900).default(120),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).default(1_000),
  WORKER_EXPIRY_INTERVAL_MS: z.coerce.number().int().min(1_000).default(30_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(9465),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid worker configuration: ${issues}`);
  }
  return parsed.data;
}
