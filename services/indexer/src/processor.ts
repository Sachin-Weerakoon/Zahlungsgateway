import { prisma } from '@cryptopay/db';
import { enqueueWebhookEvent } from '@cryptopay/db/webhooks';
import {
  InvoiceStatus,
  WebhookEventType,
  statusForPaidAmount,
  type WebhookEventData,
} from '@cryptopay/shared';
import type { ProcessorLogger } from './chain.js';

export interface PaymentLog {
  invoiceRef: string;
  merchant: string;
  payer: string;
  token: string;
  gross: bigint;
  fee: bigint;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
}

export interface RefundLog {
  invoiceRef: string;
  amount: bigint;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
}

export interface ProcessorContext {
  chainId: number;
  logger: ProcessorLogger;
}

const LATE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.EXPIRED,
  InvoiceStatus.CANCELLED,
  InvoiceStatus.REFUNDED,
];

const SETTLED_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.PAID,
  InvoiceStatus.UNDERPAID,
  InvoiceStatus.OVERPAID,
];

function webhookData(
  invoice: { merchantReference: string | null; tokenAddress: string; amount: { toString(): string } },
  status: InvoiceStatus,
  chainId: number,
  payment?: {
    txHash: string;
    blockNumber: bigint;
    fee: { toString(): string };
    net: { toString(): string };
    confirmations: number;
  } | null,
): WebhookEventData {
  return {
    invoiceId: '',
    merchantReference: invoice.merchantReference,
    status,
    token: invoice.tokenAddress,
    amount: invoice.amount.toString(),
    fee: payment?.fee.toString() ?? '0',
    net: payment?.net.toString() ?? '0',
    txHash: payment?.txHash ?? null,
    blockNumber: payment ? Number(payment.blockNumber) : null,
    confirmations: payment?.confirmations ?? 0,
    chainId,
  };
}

function settlementEventType(status: InvoiceStatus): WebhookEventType {
  if (status === InvoiceStatus.PAID) return WebhookEventType.InvoicePaid;
  if (status === InvoiceStatus.UNDERPAID) return WebhookEventType.InvoiceUnderpaid;
  return WebhookEventType.InvoiceOverpaid;
}

/** Thrown inside a transaction when the invoice changed concurrently; the caller retries. */
class StaleInvoiceError extends Error {
  constructor() {
    super('invoice status changed concurrently');
    this.name = 'StaleInvoiceError';
  }
}

const MAX_STALE_RETRIES = 3;

async function withStaleRetry(run: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await run();
      return;
    } catch (error) {
      if (!(error instanceof StaleInvoiceError) || attempt >= MAX_STALE_RETRIES) throw error;
    }
  }
}

/**
 * Apply a PaymentReceived log. Idempotent on (txHash, logIndex).
 *
 * The log is only accepted when it pays the invoice's bound merchant payout address in the
 * invoice token. The contract derives the reference from (merchant, token, amount, salt), so this
 * check is defence in depth for legacy invoices and misconfiguration.
 *
 * The invoice status is re-read and updated conditionally inside the transaction so a concurrent
 * expiry or cancellation can never be overwritten (and a payment racing them is flagged late).
 */
