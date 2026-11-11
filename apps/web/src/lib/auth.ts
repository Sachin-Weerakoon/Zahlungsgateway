import { createHash } from 'node:crypto';
import { ApiError, ApiErrorCode, ApiKeyStatus, MerchantStatus, type MerchantRole } from '@cryptopay/shared';
import { hashApiKey, safeEqualHex } from '@cryptopay/shared/crypto';
import { prisma } from '@cryptopay/db';
import { adminWallets, getServerEnv } from './env';
import { checkRateLimit } from './http';
import { readSessionCookie, verifySession } from './session';

export interface AuthContext {
  merchantId: string;
  walletAddress: string;
  role: MerchantRole;
  isAdmin: boolean;
  via: 'session' | 'apiKey';
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}

async function authenticateApiKey(key: string): Promise<AuthContext> {
  const parts = key.split('_');
  if (parts.length !== 4 || parts[0] !== 'cp' || parts[1] !== 'test' || !parts[2]) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'Invalid API key');
  }
  const prefix = parts[2];
  const apiKey = await prisma.apiKey.findUnique({
    where: { prefix },
    include: { merchant: true },
  });

  if (!apiKey || apiKey.status !== ApiKeyStatus.ACTIVE) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'Invalid API key');
  }
  if (!safeEqualHex(apiKey.keyHash, hashApiKey(key))) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'Invalid API key');
  }
  if (apiKey.merchant.status !== MerchantStatus.ACTIVE) {
    throw new ApiError(ApiErrorCode.Forbidden, 'Merchant account is suspended');
  }

  checkRateLimit(`key:${apiKey.id}`, 100);
  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  const env = getServerEnv();
  return {
    merchantId: apiKey.merchantId,
    walletAddress: apiKey.merchant.walletAddress,
    role: 'OWNER',
    isAdmin: adminWallets(env).has(apiKey.merchant.walletAddress.toLowerCase()),
    via: 'apiKey',
  };
}

async function authenticateSession(request: Request): Promise<AuthContext> {
  const token = readSessionCookie(request);
  if (!token) throw new ApiError(ApiErrorCode.Unauthorized, 'Authentication required');

  const env = getServerEnv();
  const payload = verifySession(token, env.AUTH_SECRET);
  if (!payload) throw new ApiError(ApiErrorCode.Unauthorized, 'Session expired or invalid');

  const merchant = await prisma.merchant.findUnique({ where: { id: payload.merchantId } });
  if (!merchant) throw new ApiError(ApiErrorCode.Unauthorized, 'Session is no longer valid');
  if (merchant.status !== MerchantStatus.ACTIVE) {
    throw new ApiError(ApiErrorCode.Forbidden, 'Merchant account is suspended');
  }

  return {
    merchantId: merchant.id,
    walletAddress: merchant.walletAddress,
    role: payload.role,
    isAdmin: adminWallets(env).has(merchant.walletAddress.toLowerCase()),
    via: 'session',
  };
}

/** Resolve the caller from an API key or session cookie. Merchant identity is never taken from the body. */
export async function authenticate(request: Request): Promise<AuthContext> {
  const token = bearerToken(request);
  if (token) return authenticateApiKey(token);
  return authenticateSession(request);
}

export function requireAdmin(context: AuthContext): void {
  if (!context.isAdmin) {
    throw new ApiError(ApiErrorCode.Forbidden, 'Admin access required');
  }
}

/** Stable, non-reversible request fingerprint used for idempotency conflict detection. */
export function requestFingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
}
