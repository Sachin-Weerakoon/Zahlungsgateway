import { getAddress, verifyMessage, type Hex } from 'viem';
import { prisma } from '@cryptopay/db';
import {
  ApiError,
  ApiErrorCode,
  ApiKeyStatus,
  AuditAction,
  WebhookEndpointStatus,
  validateWebhookUrl,
  type MerchantRole,
} from '@cryptopay/shared';
import {
  encryptSecret,
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
} from '@cryptopay/shared/crypto';
import { getServerEnv } from './env';
import { recordAudit } from './audit';
import { toMerchantProfile } from './serializers';
import type { AuthContext } from './auth';

const PAYOUT_MESSAGE_HEADER = 'CryptoPay Gateway payout address update';
const PAYOUT_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export async function getMerchantProfile(context: AuthContext) {
  const merchant = await prisma.merchant.findUnique({ where: { id: context.merchantId } });
  if (!merchant) throw new ApiError(ApiErrorCode.NotFound, 'Merchant not found');
  return toMerchantProfile(merchant, context.role as MerchantRole);
}

export async function updateBusinessProfile(
  context: AuthContext,
  input: { name?: string; supportEmail?: string },
) {
  const merchant = await prisma.merchant.update({
    where: { id: context.merchantId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.supportEmail !== undefined ? { supportEmail: input.supportEmail || null } : {}),
    },
  });
  return toMerchantProfile(merchant, context.role as MerchantRole);
}

/** Canonical message a merchant signs to change the payout address (FR-MER-2). */
export function payoutChangeMessage(merchantId: string, payoutAddress: string, issuedAt: Date): string {
  return [
    PAYOUT_MESSAGE_HEADER,
    `Merchant: ${merchantId}`,
    `Payout address: ${payoutAddress}`,
    `Issued at: ${issuedAt.toISOString()}`,
  ].join('\n');
}

export async function updatePayoutAddress(
  context: AuthContext,
  input: { payoutAddress: string; signature: string; message: string },
  ip: string,
) {
  const merchant = await prisma.merchant.findUnique({ where: { id: context.merchantId } });
  if (!merchant) throw new ApiError(ApiErrorCode.NotFound, 'Merchant not found');

  // Checksum validation: mixed-case addresses must be valid EIP-55.
  let checksummed: string;
  try {
    checksummed = getAddress(input.payoutAddress);
  } catch {
    throw new ApiError(ApiErrorCode.ValidationFailed, 'Payout address is not a valid checksummed address', 422, [
      { path: 'payoutAddress', message: 'Invalid checksummed EVM address' },
    ]);
  }

  const lines = input.message.split('\n');
  const issuedAtRaw = lines.find((line) => line.startsWith('Issued at: '))?.slice('Issued at: '.length);
  const issuedAt = issuedAtRaw ? new Date(issuedAtRaw) : null;
  if (!issuedAt || Number.isNaN(issuedAt.getTime())) {
    throw new ApiError(ApiErrorCode.BadRequest, 'Payout message is missing a valid "Issued at" line');
  }
  if (Math.abs(Date.now() - issuedAt.getTime()) > PAYOUT_SIGNATURE_TOLERANCE_MS) {
    throw new ApiError(ApiErrorCode.BadRequest, 'Payout signature has expired; sign a fresh message');
  }
  if (
    lines[0] !== PAYOUT_MESSAGE_HEADER ||
    !lines.includes(`Merchant: ${context.merchantId}`) ||
    !lines.includes(`Payout address: ${checksummed}`)
  ) {
    throw new ApiError(ApiErrorCode.BadRequest, 'Payout message does not match this request');
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyMessage({
      address: merchant.walletAddress as Hex,
      message: input.message,
      signature: input.signature as Hex,
    });
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new ApiError(ApiErrorCode.Unauthorized, 'Payout change signature is invalid');
  }

  const updated = await prisma.merchant.update({
    where: { id: merchant.id },
    data: { payoutAddress: checksummed },
  });

  await recordAudit({
    actor: merchant.walletAddress,
    action: AuditAction.PayoutAddressChanged,
    merchantId: merchant.id,
    target: checksummed,
    ip,
    metadata: { previous: merchant.payoutAddress },
  });

  return toMerchantProfile(updated, context.role as MerchantRole);
}

