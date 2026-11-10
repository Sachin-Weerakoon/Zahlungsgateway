import { describe, expect, it } from 'vitest';
import {
  calculateFee,
  calculateNet,
  formatBaseUnits,
  fromDisplayAmount,
  parseBaseUnits,
  toDisplayAmount,
} from '../money.js';

describe('money helpers', () => {
  it('parses and formats base-unit strings without precision loss', () => {
    const value = parseBaseUnits('25000000');
    expect(value).toBe(25_000_000n);
    expect(formatBaseUnits(value)).toBe('25000000');
  });

  it('rejects signs, decimals and whitespace in base units', () => {
    for (const invalid of ['-1', '1.5', ' 1', '1 ', '01', 'abc', '']) {
      expect(() => parseBaseUnits(invalid)).toThrow();
    }
  });

  it('formats base units for display', () => {
    expect(toDisplayAmount(25_000_000n, 6)).toBe('25');
    expect(toDisplayAmount(24_750_000n, 6)).toBe('24.75');
    expect(toDisplayAmount(1n, 6)).toBe('0');
    expect(toDisplayAmount(1_234_567n, 6, 4)).toBe('1.2345');
  });

  it('parses display amounts to base units', () => {
    expect(fromDisplayAmount('25', 6)).toBe(25_000_000n);
    expect(fromDisplayAmount('24.75', 6)).toBe(24_750_000n);
    expect(fromDisplayAmount('0.000001', 6)).toBe(1n);
    expect(() => fromDisplayAmount('0.0000001', 6)).toThrow();
  });

  it('calculates the fee with floor rounding (SRS SC-1)', () => {
    expect(calculateFee(25_000_000n, 100)).toBe(250_000n);
    expect(calculateFee(24_750_000n, 100)).toBe(247_500n);
    expect(calculateFee(1n, 100)).toBe(0n);
    expect(calculateNet(25_000_000n, 100)).toBe(24_750_000n);
  });

  it('caps the fee at the amount and rejects invalid bps', () => {
    expect(calculateFee(1n, 500)).toBe(0n);
    expect(() => calculateFee(100n, 501)).toThrow();
    expect(() => calculateFee(100n, -1)).toThrow();
    expect(() => calculateFee(100n, 1.5)).toThrow();
  });
});
