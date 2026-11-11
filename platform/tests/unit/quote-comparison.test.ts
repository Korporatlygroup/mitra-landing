import { describe, expect, it } from 'vitest';
import { compareQuotes, type QuoteSummary } from '@/server/services/quote-comparison';

const now = new Date('2026-11-10T00:00:00Z');
const a: QuoteSummary = { id: 'a', sellerName: 'Seller A', currency: 'MYR', total: '100.00', scope: '100 uniforms', unit: 'piece', quantity: '100', validUntil: '2026-11-20T00:00:00Z', status: 'sent' };
const b: QuoteSummary = { ...a, id: 'b', sellerName: 'Seller B', total: '105.00' };

describe('quote comparison', () => {
  it('permits like-for-like offers without ranking them', () => {
    expect(compareQuotes([b, a], now)).toEqual({ quotes: [b, a], comparable: true, reasons: [] });
  });
  it('calls out different currency, units, scope and expiry', () => {
    expect(compareQuotes([a, { ...b, currency: 'INR', unit: 'box', scope: '50 shirts', validUntil: '2026-11-01T00:00:00Z' }], now).reasons)
      .toEqual(['currency', 'unit', 'scope', 'expired_or_inactive']);
  });
  it('rejects an invalid comparison set', () => {
    expect(() => compareQuotes([a], now)).toThrow();
  });
  it('checks every displayed offer, including the fifth', () => {
    expect(compareQuotes([a,b,{...b,id:'c'},{...b,id:'d'},{...b,id:'e',unit:'box'}],now).reasons).toContain('unit');
  });
});
