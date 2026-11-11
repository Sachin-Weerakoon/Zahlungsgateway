import { reportTransactionSchema } from '@cryptopay/shared';
import { checkRateLimit, jsonOk, readJson, route } from '@/lib/http';
import { reportTransaction } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

/**
 * Accept a customer-reported transaction hash (FR-CUS-4).
 * Informational only: it never marks the invoice paid.
 */
export const POST = route<{ id: string }>(async (request, context, params) => {
  checkRateLimit(`public-tx:${context.ip}`, 30);
  const input = reportTransactionSchema.parse(await readJson(request));
  await reportTransaction(params.id, input.txHash);
  return jsonOk({ accepted: true }, 202);
});
