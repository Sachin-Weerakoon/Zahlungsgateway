import { prisma } from '@cryptopay/db';
import { upsertTokenSchema } from '@cryptopay/shared';
import { authenticate, requireAdmin } from '@/lib/auth';
import { upsertToken } from '@/lib/admin';
import { jsonOk, readJson, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  requireAdmin(auth);
  const tokens = await prisma.token.findMany({ orderBy: { symbol: 'asc' } });
  return jsonOk({ data: tokens });
});

/**
 * Mirror a token into the platform allowlist (FR-ADM-2).
 * The contract allowlist is still changed by the owner wallet; this controls merchant selection.
 */
export const POST = route(async (request, context) => {
  const auth = await authenticate(request);
  requireAdmin(auth);
  const input = upsertTokenSchema.parse(await readJson(request));
  return jsonOk({ token: await upsertToken(auth, input, context.ip) });
});
