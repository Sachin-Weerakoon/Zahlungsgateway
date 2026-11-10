import { InvoiceStatus } from './enums.js';

/**
 * Invoice status machine (SRS 5.4).
 *
 * Notes:
 * - PENDING is informational: a browser reported a transaction hash but no
 *   contract event has been observed yet. It never counts as payment.
 * - PAID / UNDERPAID / OVERPAID are decided only after N confirmations.
 * - EXPIRED and CANCELLED are final.
 * - REFUNDED is final and reachable from any settled payment state.
 */
export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  CREATED: [InvoiceStatus.PENDING, InvoiceStatus.EXPIRED, InvoiceStatus.CANCELLED],
  PENDING: [InvoiceStatus.CONFIRMING, InvoiceStatus.EXPIRED],
  CONFIRMING: [
    InvoiceStatus.PAID,
    InvoiceStatus.UNDERPAID,
    InvoiceStatus.OVERPAID,
    InvoiceStatus.PENDING,
  ],
  PAID: [InvoiceStatus.REFUNDED],
  UNDERPAID: [InvoiceStatus.REFUNDED],
  OVERPAID: [InvoiceStatus.REFUNDED],
  EXPIRED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/** Final statuses never transition again. */
export const FINAL_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.EXPIRED,
  InvoiceStatus.CANCELLED,
  InvoiceStatus.REFUNDED,
];

/** Statuses in which a customer must not be allowed to start a payment. */
export const NON_PAYABLE_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.CONFIRMING,
  InvoiceStatus.PAID,
  InvoiceStatus.UNDERPAID,
  InvoiceStatus.OVERPAID,
  InvoiceStatus.EXPIRED,
  InvoiceStatus.CANCELLED,
  InvoiceStatus.REFUNDED,
];

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

export function isFinalStatus(status: InvoiceStatus): boolean {
  return FINAL_INVOICE_STATUSES.includes(status);
}

export function isPayableStatus(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.CREATED || status === InvoiceStatus.PENDING;
}

export class InvalidStatusTransitionError extends Error {
  readonly from: InvoiceStatus;
  readonly to: InvoiceStatus;

  constructor(from: InvoiceStatus, to: InvoiceStatus) {
    super(`Invalid invoice status transition: ${from} -> ${to}`);
    this.name = 'InvalidStatusTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}

/** Map a settled payment comparison to its final invoice status. */
export function statusForPaidAmount(paid: bigint, expected: bigint): InvoiceStatus {
  if (paid === expected) return InvoiceStatus.PAID;
  if (paid < expected) return InvoiceStatus.UNDERPAID;
  return InvoiceStatus.OVERPAID;
}
