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

/**
 * Apply a PaymentReceived log. Idempotent on (txHash, logIndex).
 *
 * The invoice moves to CONFIRMING immediately so the checkout can react within seconds; the
 * final PAID/UNDERPAID/OVERPAID decision waits for N confirmations (FR-IDX-2, FR-INV-7).
 */
export async function processPaymentLog(log: PaymentLog, context: ProcessorContext): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { invoiceRef: log.invoiceRef } });
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

  await prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({
      where: { txHash_logIndex: { txHash: log.txHash, logIndex: log.logIndex } },
    });
    if (existing) return;

    const isLate = LATE_STATUSES.includes(invoice.status);
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
          ...webhookData(invoice, invoice.status, context.chainId, payment),
          invoiceId: invoice.id,
        },
      });
      return;
    }

    if (invoice.status === InvoiceStatus.CREATED || invoice.status === InvoiceStatus.PENDING) {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.CONFIRMING },
      });
      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId: invoice.id,
          fromStatus: invoice.status,
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
  });

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
 * Roll back payments above `rewindTo` after a reorg and recompute the affected invoices
 * (FR-IDX-3). Emits payment.reorged for every invoice that had state removed.
 */
export async function rewindForReorg(
  rewindTo: bigint,
  context: ProcessorContext,
): Promise<number> {
  const affected = await prisma.payment.findMany({
    where: { blockNumber: { gt: rewindTo } },
    include: { invoice: true },
  });
  if (affected.length === 0) return 0;

  const paymentIds = affected.map((payment) => payment.id);
  const invoiceIds = [...new Set(affected.map((payment) => payment.invoiceId))];

  await prisma.$transaction(async (tx) => {
    await tx.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });

    for (const invoiceId of invoiceIds) {
      const invoice = affected.find((payment) => payment.invoiceId === invoiceId)?.invoice;
      if (!invoice) continue;

      const [remaining, reported] = await Promise.all([
        tx.payment.count({ where: { invoiceId } }),
        tx.reportedTransaction.count({ where: { invoiceId } }),
      ]);
      const nextStatus =
        remaining > 0
          ? InvoiceStatus.CONFIRMING
          : reported > 0
            ? InvoiceStatus.PENDING
            : InvoiceStatus.CREATED;

      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, status: { in: [...SETTLED_STATUSES, InvoiceStatus.CONFIRMING] } },
        data: { status: nextStatus, paidAt: null },
      });
      if (updated.count === 0) continue;

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId,
          fromStatus: invoice.status,
          toStatus: nextStatus,
          reason: 'chain reorganisation rolled back payment',
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
    { rewindTo: Number(rewindTo), payments: paymentIds.length, invoices: invoiceIds.length },
    'reorg rolled back payments',
  );
  return affected.length;
}
