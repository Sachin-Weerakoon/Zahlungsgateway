import { BPS_DENOMINATOR, MAX_FEE_BPS } from './constants.js';

/** Base-unit amounts are always unsigned integers encoded as decimal strings. */
export type BaseUnitString = string;

const BASE_UNITS_PATTERN = /^(0|[1-9][0-9]*)$/;

export class MoneyParseError extends Error {
  constructor(value: string) {
    super(`Invalid base-unit amount: "${value}"`);
    this.name = 'MoneyParseError';
  }
}

/** Parse a decimal base-unit string into a bigint. Rejects signs, decimals and whitespace. */
export function parseBaseUnits(value: string): bigint {
  if (!BASE_UNITS_PATTERN.test(value)) {
    throw new MoneyParseError(value);
  }
  return BigInt(value);
}

/** Serialise a bigint amount as a decimal base-unit string. */
export function formatBaseUnits(value: bigint): BaseUnitString {
  if (value < 0n) throw new MoneyParseError(value.toString());
  return value.toString(10);
}

/**
 * Format base units for display, e.g. 25_000_000n with 6 decimals -> "25.00".
 * Never use this for storage or comparisons.
 */
export function toDisplayAmount(value: bigint, decimals: number, displayDecimals = 2): string {
  if (decimals < 0 || !Number.isInteger(decimals)) throw new RangeError('Invalid decimals');
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  let fractionText = fraction.toString().padStart(decimals, '0');
  if (displayDecimals < fractionText.length) {
    fractionText = fractionText.slice(0, displayDecimals);
  }
  const trimmed = fractionText.replace(/0+$/, '');
  const result = trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
  return negative ? `-${result}` : result;
}

/** Parse a human decimal amount (e.g. "25.5") into base units. */
export function fromDisplayAmount(value: string, decimals: number): bigint {
  if (decimals < 0 || !Number.isInteger(decimals)) throw new RangeError('Invalid decimals');
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new MoneyParseError(value);
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new MoneyParseError(value);
  const padded = fraction.padEnd(decimals, '0');
  return BigInt(`${whole}${padded}`);
}

/**
 * Platform fee in base units: floor(amount * feeBps / 10_000) (SRS SC-1).
 * The fee can never exceed the amount.
 */
export function calculateFee(amount: bigint, feeBps: number): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
    throw new RangeError(`feeBps must be an integer between 0 and ${MAX_FEE_BPS}`);
  }
  if (amount < 0n) throw new MoneyParseError(amount.toString());
  const fee = (amount * BigInt(feeBps)) / BPS_DENOMINATOR;
  return fee > amount ? amount : fee;
}

/** Net amount the merchant receives: amount - fee. */
export function calculateNet(amount: bigint, feeBps: number): bigint {
  return amount - calculateFee(amount, feeBps);
}

/** Sum a list of base-unit amounts. */
export function sumAmounts(amounts: readonly bigint[]): bigint {
  return amounts.reduce((total, amount) => total + amount, 0n);
}
