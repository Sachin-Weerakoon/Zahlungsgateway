import { merchantSearchSchema } from '@cryptopay/shared';
import { authenticate, requireAdmin } from '@/lib/auth';
import { listMerchants } from '@/lib/admin';
import { jsonOk, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  requireAdmin(auth);
  const query = merchantSearchSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return jsonOk(await listMerchants(query));
});
