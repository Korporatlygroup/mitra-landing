import { describe, expect, it } from 'vitest';
import { calculateQuote, type QuoteCalculationInput } from '@/server/services/quote-calculation';

const input: QuoteCalculationInput = {
  currency: 'MYR',
  lines: [{ description: 'Custom uniforms', quantity: '2.500', unit: 'pieces', unitPrice: '3.33' }],
  deliveryFee: '1.25',
  taxAmount: '0.40',
};

describe('Phase 4 quote calculation', () => {
  it('rounds each line half up to cents and sums exact amounts', () => {
    expect(calculateQuote(input)).toMatchObject({ lines: [{ lineTotal: '8.33' }], subtotal: '8.33', total: '9.98' });
  });
  it('rejects malformed, negative, excessive and zero quantities', () => {
    for (const quantity of ['0', '-1', '1.0001', '1e3', '1000000000']) {
      expect(() => calculateQuote({ ...input, lines: [{ ...input.lines[0], quantity }] })).toThrow();
    }
  });
  it('rejects unsupported currency, negative charges and excess lines', () => {
    expect(() => calculateQuote({ ...input, currency: 'USD' as 'MYR' })).toThrow();
    expect(() => calculateQuote({ ...input, taxAmount: '-0.01' })).toThrow();
    expect(() => calculateQuote({ ...input, lines: Array(51).fill(input.lines[0]) })).toThrow();
  });
  it('does not accept browser totals as input', () => {
    const forged = { ...input, total: '0.01' } as QuoteCalculationInput;
    expect(calculateQuote(forged).total).toBe('9.98');
  });
});