export async function processPaymentLog(log: PaymentLog, context: ProcessorContext): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { invoiceRef: log.invoiceRef },
    include: { merchant: { select: { payoutAddress: true } } },
  });
  if (!invoice) {
    context.logger.warn(
      { invoiceRef: log.invoiceRef, txHash: log.txHash },
      'payment for unknown invoice reference ignored',
    );
    return;
  }

  if (invoice.tokenAddress.toLowerCase() !== log.token.toLowerCase()) {
    context.logger.warn(
      {
        invoiceId: invoice.id,
        expectedToken: invoice.tokenAddress,
        paidToken: log.token,
        txHash: log.txHash,
      },
      'payment token does not match the invoice token; manual review required',
    );
    return;
  }

  const expectedPayout = (invoice.payoutAddress ?? invoice.merchant.payoutAddress)?.toLowerCase();
  if (!expectedPayout || expectedPayout !== log.merchant.toLowerCase()) {
    // Funds went to an address the merchant does not control (e.g. a payer paying themselves).
    // Never count this as payment for the invoice.
    context.logger.warn(
      {
        invoiceId: invoice.id,
        expectedPayout: expectedPayout ?? null,
        paidTo: log.merchant,
        txHash: log.txHash,
      },
      'payment recipient does not match the merchant payout address; ignored',
    );
    return;
  }

  await withStaleRetry(() =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { txHash_logIndex: { txHash: log.txHash, logIndex: log.logIndex } },
      });
      if (existing) return;

      const current = await tx.invoice.findUnique({
        where: { id: invoice.id },
        select: { status: true },
      });
      if (!current) return;
      const status = current.status as InvoiceStatus;

      const isLate = LATE_STATUSES.includes(status);
      const net = log.gross - log.fee;

      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          txHash: log.txHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          payer: log.payer.toLowerCase(),
          tokenAddress: log.token.toLowerCase(),
          gross: log.gross.toString(),
          fee: log.fee.toString(),
          net: net.toString(),
          isLate,
        },
      });

      if (isLate) {
        // EXPIRED/CANCELLED/REFUNDED are final: record the late payment and notify, never reopen.
        await enqueueWebhookEvent(tx, {
          invoiceId: invoice.id,
          merchantId: invoice.merchantId,
          type: WebhookEventType.PaymentLate,
          data: {
            ...webhookData(invoice, status, context.chainId, payment),
            invoiceId: invoice.id,
          },
        });
        return;
      }

      if (status === InvoiceStatus.CREATED || status === InvoiceStatus.PENDING) {
        const updated = await tx.invoice.updateMany({
          where: { id: invoice.id, status },
          data: { status: InvoiceStatus.CONFIRMING },
        });
        // Lost a race with expiry/cancellation: roll back and re-evaluate from the new status.
        if (updated.count === 0) throw new StaleInvoiceError();

        await tx.invoiceStatusHistory.create({
          data: {
            invoiceId: invoice.id,
            fromStatus: status,
            toStatus: InvoiceStatus.CONFIRMING,
            reason: 'payment observed on chain',
            txHash: log.txHash,
          },
        });
        await enqueueWebhookEvent(tx, {
          invoiceId: invoice.id,
          merchantId: invoice.merchantId,
          type: WebhookEventType.InvoiceConfirming,
          data: {
            ...webhookData(invoice, InvoiceStatus.CONFIRMING, context.chainId, payment),
            invoiceId: invoice.id,
          },
        });
      }
    }),
  );

  context.logger.info(
    { invoiceId: invoice.id, txHash: log.txHash, blockNumber: Number(log.blockNumber) },
    'payment recorded',
  );
}

/**
 * Update confirmation counts and settle invoices whose payment reached the required depth.
 * Also handles a second payment to an already-settled invoice (cannot happen for the same
 * invoice reference on chain, but remains safe if it does).
 */
