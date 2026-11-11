import { ApiError, ApiErrorCode } from '@cryptopay/shared';
import { prisma } from '@cryptopay/db';
import { checkRateLimit, jsonOk, route } from '@/lib/http';
import { createNonce, nonceExpiry } from '@/lib/siwe';

export const dynamic = 'force-dynamic';

/** Issue a single-use SIWE nonce (FR-AUTH-2). */
export const GET = route(async (request, context) => {
  checkRateLimit(`nonce:${context.ip}`, 30);

  const address = new URL(request.url).searchParams.get('address') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new ApiError(ApiErrorCode.BadRequest, 'A valid ?address=0x... query parameter is required');
  }

  const nonce = createNonce();
  const expiresAt = nonceExpiry();

  await prisma.authNonce.create({
    data: { nonce, address: address.toLowerCase(), expiresAt },
  });

  return jsonOk({ nonce, expiresAt: expiresAt.toISOString() });
});
