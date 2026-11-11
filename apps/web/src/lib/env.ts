import { z } from 'zod';

/**
 * Server-side configuration. Parsed lazily so `next build` does not require runtime
 * secrets, and so a misconfigured deployment fails on the first request with a clear message.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  DATABASE_URL: z.string().min(1),
  WEBHOOK_ENCRYPTION_KEY: z.string().min(32, 'WEBHOOK_ENCRYPTION_KEY must be at least 32 characters'),
  RPC_URL_PRIMARY: z.string().url().default('https://sepolia.base.org'),
  RPC_URL_FALLBACK: z.string().url().optional(),
  CHAIN_ID: z.coerce.number().int().positive().default(84532),
  PAYMENT_PROCESSOR_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default('0x0000000000000000000000000000000000000000'),
  TEST_USDC_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default('0x0000000000000000000000000000000000000000'),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(500).default(100),
  ADMIN_WALLETS: z.string().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid web configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function adminWallets(env: ServerEnv = getServerEnv()): Set<string> {
  return new Set(
    env.ADMIN_WALLETS.split(',')
      .map((address) => address.trim().toLowerCase())
      .filter((address) => /^0x[0-9a-f]{40}$/.test(address)),
  );
}

/** Public configuration safe to expose to the browser. */
export const publicConfig = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532),
  paymentProcessorAddress:
    process.env.NEXT_PUBLIC_PAYMENT_PROCESSOR_ADDRESS ??
    '0x0000000000000000000000000000000000000000',
  testUsdcAddress:
    process.env.NEXT_PUBLIC_TEST_USDC_ADDRESS ?? '0x0000000000000000000000000000000000000000',
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? 'https://sepolia.base.org',
} as const;
