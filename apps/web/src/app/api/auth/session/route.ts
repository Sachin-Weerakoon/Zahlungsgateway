import { authenticate } from '@/lib/auth';
import { jsonOk, route } from '@/lib/http';
import { getMerchantProfile } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

/** Current merchant identity for the dashboard bootstrap. */
export const GET = route(async (request) => {
  const auth = await authenticate(request);
  const merchant = await getMerchantProfile(auth);
  return jsonOk({ merchant, isAdmin: auth.isAdmin, via: auth.via });
});
