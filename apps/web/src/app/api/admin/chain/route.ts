import { authenticate, requireAdmin } from '@/lib/auth';
import { chainStatus } from '@/lib/admin';
import { jsonOk, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Live contract configuration; the chain is the source of truth (FR-ADM-3). */
export const GET = route(async (request) => {
  const auth = await authenticate(request);
  requireAdmin(auth);
  return jsonOk(await chainStatus());
});
