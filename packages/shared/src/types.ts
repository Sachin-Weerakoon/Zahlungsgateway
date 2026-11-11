import type { InvoiceStatus, MerchantRole, MerchantStatus, WebhookEventType } from './enums.js';

/** Public checkout view of an invoice. Never contains merchant secrets. */
export interface PublicInvoice {
  id: string;
  status: InvoiceStatus;
  amount: string;
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  description: string | null;
  merchant: {
    name: string;
    payoutAddress: string;
  };
  contractAddress: string;
  chainId: number;
  invoiceRef: string;
  expiresAt: string;
  createdAt: string;
}

export interface InvoicePaymentSummary {
  id: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  payer: string;
  gross: string;
  fee: string;
  net: string;
  refundedTotal: string;
  confirmations: number;
  isLate: boolean;
  createdAt: string;
}

export interface InvoiceStatusHistoryEntry {
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  reason: string | null;
  txHash: string | null;
  createdAt: string;
}

export interface InvoiceDetail {
  id: string;
  merchantId: string;
  invoiceRef: string;
  status: InvoiceStatus;
  amount: string;
  tokenAddress: string;
  description: string | null;
  merchantReference: string | null;
  metadata: Record<string, unknown> | null;
  expiresAt: string;
  createdAt: string;
  payments: InvoicePaymentSummary[];
  statusHistory: InvoiceStatusHistoryEntry[];
}

export interface MerchantProfile {
  id: string;
  walletAddress: string;
  name: string | null;
  supportEmail: string | null;
  payoutAddress: string | null;
  status: MerchantStatus;
  role: MerchantRole;
  createdAt: string;
}

export interface WebhookEventData {
  invoiceId: string;
  merchantReference: string | null;
  status: InvoiceStatus;
  token: string;
  amount: string;
  fee: string;
  net: string;
  txHash: string | null;
  blockNumber: number | null;
  confirmations: number;
  chainId: number;
}

/** Signed webhook payload (SRS 6.5). */
export interface WebhookPayload {
  id: string;
  type: WebhookEventType;
  sequence: number;
  created: string;
  data: WebhookEventData;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface SettlementReportRow {
  tokenAddress: string;
  symbol: string;
  decimals: number;
  paymentCount: number;
  gross: string;
  fee: string;
  net: string;
  refunds: string;
}

export interface SettlementReport {
  from: string;
  to: string;
  rows: SettlementReportRow[];
}
