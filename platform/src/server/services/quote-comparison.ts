/** Comparison rules independent of Phase 3 storage. Never infer a cheapest or best offer. */
export type QuoteSummary = {
  id: string;
  sellerName: string;
  currency: string;
  total: string;
  scope: string;
  unit: string;
  quantity: string;
  validUntil: string;
  status: 'sent' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
};

export type QuoteComparison = {
  quotes: QuoteSummary[];
  comparable: boolean;
  reasons: Array<'currency' | 'unit' | 'quantity' | 'scope' | 'expired_or_inactive'>;
};

export function compareQuotes(quotes: QuoteSummary[], now: Date): QuoteComparison {
  if (quotes.length < 2 || quotes.length > 20 || Number.isNaN(now.getTime())) throw new Error('invalid_comparison');
  const reasons: QuoteComparison['reasons'] = [];
  const first = quotes[0];
  if (quotes.some((q) => q.currency !== first.currency)) reasons.push('currency');
  if (quotes.some((q) => q.unit.trim().toLowerCase() !== first.unit.trim().toLowerCase())) reasons.push('unit');
  if (quotes.some((q) => q.quantity !== first.quantity)) reasons.push('quantity');
  if (quotes.some((q) => q.scope.trim().toLowerCase() !== first.scope.trim().toLowerCase())) reasons.push('scope');
  if (quotes.some((q) => q.status !== 'sent' || !Number.isFinite(Date.parse(q.validUntil)) || Date.parse(q.validUntil) <= now.getTime())) {
    reasons.push('expired_or_inactive');
  }
  return { quotes, comparable: reasons.length === 0, reasons };
}
