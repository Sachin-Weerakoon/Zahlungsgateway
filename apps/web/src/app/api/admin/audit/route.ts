import { auditQuerySchema } from '@cryptopay/shared';
import { authenticate, requireAdmin } from '@/lib/auth';
import { listAuditLog } from '@/lib/admin';
import { jsonOk, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Append-only audit log (FR-ADM-4). */
export const GET = route(async (request) => {
  const auth = await authenticate(request);
  requireAdmin(auth);
  const query = auditQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return jsonOk(await listAuditLog(query));
});
