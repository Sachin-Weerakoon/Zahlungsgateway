/** Domain enums shared by the API, indexer, worker and web app. */

export const InvoiceStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  CONFIRMING: 'CONFIRMING',
  PAID: 'PAID',
  UNDERPAID: 'UNDERPAID',
  OVERPAID: 'OVERPAID',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;

export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const INVOICE_STATUSES = Object.values(InvoiceStatus);

export const MerchantStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

export type MerchantStatus = (typeof MerchantStatus)[keyof typeof MerchantStatus];

export const MerchantRole = {
  OWNER: 'OWNER',
  VIEWER: 'VIEWER',
} as const;

export type MerchantRole = (typeof MerchantRole)[keyof typeof MerchantRole];

export const ApiKeyStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
} as const;

export type ApiKeyStatus = (typeof ApiKeyStatus)[keyof typeof ApiKeyStatus];

export const WebhookEndpointStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;

export type WebhookEndpointStatus =
  (typeof WebhookEndpointStatus)[keyof typeof WebhookEndpointStatus];

export const WebhookDeliveryStatus = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;

export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];

/** Every webhook event type the platform can emit (SRS FR-WH-1). */
export const WebhookEventType = {
  InvoiceConfirming: 'invoice.confirming',
  InvoicePaid: 'invoice.paid',
  InvoiceUnderpaid: 'invoice.underpaid',
  InvoiceOverpaid: 'invoice.overpaid',
  InvoiceExpired: 'invoice.expired',
  InvoiceRefunded: 'invoice.refunded',
  PaymentLate: 'payment.late',
  PaymentReorged: 'payment.reorged',
} as const;

export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

export const WEBHOOK_EVENT_TYPES = Object.values(WebhookEventType);

/** Audit log action identifiers. */
export const AuditAction = {
  Login: 'auth.login',
  Logout: 'auth.logout',
  PayoutAddressChanged: 'merchant.payout_address_changed',
  ApiKeyCreated: 'merchant.api_key_created',
  ApiKeyRevoked: 'merchant.api_key_revoked',
  WebhookSecretRotated: 'merchant.webhook_secret_rotated',
  MerchantSuspended: 'admin.merchant_suspended',
  MerchantReactivated: 'admin.merchant_reactivated',
  FeeUpdated: 'admin.fee_updated',
  TokenAllowed: 'admin.token_allowed',
  TokenDisallowed: 'admin.token_disallowed',
  ContractPaused: 'admin.contract_paused',
  ContractUnpaused: 'admin.contract_unpaused',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Stable error codes returned by the API (SRS 6.4). */
export const ApiErrorCode = {
  BadRequest: 'BAD_REQUEST',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  ValidationFailed: 'VALIDATION_FAILED',
  RateLimited: 'RATE_LIMITED',
  InvoiceNotPayable: 'INVOICE_NOT_PAYABLE',
  InvoiceExpired: 'INVOICE_EXPIRED',
  IdempotencyConflict: 'IDEMPOTENCY_CONFLICT',
  WebhookUrlRejected: 'WEBHOOK_URL_REJECTED',
  RpcUnavailable: 'RPC_UNAVAILABLE',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
