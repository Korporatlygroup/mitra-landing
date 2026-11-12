import type { ProductData } from '@/server/services/p5-types';

/**
 * Pure helpers for the admin catalogue screens: the field-level comparison of two product revisions and number formatting.
 * Values are plain strings (numbers and codes); the page translates the field labels and the vocabulary values.
 */

export type DiffField =
  | 'name'
  | 'description'
  | 'category_slug'
  | 'unit'
  | 'moq'
  | 'currency'
  | 'price_mode'
  | 'unit_price'
  | 'tiers'
  | 'variants'
  | 'lead_time_min_days'
  | 'lead_time_max_days'
  | 'availability_status'
  | 'availability_confirmed_on'
  | 'price_confirmed_on'
  | 'specs'
  | 'packaging';

export const DIFF_FIELDS: readonly DiffField[] = [
  'name',
  'description',
  'category_slug',
  'unit',
  'moq',
  'currency',
  'price_mode',
  'unit_price',
  'tiers',
  'variants',
  'lead_time_min_days',
  'lead_time_max_days',
  'availability_status',
  'availability_confirmed_on',
  'price_confirmed_on',
  'specs',
  'packaging',
];

/** Fields whose value is a vocabulary key the page translates. */
export const ENUM_FIELDS: readonly DiffField[] = ['category_slug', 'unit', 'currency', 'price_mode', 'availability_status'];

export interface DiffRow {
  field: DiffField;
  /** Lines of text; empty when the field is not set. */
  before: string[];
  after: string[];
  changed: boolean;
}

const scalar = (v: unknown): string[] => (v === undefined || v === null || v === '' ? [] : [String(v)]);

/** "1-99 @ 12.50", "100+ @ 10.00", with the option code when the tier is for one variant. */
export function tierLine(t: { min_qty: number; max_qty: number | null; unit_price: string | number; variant_sku?: string | null }): string {
  const range = t.max_qty === null || t.max_qty === undefined ? `${t.min_qty}+` : `${t.min_qty}-${t.max_qty}`;
  return `${range} @ ${t.unit_price}${t.variant_sku ? ` [${t.variant_sku}]` : ''}`;
}

export function variantLine(v: { sku: string; label: string; attributes?: Record<string, string>; moq?: number | string }): string {
  const attrs = Object.entries(v.attributes ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, val]) => `${k}: ${val}`)
    .join(', ');
  const moq = v.moq !== undefined && v.moq !== null && v.moq !== '' ? ` / MOQ ${v.moq}` : '';
  return `${v.sku} - ${v.label}${attrs ? ` (${attrs})` : ''}${moq}`;
}

function lines(field: DiffField, d: ProductData | null | undefined): string[] {
  if (!d) return [];
  switch (field) {
    case 'tiers':
      return (d.tiers ?? []).map((t) => tierLine(t));
    case 'variants':
      return (d.variants ?? []).map((v) => variantLine(v));
    case 'specs':
      return Object.entries(d.specs ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}: ${v}`);
    default:
      return scalar((d as Record<string, unknown>)[field]);
  }
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Compares a submitted revision with the one that is live. Pass `before = null` for a first submission: every set field is then
 * reported as changed (added). Fields empty on both sides are left out.
 */
export function diffProductData(before: ProductData | null | undefined, after: ProductData | null | undefined): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const field of DIFF_FIELDS) {
    const b = lines(field, before);
    const a = lines(field, after);
    if (b.length === 0 && a.length === 0) continue;
    rows.push({ field, before: b, after: a, changed: !same(a, b) });
  }
  return rows;
}

export const countChanged = (rows: DiffRow[]) => rows.filter((r) => r.changed).length;

export type DurationUnit = 'minutes' | 'hours' | 'days';

/** Coarse duration for the "median first response" figure: under 1 hour in minutes, under 2 days in hours, otherwise days. */
export function humanDuration(seconds: number): { unit: DurationUnit; value: number } {
  const s = Math.max(0, seconds);
  if (s < 3600) return { unit: 'minutes', value: Math.max(1, Math.round(s / 60)) };
  if (s < 2 * 86400) return { unit: 'hours', value: Math.round(s / 3600) };
  return { unit: 'days', value: Math.round(s / 86400) };
}

/** 0.8333 -> 83. Never rounds a non-zero rate down to 0 or a partial rate up to 100. */
export function percent(rate: number): number {
  const p = Math.round(rate * 100);
  if (rate > 0 && p === 0) return 1;
  if (rate < 1 && p === 100) return 99;
  return p;
}

/** Offsets of the previous and next page for `total` rows shown `size` at a time (null when there is none). */
export function pageLinks(offset: number, total: number, size = 25): { prev: number | null; next: number | null; from: number; to: number } {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + size);
  return { prev: offset > 0 ? Math.max(0, offset - size) : null, next: offset + size < total ? offset + size : null, from, to };
}

/** `?offset=` search parameter to a safe non-negative integer. */
export function parseOffset(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{1,5}$/.test(s) ? Number(s) : 0;
}
