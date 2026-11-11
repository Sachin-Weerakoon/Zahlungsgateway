import { settlementReportQuerySchema } from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { jsonOk, route } from '@/lib/http';
import { settlementReport } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** Settlement totals by token for a range (FR-SET-2). */
export const GET = route(async (request) => {
  const auth = await authenticate(request);
  const query = settlementReportQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  return jsonOk(await settlementReport(auth, new Date(query.from), new Date(query.to)));
});
