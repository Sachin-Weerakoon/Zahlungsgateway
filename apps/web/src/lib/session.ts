import { createHmac, timingSafeEqual } from 'node:crypto';
import { SESSION_TTL_SECONDS, type MerchantRole } from '@cryptopay/shared';

export const SESSION_COOKIE_NAME = 'cryptopay_session';

export interface SessionPayload {
  merchantId: string;
  walletAddress: string;
  role: MerchantRole;
  /** Unix seconds. */
  exp: number;
}

function encode(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function signature(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url');
}

export function signSession(
  payload: Omit<SessionPayload, 'exp'>,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const encoded = encode({ ...payload, exp: nowSeconds + ttlSeconds });
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifySession(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  const [encoded, provided] = token.split('.');
  if (!encoded || !provided) return null;

  const expected = signature(encoded, secret);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (
      typeof payload.merchantId !== 'string' ||
      typeof payload.walletAddress !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    if (payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) {
      const value = rest.join('=');
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
