import { setTimeout as sleep } from 'node:timers/promises';
import { prisma } from '@cryptopay/db';

export const dynamic = 'force-dynamic';

/**
 * Server-sent events stream of invoice status changes for the checkout page (FR-CUS-4).
 * The stream polls the database; the chain-backed indexer remains the source of truth.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cancelled = false;
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cancelled = true;
        }
      };

      send('open', { invoiceId: id });

      let lastStatus = '';
      const deadline = Date.now() + 5 * 60 * 1000;

      try {
        while (!cancelled && Date.now() < deadline) {
          const invoice = await prisma.invoice.findUnique({
            where: { id },
            select: { status: true, updatedAt: true },
          });

          if (!invoice) {
            send('error', { code: 'NOT_FOUND' });
            break;
          }
          if (invoice.status !== lastStatus) {
            lastStatus = invoice.status;
            send('status', {
              status: invoice.status,
              updatedAt: invoice.updatedAt.toISOString(),
            });
          }
          await sleep(2_000);
        }
      } catch {
        send('error', { code: 'STREAM_FAILED' });
      }

      try {
        controller.close();
      } catch {
        // Already closed by the client.
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
