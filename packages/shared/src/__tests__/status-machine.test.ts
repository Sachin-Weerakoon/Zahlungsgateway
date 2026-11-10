import { describe, expect, it } from 'vitest';
import { InvoiceStatus } from '../enums.js';
import {
  assertTransition,
  canTransition,
  isFinalStatus,
  isPayableStatus,
  statusForPaidAmount,
} from '../status-machine.js';

describe('invoice status machine', () => {
  it('allows the happy path CREATED -> PENDING -> CONFIRMING -> PAID', () => {
    expect(canTransition(InvoiceStatus.CREATED, InvoiceStatus.PENDING)).toBe(true);
    expect(canTransition(InvoiceStatus.PENDING, InvoiceStatus.CONFIRMING)).toBe(true);
    expect(canTransition(InvoiceStatus.CONFIRMING, InvoiceStatus.PAID)).toBe(true);
  });

  it('allows a reorg to return CONFIRMING to PENDING', () => {
    expect(canTransition(InvoiceStatus.CONFIRMING, InvoiceStatus.PENDING)).toBe(true);
  });

  it('rejects skipping confirmations', () => {
    expect(canTransition(InvoiceStatus.CREATED, InvoiceStatus.PAID)).toBe(false);
    expect(canTransition(InvoiceStatus.PENDING, InvoiceStatus.PAID)).toBe(false);
  });

  it('allows refunds only from settled payment states', () => {
    expect(canTransition(InvoiceStatus.PAID, InvoiceStatus.REFUNDED)).toBe(true);
    expect(canTransition(InvoiceStatus.UNDERPAID, InvoiceStatus.REFUNDED)).toBe(true);
    expect(canTransition(InvoiceStatus.OVERPAID, InvoiceStatus.REFUNDED)).toBe(true);
    expect(canTransition(InvoiceStatus.CREATED, InvoiceStatus.REFUNDED)).toBe(false);
  });

  it('treats EXPIRED, CANCELLED and REFUNDED as final', () => {
    for (const status of [InvoiceStatus.EXPIRED, InvoiceStatus.CANCELLED, InvoiceStatus.REFUNDED]) {
      expect(isFinalStatus(status)).toBe(true);
      expect(canTransition(status, InvoiceStatus.PAID)).toBe(false);
    }
  });

  it('allows cancellation only from CREATED', () => {
    expect(canTransition(InvoiceStatus.CREATED, InvoiceStatus.CANCELLED)).toBe(true);
    expect(canTransition(InvoiceStatus.PENDING, InvoiceStatus.CANCELLED)).toBe(false);
  });

  it('throws a descriptive error on an invalid transition', () => {
    expect(() => assertTransition(InvoiceStatus.PAID, InvoiceStatus.CREATED)).toThrow(
      /PAID -> CREATED/,
    );
  });

  it('treats CREATED and PENDING as payable', () => {
    expect(isPayableStatus(InvoiceStatus.CREATED)).toBe(true);
    expect(isPayableStatus(InvoiceStatus.PENDING)).toBe(true);
    expect(isPayableStatus(InvoiceStatus.CONFIRMING)).toBe(false);
  });

  it('maps paid amounts to PAID, UNDERPAID and OVERPAID', () => {
    expect(statusForPaidAmount(100n, 100n)).toBe(InvoiceStatus.PAID);
    expect(statusForPaidAmount(99n, 100n)).toBe(InvoiceStatus.UNDERPAID);
    expect(statusForPaidAmount(101n, 100n)).toBe(InvoiceStatus.OVERPAID);
  });
});
