import { z } from 'zod';
import { ApiError, ApiErrorCode, AuditAction, MerchantStatus, type MerchantRole } from '@cryptopay/shared';
import { prisma } from '@cryptopay/db';
import { adminWallets, getServerEnv } from '@/lib/env';
import { checkRateLimit, jsonOk, readJson, route } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { signSession, sessionCookie } from '@/lib/session';
import { verifySiwe } from '@/lib/siwe';
import { toMerchantProfile } from '@/lib/serializers';

export const dynamic = 'force-dynamic';

const verifySchema = z.object({
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/** Verify a SIWE signature, consume the nonce and start an 8-hour session (FR-AUTH-1/3/4). */
export const POST = route(async (request, context) => {
  checkRateLimit(`verify:${context.ip}`, 30);
  const body = verifySchema.parse(await readJson(request));
  const env = getServerEnv();
  const domain = new URL(env.APP_URL).host;

  const verified = await verifySiwe({
    message: body.message,
    signature: body.signature,
    expectedDomain: domain,
  });

  const now = new Date();
  const nonceRecord = await prisma.authNonce.findUnique({ where: { nonce: verified.nonce } });
  if (
    !nonceRecord ||
    nonceRecord.address !== verified.address ||
    nonceRecord.usedAt !== null ||
    nonceRecord.expiresAt.getTime() <= now.getTime()
  ) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'Nonce is invalid, expired or already used');
  }

  const { merchant, role } = await prisma.$transaction(async (tx) => {
    const consumed = await tx.authNonce.updateMany({
      where: { id: nonceRecord.id, usedAt: null },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      throw new ApiError(ApiErrorCode.Unauthorized, 'Nonce is invalid, expired or already used');
    }

    let record = await tx.merchant.findUnique({ where: { walletAddress: verified.address } });
    if (!record) {
      record = await tx.merchant.create({
        data: {
          walletAddress: verified.address,
          status: MerchantStatus.ACTIVE,
          members: {
            create: { walletAddress: verified.address, role: 'OWNER' },
          },
        },
      });
    }

    const membership = await tx.merchantMember.findUnique({
      where: {
        merchantId_walletAddress: {
          merchantId: record.id,
          walletAddress: verified.address,
        },
      },
    });

    return { merchant: record, role: (membership?.role ?? 'OWNER') as MerchantRole };
  });

  const token = signSession(
    { merchantId: merchant.id, walletAddress: merchant.walletAddress, role },
    env.AUTH_SECRET,
  );

  await recordAudit({
    actor: merchant.walletAddress,
    action: AuditAction.Login,
    merchantId: merchant.id,
    ip: context.ip,
    metadata: { via: 'siwe' },
  });

  return jsonOk(
    {
      merchant: toMerchantProfile(merchant, role),
      isAdmin: adminWallets(env).has(merchant.walletAddress.toLowerCase()),
    },
    200,
    { 'set-cookie': sessionCookie(token, env.NODE_ENV === 'production') },
  );
});
