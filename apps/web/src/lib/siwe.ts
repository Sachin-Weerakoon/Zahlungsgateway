import { randomBytes } from 'node:crypto';
import { ApiError, ApiErrorCode, NONCE_TTL_SECONDS } from '@cryptopay/shared';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { verifyMessage, type Hex } from 'viem';

export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

export function nonceExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + NONCE_TTL_SECONDS * 1000);
}

export interface VerifiedSiwe {
  address: string;
  nonce: string;
  issuedAt: Date | undefined;
}

/**
 * Verify a Sign-In With Ethereum message (FR-AUTH-1/2).
 * The caller must still confirm that the nonce was issued by us and is unused.
 */
export async function verifySiwe(params: {
  message: string;
  signature: string;
  expectedDomain: string;
  now?: Date;
}): Promise<VerifiedSiwe> {
  const now = params.now ?? new Date();

  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(params.message);
  } catch {
    throw new ApiError(ApiErrorCode.Unauthorized, 'Malformed SIWE message');
  }

  if (!parsed.address || !parsed.nonce) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'SIWE message is missing address or nonce');
  }

  const valid = validateSiweMessage({
    message: parsed,
    address: parsed.address,
    domain: params.expectedDomain,
    nonce: parsed.nonce,
    time: now,
  });
  if (!valid) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'SIWE message is expired or invalid');
  }
  if (parsed.expirationTime && parsed.expirationTime.getTime() <= now.getTime()) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'SIWE message has expired');
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyMessage({
      address: parsed.address,
      message: params.message,
      signature: params.signature as Hex,
    });
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'Signature does not match the wallet address');
  }

  return {
    address: parsed.address.toLowerCase(),
    nonce: parsed.nonce,
    issuedAt: parsed.issuedAt,
  };
}
