import { prisma } from '@cryptopay/db';
import {
  ApiError,
  ApiErrorCode,
  INVOICE_STATUSES,
  decodeCursor,
  encodeCursor,
  type CursorPage,
  type InvoiceStatus,
  type SettlementReport,
} from '@cryptopay/shared';

interface PaymentListQuery {
  cursor?: string;
  limit: number;
}

export interface PaymentListRow {
  id: string;
  invoiceId: string;
  invoiceRef: string;
  merchantReference: string | null;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  payer: string;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  gross: string;
  fee: string;
  net: string;
  refundedTotal: string;
  confirmations: number;
  isLate: boolean;
  createdAt: string;
}

export async function listPayments(
  context: { merchantId: string },
  query: PaymentListQuery,
): Promise<CursorPage<PaymentListRow>> {
  const where: Record<string, unknown> = { invoice: { merchantId: context.merchantId } };
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  const rows = await prisma.payment.findMany({
    where,
    include: { invoice: { select: { invoiceRef: true, merchantReference: true, tokenAddress: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });

  const tokens = await prisma.token.findMany();
  const tokenMap = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  return {
    data: page.map((payment) => {
      const token = tokenMap.get(payment.tokenAddress.toLowerCase());
      return {
        id: payment.id,
        invoiceId: payment.invoiceId,
        invoiceRef: payment.invoice.invoiceRef,
        merchantReference: payment.invoice.merchantReference,
        txHash: payment.txHash,
        logIndex: payment.logIndex,
        blockNumber: Number(payment.blockNumber),
        payer: payment.payer,
        tokenAddress: payment.tokenAddress,
        symbol: token?.symbol ?? 'UNKNOWN',
        decimals: token?.decimals ?? 18,
        gross: payment.gross.toString(),
        fee: payment.fee.toString(),
        net: payment.net.toString(),
        refundedTotal: payment.refundedTotal.toString(),
        confirmations: payment.confirmations,
        isLate: payment.isLate,
        createdAt: payment.createdAt.toISOString(),
      };
    }),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

export async function dashboardMetrics(context: { merchantId: string }) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [invoiceGroups, paymentGroups] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['status'],
      where: { merchantId: context.merchantId },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ['tokenAddress'],
      where: {
        invoice: { merchantId: context.merchantId },
        createdAt: { gte: monthStart, lt: now },
      },
      _sum: { gross: true, fee: true, net: true },
      _count: { _all: true },
    }),
  ]);

  const invoiceCounts = Object.fromEntries(
    INVOICE_STATUSES.map((status) => [status, 0]),
  ) as Record<InvoiceStatus, number>;
  for (const group of invoiceGroups) invoiceCounts[group.status] = group._count._all;

  const tokens = await prisma.token.findMany({
    where: { address: { in: paymentGroups.map((group) => group.tokenAddress) } },
  });
  const tokenMap = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));

  return {
    totalInvoices: Object.values(invoiceCounts).reduce((total, count) => total + count, 0),
    invoiceCounts,
    currentMonth: {
      from: monthStart.toISOString(),
      to: now.toISOString(),
      paymentCount: paymentGroups.reduce((total, group) => total + group._count._all, 0),
      volume: paymentGroups.map((group) => {
        const token = tokenMap.get(group.tokenAddress.toLowerCase());
        return {
          tokenAddress: group.tokenAddress,
          symbol: token?.symbol ?? 'UNKNOWN',
          decimals: token?.decimals ?? 18,
          paymentCount: group._count._all,
          gross: group._sum.gross?.toString() ?? '0',
          fee: group._sum.fee?.toString() ?? '0',
          net: group._sum.net?.toString() ?? '0',
        };
      }),
    },
  };
}

