import { authenticate } from '@/lib/auth';
import { jsonOk, route } from '@/lib/http';
import { cancelInvoice } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(async (request, _context, params) => {
  const auth = await authenticate(request);
  return jsonOk({ invoice: await cancelInvoice(auth, params.id) });
});
