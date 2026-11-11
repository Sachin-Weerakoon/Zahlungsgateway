import { z } from 'zod';
import { webhookUrlSchema } from '@cryptopay/shared';
import { authenticate } from '@/lib/auth';
import { jsonOk, readJson, route } from '@/lib/http';
import {
  disableWebhookEndpoint,
  getWebhookEndpoint,
  setWebhookEndpoint,
} from '@/lib/merchants';

export const dynamic = 'force-dynamic';

const setSchema = z.object({ url: webhookUrlSchema });

export const GET = route(async (request) => {
  const auth = await authenticate(request);
  return jsonOk({ endpoint: await getWebhookEndpoint(auth) });
});

/** Set the webhook URL and rotate the signing secret. The secret is returned once (FR-MER-5). */
export const PUT = route(async (request, context) => {
  const auth = await authenticate(request);
  const input = setSchema.parse(await readJson(request));
  return jsonOk({ endpoint: await setWebhookEndpoint(auth, input.url, context.ip) });
});

export const DELETE = route(async (request, context) => {
  const auth = await authenticate(request);
  return jsonOk({ endpoint: await disableWebhookEndpoint(auth, context.ip) });
});
