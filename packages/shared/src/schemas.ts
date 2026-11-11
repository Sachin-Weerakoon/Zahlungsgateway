import { z } from 'zod';
import {
  DEFAULT_EXPIRY_MINUTES,
  DEFAULT_PAGE_SIZE,
  MAX_DESCRIPTION_LENGTH,
  MAX_EXPIRY_MINUTES,
  MAX_MERCHANT_REFERENCE_LENGTH,
  MAX_METADATA_BYTES,
  MAX_PAGE_SIZE,
  MIN_EXPIRY_MINUTES,
} from './constants.js';
import { INVOICE_STATUSES } from './enums.js';

/** 0x-prefixed 20-byte EVM address (checksum validation happens server-side). */
export const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x-prefixed 20-byte EVM address');

/** 0x-prefixed 32-byte hash. */
export const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 32-byte hex value');

/** Unsigned base-unit amount encoded as a decimal string. */
export const baseUnitSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'Amount must be an unsigned decimal base-unit string')
  .refine(
    (value) => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n,
    'Amount must be greater than zero',
  );

/** ISO 8601 UTC timestamp with a Z suffix. */
export const isoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
    'Must be an ISO 8601 UTC timestamp',
  );

export const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= MAX_METADATA_BYTES,
    `Metadata must be at most ${MAX_METADATA_BYTES} bytes when serialised`,
  );

export const createInvoiceSchema = z.object({
  amount: baseUnitSchema,
  tokenAddress: evmAddressSchema,
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
  merchantReference: z.string().trim().max(MAX_MERCHANT_REFERENCE_LENGTH).optional(),
  metadata: metadataSchema.optional(),
  expiresInMinutes: z
    .number()
    .int()
    .min(MIN_EXPIRY_MINUTES)
    .max(MAX_EXPIRY_MINUTES)
    .default(DEFAULT_EXPIRY_MINUTES),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const invoiceStatusSchema = z.enum(INVOICE_STATUSES as [string, ...string[]]);

export const listInvoicesQuerySchema = z.object({
  status: invoiceStatusSchema.optional(),
  from: isoTimestampSchema.optional(),
  to: isoTimestampSchema.optional(),
  reference: z.string().trim().max(MAX_MERCHANT_REFERENCE_LENGTH).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const settlementReportQuerySchema = z
  .object({
    from: isoTimestampSchema,
    to: isoTimestampSchema,
  })
  .refine((value) => new Date(value.from) <= new Date(value.to), {
    message: 'from must be before or equal to to',
  });

export type SettlementReportQuery = z.infer<typeof settlementReportQuerySchema>;

export const webhookUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), 'Webhook URL must use HTTPS');

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const setPayoutAddressSchema = z.object({
  payoutAddress: evmAddressSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  message: z.string().min(1),
});

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    supportEmail: z.union([z.string().trim().email().max(254), z.literal('')]).optional(),
  })
  .refine((value) => value.name !== undefined || value.supportEmail !== undefined, {
    message: 'Provide at least one field to update',
  });

export const upsertTokenSchema = z.object({
  address: evmAddressSchema,
  symbol: z.string().trim().min(1).max(16),
  decimals: z.number().int().min(0).max(36),
  allowed: z.boolean(),
});

export const auditQuerySchema = z.object({
  merchantId: z.string().uuid().optional(),
  action: z.string().trim().max(64).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const merchantSearchSchema = z.object({
  search: z.string().trim().max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export const reportTransactionSchema = z.object({
  txHash: bytes32Schema,
});

/** Parse input and return a flattened, machine-readable error list. */
export function formatZodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}
