import { authenticate } from '@/lib/auth';
import { jsonOk, route } from '@/lib/http';
import { getInvoiceDetail } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

/** Invoice detail, scoped to the authenticated merchant (AC-12). */
export const GET = route<{ id: string }>(async (request, _context, params) => {
  const auth = await authenticate(request);
  return jsonOk({ invoice: await getInvoiceDetail(auth, params.id) });
});
