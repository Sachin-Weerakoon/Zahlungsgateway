import { paginationQuerySchema } from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { jsonOk, route } from '@/lib/http';
import { listPayments } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  const query = paginationQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return jsonOk(await listPayments(auth, query));
});
