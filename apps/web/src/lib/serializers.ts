import type {
  InvoiceDetail,
  InvoicePaymentSummary,
  InvoiceStatus,
  InvoiceStatusHistoryEntry,
  MerchantProfile,
  MerchantRole,
  MerchantStatus,
  PublicInvoice,
} from '@cryptopay/shared';

/** Shape of a Prisma invoice with the relations the serializers need. */
interface InvoiceRow {
  id: string;
  merchantId: string;
  invoiceRef: string;
  status: string;
  amount: { toString(): string };
  tokenAddress: string;
  description: string | null;
  merchantReference: string | null;
  metadata: unknown;
  expiresAt: Date;
  createdAt: Date;
}

interface PaymentRow {
  id: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  payer: string;
  gross: { toString(): string };
  fee: { toString(): string };
  net: { toString(): string };
  refundedTotal: { toString(): string };
  confirmations: number;
  isLate: boolean;
  createdAt: Date;
}

interface HistoryRow {
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  txHash: string | null;
  createdAt: Date;
}

export function toInvoiceSummary(invoice: InvoiceRow) {
  return {
    id: invoice.id,
    invoiceRef: invoice.invoiceRef,
    status: invoice.status as InvoiceStatus,
    amount: invoice.amount.toString(),
    tokenAddress: invoice.tokenAddress,
    description: invoice.description,
    merchantReference: invoice.merchantReference,
    expiresAt: invoice.expiresAt.toISOString(),
    createdAt: invoice.createdAt.toISOString(),
  };
}

export function toInvoiceDetail(
  invoice: InvoiceRow & { payments: PaymentRow[]; statusHistory: HistoryRow[] },
): InvoiceDetail {
  const payments: InvoicePaymentSummary[] = invoice.payments.map((payment) => ({
    id: payment.id,
    txHash: payment.txHash,
    logIndex: payment.logIndex,
    blockNumber: Number(payment.blockNumber),
    payer: payment.payer,
    gross: payment.gross.toString(),
    fee: payment.fee.toString(),
    net: payment.net.toString(),
    refundedTotal: payment.refundedTotal.toString(),
    confirmations: payment.confirmations,
    isLate: payment.isLate,
    createdAt: payment.createdAt.toISOString(),
  }));

  const statusHistory: InvoiceStatusHistoryEntry[] = invoice.statusHistory.map((entry) => ({
    fromStatus: entry.fromStatus as InvoiceStatus | null,
    toStatus: entry.toStatus as InvoiceStatus,
    reason: entry.reason,
    txHash: entry.txHash,
    createdAt: entry.createdAt.toISOString(),
  }));

  return {
    id: invoice.id,
    merchantId: invoice.merchantId,
    invoiceRef: invoice.invoiceRef,
    status: invoice.status as InvoiceStatus,
    amount: invoice.amount.toString(),
    tokenAddress: invoice.tokenAddress,
    description: invoice.description,
    merchantReference: invoice.merchantReference,
    metadata: (invoice.metadata as Record<string, unknown> | null) ?? null,
    expiresAt: invoice.expiresAt.toISOString(),
    createdAt: invoice.createdAt.toISOString(),
    payments,
    statusHistory,
  };
}

export function toPublicInvoice(
  invoice: InvoiceRow,
  merchant: { name: string | null; payoutAddress: string | null },
  token: { address: string; symbol: string; decimals: number },
  chain: { chainId: number; contractAddress: string },
): PublicInvoice {
  return {
    id: invoice.id,
    status: invoice.status as InvoiceStatus,
    amount: invoice.amount.toString(),
    token: { address: token.address, symbol: token.symbol, decimals: token.decimals },
    description: invoice.description,
    merchant: {
      name: merchant.name ?? 'Merchant',
      payoutAddress: merchant.payoutAddress ?? '0x0000000000000000000000000000000000000000',
    },
    contractAddress: chain.contractAddress,
    chainId: chain.chainId,
    invoiceRef: invoice.invoiceRef,
    expiresAt: invoice.expiresAt.toISOString(),
    createdAt: invoice.createdAt.toISOString(),
  };
}

export function toMerchantProfile(merchant: {
  id: string;
  walletAddress: string;
  name: string | null;
  supportEmail: string | null;
  payoutAddress: string | null;
  status: string;
  createdAt: Date;
}, role: MerchantRole): MerchantProfile {
  return {
    id: merchant.id,
    walletAddress: merchant.walletAddress,
    name: merchant.name,
    supportEmail: merchant.supportEmail,
    payoutAddress: merchant.payoutAddress,
    status: merchant.status as MerchantStatus,
    role,
    createdAt: merchant.createdAt.toISOString(),
  };
}
