import { authenticate } from '@/lib/auth';
import { jsonOk, route } from '@/lib/http';
import { revokeApiKey } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

/** Revoke an API key immediately (FR-MER-4). */
export const DELETE = route<{ id: string }>(async (request, context, params) => {
  const auth = await authenticate(request);
  return jsonOk({ apiKey: await revokeApiKey(auth, params.id, context.ip) });
});