/** Settlement totals per token for a date range (FR-SET-2). */
export async function settlementReport(
  context: { merchantId: string },
  from: Date,
  to: Date,
): Promise<SettlementReport> {
  if (from.getTime() > to.getTime()) {
    throw new ApiError(ApiErrorCode.ValidationFailed, 'from must be before or equal to to');
  }

  const paymentRows = await prisma.payment.groupBy({
    by: ['tokenAddress'],
    where: {
      invoice: { merchantId: context.merchantId },
      createdAt: { gte: from, lte: to },
    },
    _sum: { gross: true, fee: true, net: true },
    _count: { _all: true },
  });

  const refundRows = await prisma.$queryRaw<Array<{ tokenAddress: string; refunds: string }>>`
    SELECT p."tokenAddress" AS "tokenAddress", COALESCE(SUM(r."amount"), 0)::text AS refunds
    FROM "Refund" r
    JOIN "Payment" p ON p."id" = r."paymentId"
    JOIN "Invoice" i ON i."id" = p."invoiceId"
    WHERE i."merchantId" = ${context.merchantId}::uuid
      AND r."createdAt" >= ${from}
      AND r."createdAt" <= ${to}
    GROUP BY p."tokenAddress"
  `;

  const refundMap = new Map(refundRows.map((row) => [row.tokenAddress.toLowerCase(), BigInt(row.refunds)]));
  const tokens = await prisma.token.findMany();
  const tokenMap = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows: paymentRows.map((row) => {
      const token = tokenMap.get(row.tokenAddress.toLowerCase());
      return {
        tokenAddress: row.tokenAddress,
        symbol: token?.symbol ?? 'UNKNOWN',
        decimals: token?.decimals ?? 18,
        paymentCount: row._count._all,
        gross: (row._sum.gross ?? 0).toString(),
        fee: (row._sum.fee ?? 0).toString(),
        net: (row._sum.net ?? 0).toString(),
        refunds: (refundMap.get(row.tokenAddress.toLowerCase()) ?? 0n).toString(),
      };
    }),
  };
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens it correctly (FR-SET-3). */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  const escape = (value: string | number | null): string => {
    if (value === null) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const CSV_LIMIT = 10_000;

export async function exportInvoicesCsv(
  context: { merchantId: string },
  from: Date | null,
  to: Date | null,
): Promise<string> {
  const invoices = await prisma.invoice.findMany({
    where: {
      merchantId: context.merchantId,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: CSV_LIMIT,
  });

  return toCsv(
    [
      'id',
      'invoiceRef',
      'status',
      'amount',
      'tokenAddress',
      'merchantReference',
      'description',
      'createdAt',
      'expiresAt',
      'paidAt',
    ],
    invoices.map((invoice) => [
      invoice.id,
      invoice.invoiceRef,
      invoice.status as InvoiceStatus,
      invoice.amount.toString(),
      invoice.tokenAddress,
      invoice.merchantReference,
      invoice.description,
      invoice.createdAt.toISOString(),
      invoice.expiresAt.toISOString(),
      invoice.paidAt?.toISOString() ?? null,
    ]),
  );
}

export async function exportPaymentsCsv(
  context: { merchantId: string },
  from: Date | null,
  to: Date | null,
): Promise<string> {
  const payments = await prisma.payment.findMany({
    where: {
      invoice: { merchantId: context.merchantId },
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    include: { invoice: { select: { invoiceRef: true, merchantReference: true } } },
    orderBy: { createdAt: 'desc' },
    take: CSV_LIMIT,
  });

  return toCsv(
    [
      'txHash',
      'logIndex',
      'invoiceRef',
      'merchantReference',
      'tokenAddress',
      'payer',
      'gross',
      'fee',
      'net',
      'refundedTotal',
      'blockNumber',
      'confirmations',
      'isLate',
      'createdAt',
    ],
    payments.map((payment) => [
      payment.txHash,
      payment.logIndex,
      payment.invoice.invoiceRef,
      payment.invoice.merchantReference,
      payment.tokenAddress,
      payment.payer,
      payment.gross.toString(),
      payment.fee.toString(),
      payment.net.toString(),
      payment.refundedTotal.toString(),
      Number(payment.blockNumber),
      payment.confirmations,
      payment.isLate ? 'true' : 'false',
      payment.createdAt.toISOString(),
    ]),
  );
}
