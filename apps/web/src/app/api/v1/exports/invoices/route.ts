import { isoTimestampSchema } from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { route } from '@/lib/http';
import { exportInvoicesCsv } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** CSV export of invoices with UTF-8 BOM and ISO 8601 timestamps (FR-SET-3). */
export const GET = route(async (request) => {
  const auth = await authenticate(request);
  const params = new URL(request.url).searchParams;
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const from = rawFrom ? new Date(isoTimestampSchema.parse(rawFrom)) : null;
  const to = rawTo ? new Date(isoTimestampSchema.parse(rawTo)) : null;

  const csv = await exportInvoicesCsv(auth, from, to);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="cryptopay-invoices.csv"',
    },
  });
});
