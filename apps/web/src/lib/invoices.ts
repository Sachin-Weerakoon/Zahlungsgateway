import { randomBytes } from 'node:crypto';
import { encodeAbiParameters, getAddress, keccak256, toHex, type Address, type Hex } from 'viem';
import { prisma, type Prisma } from '@cryptopay/db';
import {
  ApiError,
  ApiErrorCode,
  InvoiceStatus,
  IDEMPOTENCY_TTL_SECONDS,
  decodeCursor,
  encodeCursor,
  type CreateInvoiceInput,
  type ListInvoicesQuery,
} from '@cryptopay/shared';
import { requestFingerprint, type AuthContext } from './auth';
import { toInvoiceDetail, toInvoiceSummary } from './serializers';

export interface CreateInvoiceResult {
  invoice: ReturnType<typeof toInvoiceDetail>;
  replayed: boolean;
}

/**
 * Mirror of PaymentProcessor.invoiceRefFor: keccak256(abi.encode(merchant, token, amount, salt)).
 * Binding the reference to the terms stops a third party occupying it with different terms.
 */
export function computeInvoiceRef(
  salt: Hex,
  merchant: Address,
  token: Address,
  amount: bigint,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
      [merchant, token, amount, salt],
    ),
  );
}

function newInvoiceSalt(): Hex {
  return toHex(randomBytes(32));
}

async function requireMerchant(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new ApiError(ApiErrorCode.Unauthorized, 'Merchant not found');
  return merchant;
}

async function requireAllowedToken(address: string) {
  const token = await prisma.token.findUnique({ where: { address: address.toLowerCase() } });
  if (!token || !token.allowed) {
    throw new ApiError(
      ApiErrorCode.ValidationFailed,
      'Token is not allowlisted for this environment',
      422,
      [{ path: 'tokenAddress', message: 'Token is not allowlisted' }],
    );
  }
  return token;
}

/** Create an invoice, honouring Idempotency-Key for 24 hours (FR-INV-5). */
export async function createInvoice(
  context: AuthContext,
  input: CreateInvoiceInput,
  idempotencyKey: string | null,
): Promise<CreateInvoiceResult> {
  const merchant = await requireMerchant(context.merchantId);
  if (!merchant.payoutAddress) {
    throw new ApiError(
      ApiErrorCode.ValidationFailed,
      'Set a payout address before creating invoices',
      422,
      [{ path: 'payoutAddress', message: 'Merchant payout address is not configured' }],
    );
  }

  await requireAllowedToken(input.tokenAddress);
  const fingerprint = requestFingerprint(input);

  if (idempotencyKey) {
    const existing = await prisma.idempotencyRecord.findUnique({
      where: { merchantId_key: { merchantId: context.merchantId, key: idempotencyKey } },
    });
    if (existing) {
      if (existing.requestHash !== fingerprint) {
        throw new ApiError(
          ApiErrorCode.IdempotencyConflict,
          'Idempotency-Key was already used with a different request body',
        );
      }
      return {
        invoice: existing.responseBody as unknown as CreateInvoiceResult['invoice'],
        replayed: true,
      };
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.expiresInMinutes * 60_000);
  const payoutAddress = getAddress(merchant.payoutAddress);
  const salt = newInvoiceSalt();
  const invoiceRef = computeInvoiceRef(
    salt,
    payoutAddress,
    getAddress(input.tokenAddress),
    BigInt(input.amount),
  );

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          merchantId: context.merchantId,
          invoiceRef,
          salt,
          payoutAddress,
          amount: input.amount,
          tokenAddress: input.tokenAddress.toLowerCase(),
          description: input.description ?? null,
          merchantReference: input.merchantReference ?? null,
          metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
          status: InvoiceStatus.CREATED,
          expiresAt,
          idempotencyKey: idempotencyKey ?? null,
        },
      });

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId: created.id,
          fromStatus: null,
          toStatus: InvoiceStatus.CREATED,
          reason: 'invoice created',
        },
      });

      const detail = toInvoiceDetail({ ...created, payments: [], statusHistory: [] });

      if (idempotencyKey) {
        await tx.idempotencyRecord.create({
          data: {
            merchantId: context.merchantId,
            key: idempotencyKey,
            requestHash: fingerprint,
            responseBody: detail as unknown as Prisma.InputJsonValue,
            statusCode: 201,
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000),
          },
        });
      }

      return detail;
    });

    return { invoice, replayed: false };
  } catch (error) {
    // Concurrent replay of the same key: return the winner's response.
    if (idempotencyKey && isUniqueViolation(error, 'merchantId')) {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { merchantId_key: { merchantId: context.merchantId, key: idempotencyKey } },
      });
      if (existing && existing.requestHash === fingerprint) {
        return {
          invoice: existing.responseBody as unknown as CreateInvoiceResult['invoice'],
          replayed: true,
        };
      }
      throw new ApiError(
        ApiErrorCode.IdempotencyConflict,
        'Idempotency-Key was already used with a different request body',
      );
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;
  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.some((entry) => String(entry).includes(field));
  return typeof target === 'string' ? target.includes(field) : false;
}

