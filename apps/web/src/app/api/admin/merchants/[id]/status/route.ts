import { z } from 'zod';
import { MerchantStatus } from '@cryptopay/shared';
import { authenticate, requireAdmin } from '@/lib/auth';
import { setMerchantStatus } from '@/lib/admin';
import { jsonOk, readJson, route } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ status: z.enum([MerchantStatus.ACTIVE, MerchantStatus.SUSPENDED]) });

/** Suspend or reactivate a merchant (FR-ADM-1). */
export const POST = route<{ id: string }>(async (request, context, params) => {
  const auth = await authenticate(request);
  requireAdmin(auth);
  const input = bodySchema.parse(await readJson(request));
  return jsonOk({ merchant: await setMerchantStatus(auth, params.id, input.status, context.ip) });
});