export async function settleConfirmedInvoices(
  head: bigint,
  requiredConfirmations: number,
  context: ProcessorContext,
): Promise<void> {
  const invoices = await prisma.invoice.findMany({
    where: { status: InvoiceStatus.CONFIRMING },
    include: { payments: { orderBy: { blockNumber: 'desc' } } },
    // Oldest first so a backlog larger than one batch is always drained in order.
    orderBy: { updatedAt: 'asc' },
    take: 200,
  });

  for (const invoice of invoices) {
    const payment = invoice.payments[0];
    if (!payment) continue;

    const confirmations = Number(head - payment.blockNumber + 1n);
    const bounded = Math.max(0, confirmations);
    if (bounded !== payment.confirmations) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { confirmations: bounded },
      });
    }
    if (bounded < requiredConfirmations) continue;

    const paid = invoice.payments.reduce((sum, row) => sum + BigInt(row.gross.toString()), 0n);
    const status = statusForPaidAmount(paid, BigInt(invoice.amount.toString()));

    await prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.updateMany({
        where: { id: invoice.id, status: InvoiceStatus.CONFIRMING },
        data: { status, paidAt: new Date() },
      });
      if (updated.count === 0) return;

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId: invoice.id,
          fromStatus: InvoiceStatus.CONFIRMING,
          toStatus: status,
          reason: `settled after ${bounded} confirmations`,
          txHash: payment.txHash,
        },
      });
      await enqueueWebhookEvent(tx, {
        invoiceId: invoice.id,
        merchantId: invoice.merchantId,
        type: settlementEventType(status),
        data: {
          ...webhookData(invoice, status, context.chainId, { ...payment, confirmations: bounded }),
          invoiceId: invoice.id,
        },
      });
    });

    context.logger.info(
      { invoiceId: invoice.id, status, confirmations: bounded },
      'invoice settled',
    );
  }
}

/**
 * Apply a PaymentRefunded log. The event carries no payment identifier, so the refund is
 * attributed to the invoice's most recent payment (one payment per invoice reference on chain).
 */
export async function processRefundLog(log: RefundLog, context: ProcessorContext): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { invoiceRef: log.invoiceRef } });
  if (!invoice) {
    context.logger.warn({ invoiceRef: log.invoiceRef }, 'refund for unknown invoice ignored');
    return;
  }

  const payment = await prisma.payment.findFirst({
    where: { invoiceId: invoice.id },
    orderBy: { blockNumber: 'desc' },
  });
  if (!payment) {
    context.logger.warn({ invoiceId: invoice.id }, 'refund without a recorded payment ignored');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.refund.findUnique({
      where: { txHash_logIndex: { txHash: log.txHash, logIndex: log.logIndex } },
    });
    if (existing) return;

    await tx.refund.create({
      data: {
        paymentId: payment.id,
        txHash: log.txHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        amount: log.amount.toString(),
      },
    });

    const aggregate = await tx.refund.aggregate({
      where: { paymentId: payment.id },
      _sum: { amount: true },
    });
    const refundedTotal = BigInt(aggregate._sum.amount?.toString() ?? '0');
    const net = BigInt(payment.net.toString());

    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: { refundedTotal: refundedTotal.toString() },
    });

    if (refundedTotal >= net && SETTLED_STATUSES.includes(invoice.status)) {
      const updated = await tx.invoice.updateMany({
        where: { id: invoice.id, status: { in: [...SETTLED_STATUSES] } },
        data: { status: InvoiceStatus.REFUNDED },
      });
      if (updated.count > 0) {
        await tx.invoiceStatusHistory.create({
          data: {
            invoiceId: invoice.id,
            fromStatus: invoice.status,
            toStatus: InvoiceStatus.REFUNDED,
            reason: 'payment fully refunded',
            txHash: log.txHash,
          },
        });
        await enqueueWebhookEvent(tx, {
          invoiceId: invoice.id,
          merchantId: invoice.merchantId,
          type: WebhookEventType.InvoiceRefunded,
          data: {
            ...webhookData(invoice, InvoiceStatus.REFUNDED, context.chainId, updatedPayment),
            invoiceId: invoice.id,
          },
        });
      }
    }
  });

  context.logger.info({ invoiceId: invoice.id, txHash: log.txHash }, 'refund recorded');
}

/**
 * Roll back payments and refunds above `rewindTo` after a reorg and recompute the affected
 * invoices (FR-IDX-3). Emits payment.reorged for every invoice whose status changed.
 */
