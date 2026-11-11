import {
  createInvoiceSchema,
  idempotencyKeySchema,
  listInvoicesQuerySchema,
} from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { getServerEnv } from '@/lib/env';
import { jsonOk, readJson, route } from '@/lib/http';
import { createInvoice, listInvoices } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

/** Create an invoice. Honours Idempotency-Key for 24 hours (FR-INV-1/5). */
export const POST = route(async (request) => {
  const auth = await authenticate(request);
  const input = createInvoiceSchema.parse(await readJson(request));

  const rawKey = request.headers.get('idempotency-key');
  const idempotencyKey = rawKey ? idempotencyKeySchema.parse(rawKey) : null;

  const result = await createInvoice(auth, input, idempotencyKey);
  const env = getServerEnv();
  const checkoutUrl = `${env.APP_URL.replace(/\/$/, '')}/pay/${result.invoice.id}`;

  return jsonOk(
    { invoice: result.invoice, checkoutUrl },
    result.replayed ? 200 : 201,
    result.replayed ? { 'idempotency-replayed': 'true' } : undefined,
  );
});

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  const query = listInvoicesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  return jsonOk(await listInvoices(auth, query));
});
