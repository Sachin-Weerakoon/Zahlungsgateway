import { getServerEnv } from '@/lib/env';
import { jsonOk, route } from '@/lib/http';
import { getPublicInvoice } from '@/lib/invoices';
import { toPublicInvoice } from '@/lib/serializers';

export const dynamic = 'force-dynamic';

/** Public checkout data. Contains no merchant secrets (FR-CUS-1). */
export const GET = route<{ id: string }>(async (_request, _context, params) => {
  const env = getServerEnv();
  const { invoice, token, chain } = await getPublicInvoice(params.id, {
    chainId: env.CHAIN_ID,
    contractAddress: env.PAYMENT_PROCESSOR_ADDRESS,
  });

  return jsonOk({
    invoice: toPublicInvoice(invoice, invoice.merchant, token, chain),
  });
});
