import { setPayoutAddressSchema } from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { jsonOk, readJson, route } from '@/lib/http';
import { updatePayoutAddress } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

/** Change the payout address; requires a wallet signature and writes an audit entry (FR-MER-1/2). */
export const POST = route(async (request, context) => {
  const auth = await authenticate(request);
  const input = setPayoutAddressSchema.parse(await readJson(request));
  return jsonOk({ merchant: await updatePayoutAddress(auth, input, context.ip) });
});
