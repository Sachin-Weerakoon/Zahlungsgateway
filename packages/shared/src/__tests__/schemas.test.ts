import { describe, expect, it } from 'vitest';
import { createInvoiceSchema, formatZodIssues, listInvoicesQuerySchema } from '../schemas.js';

const TOKEN = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const ADDRESS = '0x0000000000000000000000000000000000000001';

describe('createInvoiceSchema', () => {
  it('accepts a minimal valid payload and applies the default expiry', () => {
    const parsed = createInvoiceSchema.parse({ amount: '25000000', tokenAddress: TOKEN });
    expect(parsed.expiresInMinutes).toBe(30);
  });

  it('rejects zero, negative and decimal amounts', () => {
    for (const amount of ['0', '-1', '1.5']) {
      const result = createInvoiceSchema.safeParse({ amount, tokenAddress: TOKEN });
      expect(result.success).toBe(false);
    }
  });

  it('rejects malformed token addresses', () => {
    const result = createInvoiceSchema.safeParse({ amount: '1', tokenAddress: '0x123' });
    expect(result.success).toBe(false);
  });

  it('enforces expiry bounds', () => {
    expect(
      createInvoiceSchema.safeParse({ amount: '1', tokenAddress: TOKEN, expiresInMinutes: 4 })
        .success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({ amount: '1', tokenAddress: TOKEN, expiresInMinutes: 10_081 })
        .success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({ amount: '1', tokenAddress: TOKEN, expiresInMinutes: 5 })
        .success,
    ).toBe(true);
  });

  it('rejects metadata above 1 KB', () => {
    const result = createInvoiceSchema.safeParse({
      amount: '1',
      tokenAddress: TOKEN,
      metadata: { note: 'x'.repeat(1_100) },
    });
    expect(result.success).toBe(false);
  });

  it('returns readable issue paths', () => {
    const result = createInvoiceSchema.safeParse({ amount: '0', tokenAddress: ADDRESS });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = formatZodIssues(result.error);
      expect(issues[0]?.path).toBe('amount');
    }
  });
});

describe('listInvoicesQuerySchema', () => {
  it('defaults the page size to 25 and coerces the limit', () => {
    expect(listInvoicesQuerySchema.parse({}).limit).toBe(25);
    expect(listInvoicesQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('rejects page sizes above 100', () => {
    expect(listInvoicesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
