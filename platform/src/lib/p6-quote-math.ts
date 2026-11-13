/** Exact, nonnegative wholesale quote arithmetic. SQL will recompute every value before persistence. */

export type WholesaleCurrency = 'INR' | 'MYR' | 'USD';
export interface WholesaleLine {
  quantity: string; // up to three decimal places
  unitPrice: string; // exactly two decimal places
  currency: WholesaleCurrency;
}
export interface WholesaleCharges {
  discount?: string;
  packaging?: string;
  freight?: string;
  other?: string;
}
export interface WholesaleTotal {
  currency: WholesaleCurrency;
  lineTotals: string[];
  subtotal: string;
  discount: string;
  packaging: string;
  freight: string;
  other: string;
  total: string;
}

const MAX_CENTS = 9_999_999_999_999_999n; // numeric(16,2), matching persisted quotations

function moneyCents(value: string): bigint {
  const m = /^(0|[1-9]\d{0,11})\.(\d{2})$/.exec(value);
  if (!m) throw new Error('invalid_money');
  const cents = BigInt(m[1]!) * 100n + BigInt(m[2]!);
  if (cents > MAX_CENTS) throw new Error('amount_too_large');
  return cents;
}

function quantityMilli(value: string): bigint {
  const m = /^(0|[1-9]\d{0,10})(?:\.(\d{1,3}))?$/.exec(value);
  if (!m) throw new Error('invalid_quantity');
  const milli = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
  if (milli <= 0n) throw new Error('invalid_quantity');
  return milli;
}

function checked(cents: bigint): bigint {
  if (cents < 0n) throw new Error('discount_exceeds_amount');
  if (cents > MAX_CENTS) throw new Error('amount_too_large');
  return cents;
}

function formatted(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function computeWholesaleQuote(lines: WholesaleLine[], charges: WholesaleCharges = {}): WholesaleTotal {
  if (lines.length < 1 || lines.length > 20) throw new Error('invalid_lines');
  const currency = lines[0]!.currency;
  if (!['INR', 'MYR', 'USD'].includes(currency)) throw new Error('invalid_currency');
  const totals = lines.map((line) => {
    if (line.currency !== currency) throw new Error('mixed_currencies');
    const product = quantityMilli(line.quantity) * moneyCents(line.unitPrice);
    return checked((product + 500n) / 1000n); // PostgreSQL numeric ROUND for nonnegative values
  });
  const subtotal = checked(totals.reduce((sum, cents) => sum + cents, 0n));
  const discount = moneyCents(charges.discount ?? '0.00');
  const packaging = moneyCents(charges.packaging ?? '0.00');
  const freight = moneyCents(charges.freight ?? '0.00');
  const other = moneyCents(charges.other ?? '0.00');
  const total = checked(checked(subtotal - discount) + packaging + freight + other);
  return {
    currency, lineTotals: totals.map(formatted), subtotal: formatted(subtotal),
    discount: formatted(discount), packaging: formatted(packaging),
    freight: formatted(freight), other: formatted(other), total: formatted(total),
  };
}
