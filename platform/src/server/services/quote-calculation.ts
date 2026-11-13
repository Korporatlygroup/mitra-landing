/** Provisional Phase 4 domain calculation. No database or Phase 3 schema dependency. */
export type QuoteLineInput = {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

export type QuoteCalculationInput = {
  currency: 'MYR';
  lines: QuoteLineInput[];
  deliveryFee: string;
  taxAmount: string;
};

export type QuoteCalculation = {
  currency: 'MYR';
  lines: Array<QuoteLineInput & { lineTotal: string }>;
  subtotal: string;
  deliveryFee: string;
  taxAmount: string;
  total: string;
};

const MAX_TOTAL_CENTS = 100_000_000_000_000n;

function decimal(value: string, places: number, maxWholeDigits: number, positive: boolean): bigint {
  if (typeof value !== 'string' || !new RegExp(`^\\d{1,${maxWholeDigits}}(?:\\.\\d{1,${places}})?$`).test(value)) {
    throw new Error('invalid_amount');
  }
  const [whole, fraction = ''] = value.split('.');
  const scaled = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'));
  if (positive && scaled === 0n) throw new Error('invalid_quantity');
  return scaled;
}

function money(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/** All values are strings; binary floating point never participates in the result. */
export function calculateQuote(input: QuoteCalculationInput): QuoteCalculation {
  if (input.currency !== 'MYR' || !Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50) {
    throw new Error('invalid_quote');
  }
  let subtotal = 0n;
  const lines = input.lines.map((line) => {
    if (!line.description.trim() || line.description.length > 500 || !line.unit.trim() || line.unit.length > 40) {
      throw new Error('invalid_line');
    }
    const quantityMillis = decimal(line.quantity, 3, 9, true);
    const unitPriceCents = decimal(line.unitPrice, 2, 10, false);
    // Half up to the nearest cent for each line, then sum displayed line totals.
    const lineCents = (quantityMillis * unitPriceCents + 500n) / 1000n;
    subtotal += lineCents;
    if (subtotal > MAX_TOTAL_CENTS) throw new Error('amount_too_large');
    return { ...line, lineTotal: money(lineCents) };
  });
  const delivery = decimal(input.deliveryFee, 2, 10, false);
  const tax = decimal(input.taxAmount, 2, 10, false);
  const total = subtotal + delivery + tax;
  if (total > MAX_TOTAL_CENTS) throw new Error('amount_too_large');
  return { currency: 'MYR', lines, subtotal: money(subtotal), deliveryFee: money(delivery), taxAmount: money(tax), total: money(total) };
}
