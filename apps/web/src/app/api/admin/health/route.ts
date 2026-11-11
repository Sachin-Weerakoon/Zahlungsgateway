import { authenticate, requireAdmin } from '@/lib/auth';
import { platformHealth } from '@/lib/admin';
import { jsonOk, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  requireAdmin(auth);
  return jsonOk(await platformHealth());
});