export async function rewindForReorg(
  rewindTo: bigint,
  context: ProcessorContext,
): Promise<number> {
  const [affectedPayments, affectedRefunds] = await Promise.all([
    prisma.payment.findMany({
      where: { blockNumber: { gt: rewindTo } },
      select: { id: true, invoiceId: true },
    }),
    prisma.refund.findMany({
      where: { blockNumber: { gt: rewindTo } },
      select: { id: true, payment: { select: { id: true, invoiceId: true } } },
    }),
  ]);
  if (affectedPayments.length === 0 && affectedRefunds.length === 0) return 0;

  const removedPaymentIds = affectedPayments.map((payment) => payment.id);
  const invoiceIds = [
    ...new Set([
      ...affectedPayments.map((payment) => payment.invoiceId),
      ...affectedRefunds.map((refund) => refund.payment.invoiceId),
    ]),
  ];
  // Payments that survive the rewind but lost refunds need their refunded total recomputed.
  const survivingPaymentIds = [
    ...new Set(
      affectedRefunds
        .map((refund) => refund.payment.id)
        .filter((id) => !removedPaymentIds.includes(id)),
    ),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.refund.deleteMany({
      where: {
        OR: [{ paymentId: { in: removedPaymentIds } }, { blockNumber: { gt: rewindTo } }],
      },
    });
    await tx.payment.deleteMany({ where: { id: { in: removedPaymentIds } } });

    for (const paymentId of survivingPaymentIds) {
      const aggregate = await tx.refund.aggregate({
        where: { paymentId },
        _sum: { amount: true },
      });
      await tx.payment.update({
        where: { id: paymentId },
        data: { refundedTotal: aggregate._sum.amount?.toString() ?? '0' },
      });
    }

    for (const invoiceId of invoiceIds) {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: { where: { isLate: false } } },
      });
      if (!invoice) continue;
      const fromStatus = invoice.status as InvoiceStatus;

      let nextStatus: InvoiceStatus | null = null;
      const remaining = invoice.payments;

      if (fromStatus === InvoiceStatus.REFUNDED) {
        // A refund was reorged away: the invoice is settled again unless fully refunded.
        if (remaining.length === 0) {
          nextStatus = InvoiceStatus.CREATED;
        } else {
          const refunded = remaining.reduce(
            (sum, row) => sum + BigInt(row.refundedTotal.toString()),
            0n,
          );
          const net = remaining.reduce((sum, row) => sum + BigInt(row.net.toString()), 0n);
          if (refunded < net) {
            const paid = remaining.reduce((sum, row) => sum + BigInt(row.gross.toString()), 0n);
            nextStatus = statusForPaidAmount(paid, BigInt(invoice.amount.toString()));
          }
        }
      } else if (
        SETTLED_STATUSES.includes(fromStatus) ||
        fromStatus === InvoiceStatus.CONFIRMING
      ) {
        if (remaining.length === 0) {
          const reported = await tx.reportedTransaction.count({ where: { invoiceId } });
          nextStatus = reported > 0 ? InvoiceStatus.PENDING : InvoiceStatus.CREATED;
        } else if (fromStatus !== InvoiceStatus.CONFIRMING) {
          nextStatus = InvoiceStatus.CONFIRMING;
        }
      }

      if (nextStatus === null || nextStatus === fromStatus) continue;

      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, status: fromStatus },
        data: {
          status: nextStatus,
          ...(nextStatus === InvoiceStatus.CREATED || nextStatus === InvoiceStatus.PENDING
            ? { paidAt: null }
            : {}),
        },
      });
      if (updated.count === 0) continue;

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus,
          toStatus: nextStatus,
          reason: 'chain reorganisation rolled back payment or refund',
        },
      });
      await enqueueWebhookEvent(tx, {
        invoiceId,
        merchantId: invoice.merchantId,
        type: WebhookEventType.PaymentReorged,
        data: {
          ...webhookData(invoice, nextStatus, context.chainId),
          invoiceId,
        },
      });
    }
  });

  context.logger.warn(
    {
      rewindTo: Number(rewindTo),
      payments: removedPaymentIds.length,
      refunds: affectedRefunds.length,
      invoices: invoiceIds.length,
    },
    'reorg rolled back payments and refunds',
  );
  return affectedPayments.length + affectedRefunds.length;
}
