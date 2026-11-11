import { createApiKeySchema } from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { jsonOk, readJson, route } from '@/lib/http';
import { createApiKey, listApiKeys } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  return jsonOk({ data: await listApiKeys(auth) });
});

/** Create an API key. The plaintext key is returned once (FR-MER-3). */
export const POST = route(async (request, context) => {
  const auth = await authenticate(request);
  const input = createApiKeySchema.parse(await readJson(request));
  const key = await createApiKey(auth, input.name, context.ip);
  return jsonOk({ apiKey: key }, 201);
});
