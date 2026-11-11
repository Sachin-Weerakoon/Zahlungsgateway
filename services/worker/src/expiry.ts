import { prisma } from '@cryptopay/db';
import { enqueueWebhookEvent } from '@cryptopay/db/webhooks';
import { InvoiceStatus, WebhookEventType } from '@cryptopay/shared';
import type { Logger } from './logger.js';

/**
 * Expire invoices whose window closed without a confirmed payment (FR-INV-6).
 *
 * Only CREATED and PENDING expire: once a payment is observed (CONFIRMING) the invoice waits for
 * confirmations regardless of the original expiry, and a late payment is flagged instead.
 */
export async function expireDueInvoices(chainId: number, logger: Logger): Promise<number> {
  const now = new Date();
  const due = await prisma.invoice.findMany({
    where: {
      status: { in: [InvoiceStatus.CREATED, InvoiceStatus.PENDING] },
      expiresAt: { lte: now },
    },
    orderBy: { expiresAt: 'asc' },
    take: 200,
  });

  let expired = 0;

  for (const invoice of due) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.updateMany({
        where: {
          id: invoice.id,
          status: { in: [InvoiceStatus.CREATED, InvoiceStatus.PENDING] },
        },
        data: { status: InvoiceStatus.EXPIRED },
      });
      if (updated.count === 0) return;

      await tx.invoiceStatusHistory.create({
        data: {
          invoiceId: invoice.id,
          fromStatus: invoice.status,
          toStatus: InvoiceStatus.EXPIRED,
          reason: 'invoice expired without a confirmed payment',
        },
      });
      await enqueueWebhookEvent(tx, {
        invoiceId: invoice.id,
        merchantId: invoice.merchantId,
        type: WebhookEventType.InvoiceExpired,
        data: {
          invoiceId: invoice.id,
          merchantReference: invoice.merchantReference,
          status: InvoiceStatus.EXPIRED,
          token: invoice.tokenAddress,
          amount: invoice.amount.toString(),
          fee: '0',
          net: '0',
          txHash: null,
          blockNumber: null,
          confirmations: 0,
          chainId,
        },
      });
      expired += 1;
    });
  }

  if (expired > 0) logger.info({ expired }, 'invoices expired');
  return expired;
}