export async function listApiKeys(context: AuthContext) {
  return prisma.apiKey.findMany({
    where: { merchantId: context.merchantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      status: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
}

export async function createApiKey(context: AuthContext, name: string, ip: string) {
  const { key, prefix } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      merchantId: context.merchantId,
      name,
      prefix,
      keyHash: hashApiKey(key),
    },
  });

  await recordAudit({
    actor: context.walletAddress,
    action: AuditAction.ApiKeyCreated,
    merchantId: context.merchantId,
    target: created.id,
    ip,
    metadata: { name },
  });

  // The plaintext key is returned exactly once.
  return { id: created.id, name: created.name, prefix: created.prefix, key, createdAt: created.createdAt };
}

export async function revokeApiKey(context: AuthContext, keyId: string, ip: string) {
  const key = await prisma.apiKey.findFirst({
    where: { id: keyId, merchantId: context.merchantId },
  });
  if (!key) throw new ApiError(ApiErrorCode.NotFound, 'API key not found');
  if (key.status === ApiKeyStatus.REVOKED) {
    return { id: key.id, status: key.status };
  }

  const updated = await prisma.apiKey.update({
    where: { id: key.id },
    data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
  });

  await recordAudit({
    actor: context.walletAddress,
    action: AuditAction.ApiKeyRevoked,
    merchantId: context.merchantId,
    target: key.id,
    ip,
    metadata: { name: key.name, prefix: key.prefix },
  });

  return { id: updated.id, status: updated.status };
}

export async function getWebhookEndpoint(context: AuthContext) {
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { merchantId: context.merchantId },
  });
  if (!endpoint) return null;
  return {
    id: endpoint.id,
    url: endpoint.url,
    status: endpoint.status,
    secretSet: endpoint.secretEncrypted.length > 0,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

/**
 * Set the webhook URL and rotate its signing secret (FR-MER-5). The secret is shown once.
 * DNS-level SSRF checks run again in the delivery worker.
 */
export async function setWebhookEndpoint(context: AuthContext, url: string, ip: string) {
  const validation = validateWebhookUrl(url);
  if (!validation.ok) {
    throw new ApiError(ApiErrorCode.WebhookUrlRejected, validation.reason ?? 'Invalid webhook URL');
  }

  const env = getServerEnv();
  const secret = generateWebhookSecret();
  const secretEncrypted = encryptSecret(secret, env.WEBHOOK_ENCRYPTION_KEY);

  const endpoint = await prisma.webhookEndpoint.upsert({
    where: { merchantId: context.merchantId },
    create: {
      merchantId: context.merchantId,
      url,
      secretEncrypted,
      status: WebhookEndpointStatus.ACTIVE,
    },
    update: { url, secretEncrypted, status: WebhookEndpointStatus.ACTIVE },
  });

  await recordAudit({
    actor: context.walletAddress,
    action: AuditAction.WebhookSecretRotated,
    merchantId: context.merchantId,
    target: endpoint.id,
    ip,
    metadata: { url },
  });

  return {
    id: endpoint.id,
    url: endpoint.url,
    status: endpoint.status,
    secret,
    createdAt: endpoint.createdAt.toISOString(),
  };
}

export async function disableWebhookEndpoint(context: AuthContext, ip: string) {
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { merchantId: context.merchantId },
  });
  if (!endpoint) throw new ApiError(ApiErrorCode.NotFound, 'Webhook endpoint not found');

  const updated = await prisma.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { status: WebhookEndpointStatus.DISABLED },
  });

  await recordAudit({
    actor: context.walletAddress,
    action: 'merchant.webhook_disabled',
    merchantId: context.merchantId,
    target: endpoint.id,
    ip,
  });

  return { id: updated.id, status: updated.status };
}
