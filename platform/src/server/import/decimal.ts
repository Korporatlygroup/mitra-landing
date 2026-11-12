import type { RowErrorKey } from './errors';

/**
 * Strict decimal parsing with no floating point. Values are held as BigInt "scaled integers"
 * (value * 10^scale) so money and quantities can be compared and sorted exactly.
 *
 * Accepted:  250   250.5   0.75   1,250.50   1,250,000   1,25,000.50   (comma only as a thousands separator)
 * Rejected:  1.2.3  abc  1e3  .5  5.  +5  "1 250"  (decimal_invalid)
 *            1,50  1,250  1.250,50  (decimal_ambiguous: could be a European decimal comma)
 *            -5 (decimal_negative)
 */
export interface DecimalOk {
  ok: true;
  /** value * 10^scale */
  scaled: bigint;
  scale: number;
  /** canonical plain string, e.g. "1250.50" (fixed scale) or "2.5" */
  text: string;
}
export interface DecimalErr {
  ok: false;
  key: RowErrorKey;
  params?: Record<string, number>;
}
export type DecimalResult = DecimalOk | DecimalErr;

const PLAIN = /^\d+(\.\d+)?$/;
const GROUPED_DOT = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const INDIAN = /^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/; // 1,25,000.50 (lakh grouping, always 2+ commas)
const GROUPED_MANY = /^\d{1,3}(,\d{3}){2,}$/;
const COMMA_DECIMAL = /^\d+,\d+$/;
const EUROPEAN = /^\d{1,3}(\.\d{3})+,\d+$/;

export function parseDecimal(raw: string, opts: { maxScale: number; maxIntDigits: number; fixedScale?: boolean }): DecimalResult {
  const s = raw.trim();
  if (s === '') return { ok: false, key: 'required' };
  if (s.startsWith('-')) {
    const rest = s.slice(1);
    return PLAIN.test(rest) || GROUPED_DOT.test(rest) || INDIAN.test(rest) ? { ok: false, key: 'decimal_negative' } : { ok: false, key: 'decimal_invalid' };
  }
  let body: string;
  if (PLAIN.test(s)) {
    body = s;
  } else if (GROUPED_DOT.test(s)) {
    // "1,250" (one group, no dot) is ambiguous; a dot after the groups, or 2+ groups, is not
    if (!s.includes('.') && !GROUPED_MANY.test(s)) return { ok: false, key: 'decimal_ambiguous' };
    body = s.replaceAll(',', '');
  } else if (INDIAN.test(s)) {
    body = s.replaceAll(',', '');
  } else if (COMMA_DECIMAL.test(s) || EUROPEAN.test(s)) {
    return { ok: false, key: 'decimal_ambiguous' };
  } else {
    return { ok: false, key: 'decimal_invalid' };
  }
  const [intPartRaw, fracRaw = ''] = body.split('.');
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '');
  const extra = fracRaw.slice(opts.maxScale);
  if (/[^0]/.test(extra)) return { ok: false, key: 'decimal_too_many_places', params: { max: opts.maxScale } };
  if (intPart.length > opts.maxIntDigits) return { ok: false, key: 'decimal_too_large', params: { max: opts.maxIntDigits } };
  const frac = fracRaw.slice(0, opts.maxScale).padEnd(opts.maxScale, '0');
  const scaled = BigInt(intPart + frac);
  return { ok: true, scaled, scale: opts.maxScale, text: formatScaled(scaled, opts.maxScale, opts.fixedScale ?? false) };
}

export function formatScaled(scaled: bigint, scale: number, fixed: boolean): string {
  const digits = scaled.toString().padStart(scale + 1, '0');
  const intPart = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  let frac = scale === 0 ? '' : digits.slice(digits.length - scale);
  if (!fixed) frac = frac.replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart;
}

/**
 * Normalise a spreadsheet numeric cell's raw XML text (e.g. "1250.5", "1.25E+3", "19.989999999999998")
 * into a plain decimal string. Uses 15 significant digits (Excel's own precision). This is text
 * normalisation only; no money arithmetic is ever done on floats.
 */
export function numericCellToText(v: string): string {
  const t = v.trim();
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return t;
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = String(Number(n.toPrecision(15)));
  if (!/e/i.test(s)) return s;
  const [m, e] = s.toLowerCase().split('e');
  const exp = Number(e);
  const neg = m.startsWith('-');
  const [i, f = ''] = m.replace('-', '').split('.');
  const digits = i + f;
  const point = i.length + exp;
  let out: string;
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return (neg ? '-' : '') + out;
}