export async function listInvoices(context: AuthContext, query: ListInvoicesQuery) {
  const where: Prisma.InvoiceWhereInput = { merchantId: context.merchantId };

  if (query.status) where.status = query.status as InvoiceStatus;
  if (query.reference) {
    where.merchantReference = { contains: query.reference, mode: 'insensitive' };
  }
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  const rows = await prisma.invoice.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  return {
    data: page.map(toInvoiceSummary),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

export async function getInvoiceDetail(context: AuthContext, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, merchantId: context.merchantId },
    include: {
      payments: { orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }] },
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
  });
  // Cross-merchant access returns 404, never 403 (AC-12).
  if (!invoice) throw new ApiError(ApiErrorCode.NotFound, 'Invoice not found');
  return toInvoiceDetail(invoice);
}

/** Cancel an invoice. Only CREATED invoices can be cancelled (FR-INV-6). */
export async function cancelInvoice(context: AuthContext, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, merchantId: context.merchantId },
  });
  if (!invoice) throw new ApiError(ApiErrorCode.NotFound, 'Invoice not found');
  if (invoice.status !== InvoiceStatus.CREATED) {
    throw new ApiError(
      ApiErrorCode.InvoiceNotPayable,
      `Invoice cannot be cancelled from status ${invoice.status}`,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date() },
      include: {
        payments: { orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }] },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    await tx.invoiceStatusHistory.create({
      data: {
        invoiceId: invoice.id,
        fromStatus: InvoiceStatus.CREATED,
        toStatus: InvoiceStatus.CANCELLED,
        reason: 'cancelled by merchant',
      },
    });
    return next;
  });

  return toInvoiceDetail(updated);
}

/** Public checkout view. Never exposes merchant secrets. */
export async function getPublicInvoice(
  invoiceId: string,
  chain: { chainId: number; contractAddress: string },
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { merchant: true },
  });
  if (!invoice) throw new ApiError(ApiErrorCode.NotFound, 'Invoice not found');

  const token = await prisma.token.findUnique({
    where: { address: invoice.tokenAddress.toLowerCase() },
  });
  if (!token) throw new ApiError(ApiErrorCode.InternalError, 'Invoice token is not configured');

  return {
    invoice,
    token,
    chain,
  };
}

/**
 * Record a customer-reported transaction hash (FR-CUS-4). Informational only: it moves a
 * CREATED invoice to PENDING but never to CONFIRMING or PAID, which requires an on-chain event.
 */
export async function reportTransaction(invoiceId: string, txHash: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new ApiError(ApiErrorCode.NotFound, 'Invoice not found');

  if (invoice.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(ApiErrorCode.InvoiceExpired, 'Invoice has expired');
  }
  if (invoice.status !== InvoiceStatus.CREATED && invoice.status !== InvoiceStatus.PENDING) {
    throw new ApiError(
      ApiErrorCode.InvoiceNotPayable,
      `Invoice is not payable from status ${invoice.status}`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.reportedTransaction.upsert({
      where: { invoiceId_txHash: { invoiceId, txHash: txHash.toLowerCase() } },
      create: { invoiceId, txHash: txHash.toLowerCase() },
      update: {},
    });

    if (invoice.status === InvoiceStatus.CREATED) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.PENDING },
      });
      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: InvoiceStatus.CREATED,
          toStatus: InvoiceStatus.PENDING,
          reason: 'transaction reported by customer',
          txHash: txHash.toLowerCase(),
        },
      });
    }
  });
}
