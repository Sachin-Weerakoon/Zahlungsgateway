import { createPublicClient, fallback, http, getAddress, type PublicClient } from 'viem';
import { prisma } from '@cryptopay/db';
import {
  ApiError,
  ApiErrorCode,
  AuditAction,
  MerchantStatus,
  decodeCursor,
  encodeCursor,
} from '@cryptopay/shared';
import { paymentProcessorAbi } from '@cryptopay/shared/abi';
import { getServerEnv } from './env';
import { recordAudit } from './audit';
import type { AuthContext } from './auth';

let cachedClient: PublicClient | null = null;

function chainClient(): PublicClient {
  if (cachedClient) return cachedClient;
  const env = getServerEnv();
  const transport = env.RPC_URL_FALLBACK
    ? fallback([http(env.RPC_URL_PRIMARY), http(env.RPC_URL_FALLBACK)], { rank: false })
    : http(env.RPC_URL_PRIMARY);
  cachedClient = createPublicClient({ transport }) as PublicClient;
  return cachedClient;
}

export interface MerchantListQuery {
  search?: string;
  cursor?: string;
  limit: number;
}

export async function listMerchants(query: MerchantListQuery) {
  const where: Record<string, unknown> = {};
  if (query.search) {
    where.OR = [
      { walletAddress: { contains: query.search.toLowerCase() } },
      { name: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.AND = [
      {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const rows = await prisma.merchant.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    include: { _count: { select: { invoices: true } } },
  });

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  return {
    data: page.map((merchant) => ({
      id: merchant.id,
      walletAddress: merchant.walletAddress,
      name: merchant.name,
      supportEmail: merchant.supportEmail,
      payoutAddress: merchant.payoutAddress,
      status: merchant.status,
      invoiceCount: merchant._count.invoices,
      createdAt: merchant.createdAt.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

export async function setMerchantStatus(
  admin: AuthContext,
  merchantId: string,
  status: MerchantStatus,
  ip: string,
) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new ApiError(ApiErrorCode.NotFound, 'Merchant not found');

  const updated = await prisma.merchant.update({ where: { id: merchantId }, data: { status } });

  await recordAudit({
    actor: admin.walletAddress,
    action:
      status === MerchantStatus.SUSPENDED
        ? AuditAction.MerchantSuspended
        : AuditAction.MerchantReactivated,
    merchantId,
    target: merchant.walletAddress,
    ip,
    metadata: { previousStatus: merchant.status },
  });

  return { id: updated.id, status: updated.status };
}

export async function listAuditLog(query: {
  merchantId?: string;
  action?: string;
  cursor?: string;
  limit: number;
}) {
  const where: Record<string, unknown> = {};
  if (query.merchantId) where.merchantId = query.merchantId;
  if (query.action) where.action = query.action;
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  return {
    data: page.map((entry) => ({
      id: entry.id,
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      merchantId: entry.merchantId,
      ip: entry.ip,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

/** Mirror the on-chain allowlist into the database so merchants can only pick enabled tokens. */
export async function upsertToken(
  admin: AuthContext,
  input: { address: string; symbol: string; decimals: number; allowed: boolean },
  ip: string,
) {
  let address: string;
  try {
    address = getAddress(input.address).toLowerCase();
  } catch {
    throw new ApiError(ApiErrorCode.ValidationFailed, 'Token address is invalid');
  }

  const token = await prisma.token.upsert({
    where: { address },
    create: {
      address,
      symbol: input.symbol,
      decimals: input.decimals,
      allowed: input.allowed,
    },
    update: { symbol: input.symbol, decimals: input.decimals, allowed: input.allowed },
  });

  await recordAudit({
    actor: admin.walletAddress,
    action: input.allowed ? AuditAction.TokenAllowed : AuditAction.TokenDisallowed,
    target: address,
    ip,
    metadata: { symbol: input.symbol, decimals: input.decimals },
  });

  return token;
}

/** Read the live contract configuration; the chain remains the source of truth (FR-ADM-2/3). */
export async function chainStatus() {
  const env = getServerEnv();
  const address = env.PAYMENT_PROCESSOR_ADDRESS as `0x${string}`;

  if (address === '0x0000000000000000000000000000000000000000') {
    return { reachable: false, reason: 'PAYMENT_PROCESSOR_ADDRESS is not configured' };
  }

  try {
    const client = chainClient();
    const [feeBps, maxFeeBps, treasury, paused, tokenAllowed, blockNumber] = await Promise.all([
      client.readContract({ address, abi: paymentProcessorAbi, functionName: 'feeBps' }),
      client.readContract({ address, abi: paymentProcessorAbi, functionName: 'MAX_FEE_BPS' }),
      client.readContract({ address, abi: paymentProcessorAbi, functionName: 'treasury' }),
      client.readContract({ address, abi: paymentProcessorAbi, functionName: 'paused' }),
      client.readContract({
        address,
        abi: paymentProcessorAbi,
        functionName: 'tokenAllowed',
        args: [env.TEST_USDC_ADDRESS as `0x${string}`],
      }),
      client.getBlockNumber(),
    ]);

    return {
      reachable: true,
      chainId: env.CHAIN_ID,
      blockNumber: Number(blockNumber),
      feeBps: Number(feeBps),
      maxFeeBps: Number(maxFeeBps),
      treasury,
      paused,
      testUsdcAllowlisted: tokenAllowed,
    };
  } catch (error) {
    return {
      reachable: false,
      reason: error instanceof Error ? error.message : 'RPC unavailable',
    };
  }
}

/** Operational health used by the admin health page and uptime checks (FR-ADM-5). */
export async function platformHealth() {
  const startedAt = Date.now();
  let databaseOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseOk = false;
  }

  const [indexers, pendingDeliveries, failedDeliveries, confirmingInvoices] = await Promise.all([
    prisma.indexerState.findMany(),
    prisma.webhookDelivery.count({ where: { status: 'PENDING' } }),
    prisma.webhookDelivery.count({
      where: {
        status: 'FAILED',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.invoice.count({ where: { status: 'CONFIRMING' } }),
  ]);

  return {
    database: { ok: databaseOk, latencyMs: Date.now() - startedAt },
    indexers: indexers.map((state) => ({
      chainId: state.chainId,
      lastProcessedBlock: state.lastProcessedBlock.toString(),
      updatedAt: state.updatedAt.toISOString(),
    })),
    webhooks: { pending: pendingDeliveries, failedLast24h: failedDeliveries },
    invoices: { confirming: confirmingInvoices },
    timestamp: new Date().toISOString(),
  };
}
