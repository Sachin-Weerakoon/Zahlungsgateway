import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  WebhookDeliveryStatus,
  WebhookEndpointStatus,
  type WebhookEventData,
  type WebhookEventType,
  type WebhookPayload,
} from '@cryptopay/shared';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface EnqueueWebhookParams {
  invoiceId: string;
  merchantId: string;
  type: WebhookEventType;
  data: WebhookEventData;
}

/**
 * Persist a webhook event and, when the merchant has an active endpoint, its first delivery
 * attempt. The event row is written in the same transaction as the invoice status change, so a
 * status can never exist without its corresponding event (SRS FR-WH-1).
 *
 * Delivery itself is performed by the worker, which polls the database-backed queue. This keeps
 * retries durable without requiring Redis.
 */
export async function enqueueWebhookEvent(
  db: DbClient,
  params: EnqueueWebhookParams,
): Promise<string> {
  const last = await db.webhookEvent.findFirst({
    where: { invoiceId: params.invoiceId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });

  const sequence = (last?.sequence ?? 0) + 1;
  const id = randomUUID();
  const payload: WebhookPayload = {
    id,
    type: params.type,
    sequence,
    created: new Date().toISOString(),
    data: params.data,
  };

  const event = await db.webhookEvent.create({
    data: {
      id,
      invoiceId: params.invoiceId,
      type: params.type,
      sequence,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });

  const endpoint = await db.webhookEndpoint.findUnique({
    where: { merchantId: params.merchantId },
    select: { status: true },
  });

  if (endpoint?.status === WebhookEndpointStatus.ACTIVE) {
    await db.webhookDelivery.create({
      data: {
        eventId: event.id,
        attempt: 1,
        status: WebhookDeliveryStatus.PENDING,
        nextRetryAt: new Date(),
      },
    });
  }

  return event.id;
}
