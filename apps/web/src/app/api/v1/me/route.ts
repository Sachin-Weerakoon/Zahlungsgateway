import { updateProfileSchema } from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { jsonOk, readJson, route } from '@/lib/http';
import { getMerchantProfile, updateBusinessProfile } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  return jsonOk({ merchant: await getMerchantProfile(auth), isAdmin: auth.isAdmin });
});

/** Edit the business profile (FR-AUTH-7, should-have). */
export const PATCH = route(async (request) => {
  const auth = await authenticate(request);
  const input = updateProfileSchema.parse(await readJson(request));
  return jsonOk({ merchant: await updateBusinessProfile(auth, input) });
});
