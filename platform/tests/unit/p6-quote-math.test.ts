import { describe, expect, it } from 'vitest';
import { computeWholesaleQuote } from '@/lib/p6-quote-math';

describe('Phase 6 exact wholesale quotation calculations', () => {
  it('sums line totals and explicit charges without currency conversion', () => {
    expect(computeWholesaleQuote([
      { quantity: '100', unitPrice: '12.50', currency: 'INR' },
      { quantity: '2.500', unitPrice: '4.00', currency: 'INR' },
    ], { discount: '10.00', packaging: '5.00', freight: '20.00', other: '1.00' }))
      .toMatchObject({ currency: 'INR', lineTotals: ['1250.00', '10.00'],
        subtotal: '1260.00', total: '1276.00' });
  });

  it('rounds fractional quantities half up as PostgreSQL numeric does', () => {
    expect(computeWholesaleQuote([{ quantity: '0.001', unitPrice: '5.00', currency: 'MYR' }]).lineTotals).toEqual(['0.01']);
    expect(computeWholesaleQuote([{ quantity: '0.001', unitPrice: '4.00', currency: 'MYR' }]).lineTotals).toEqual(['0.00']);
  });

  it('rejects ambiguous inputs, mixed currencies, overflow and excess discount', () => {
    expect(() => computeWholesaleQuote([])).toThrow('invalid_lines');
    expect(() => computeWholesaleQuote([{ quantity: '1,000', unitPrice: '1.00', currency: 'USD' }])).toThrow('invalid_quantity');
    expect(() => computeWholesaleQuote([{ quantity: '1', unitPrice: '1.0', currency: 'USD' }])).toThrow('invalid_money');
    expect(() => computeWholesaleQuote([
      { quantity: '1', unitPrice: '1.00', currency: 'USD' },
      { quantity: '1', unitPrice: '1.00', currency: 'MYR' },
    ])).toThrow('mixed_currencies');
    expect(() => computeWholesaleQuote([{ quantity: '1', unitPrice: '1.00', currency: 'USD' }],
      { discount: '2.00' })).toThrow('discount_exceeds_amount');
    expect(() => computeWholesaleQuote([{ quantity: '101', unitPrice: '999999999999.99', currency: 'USD' }]))
      .toThrow('amount_too_large');
    expect(() => computeWholesaleQuote([{ quantity: '1', unitPrice: '1.00', currency: 'USD' }],
      { packaging: '1000000000000.00' })).toThrow('invalid_money');
  });
});
