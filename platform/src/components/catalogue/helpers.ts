import { catalogueSearchSchema, uuidSchema } from '@/lib/schemas';
import type { CatalogueItemDetail, CatalogueSearchParams, CatalogueTier, CatalogueVariant, Currency } from '@/server/services/p5-types';

/**
 * Pure helpers for the buyer catalogue: query-string handling and the comparison model. No React, no I/O (unit tested).
 * Money stays a decimal string everywhere; nothing here adds, multiplies or converts prices.
 */

/** Same value as `MAX_COMPARE` in the service layer (kept here so client components do not import server code). */
export const COMPARE_LIMIT = 4;

// ---------------------------------------------------------------------------------------------- search query string

export interface SearchFilters {
  q?: string;
  category?: string;
  supplier?: string;
  currency?: Currency;
  priceMin?: string;
  priceMax?: string;
  moqMax?: number;
  page: number;
  /** A price was typed without a currency: the price filter is dropped and the form says so. */
  priceNeedsCurrency: boolean;
}

type FilterFields = Partial<Omit<SearchFilters, 'priceNeedsCurrency'>>;
type Raw = Record<string, string | string[] | undefined>;

/** Tolerant parse of the URL: bad values are dropped, never an error page. First value wins for repeated keys. */
export function parseSearchFilters(raw: Raw): SearchFilters {
  const one: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) one[k] = Array.isArray(v) ? v[0] : v;
  const p = catalogueSearchSchema.parse(one);
  const needs = Boolean((p.price_min || p.price_max) && !p.currency);
  return {
    q: p.q || undefined,
    category: p.category,
    supplier: p.supplier,
    currency: p.currency,
    priceMin: needs ? undefined : p.price_min,
    priceMax: needs ? undefined : p.price_max,
    moqMax: p.moq_max,
    page: p.page,
    priceNeedsCurrency: needs,
  };
}

/** Query string ("?a=b&c=d" or "") for a filter set, with optional overrides. Stable key order; empty values are left out. */
export function searchQueryString(f: FilterFields, override: FilterFields = {}): string {
  const m = { ...f, ...override };
  const sp = new URLSearchParams();
  if (m.q) sp.set('q', m.q);
  if (m.category) sp.set('category', m.category);
  if (m.supplier) sp.set('supplier', m.supplier);
  if (m.currency) sp.set('currency', m.currency);
  if (m.priceMin) sp.set('price_min', m.priceMin);
  if (m.priceMax) sp.set('price_max', m.priceMax);
  if (m.moqMax) sp.set('moq_max', String(m.moqMax));
  if (m.page && m.page > 1) sp.set('page', String(m.page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const hasActiveFilters = (f: SearchFilters) => Boolean(f.q || f.category || f.supplier || f.priceMin || f.priceMax || f.moqMax);

/** The offset-based RPC parameters for a page of results. */
export function toServiceParams(f: SearchFilters, pageSize: number): CatalogueSearchParams {
  return {
    q: f.q ?? null,
    category: f.category ?? null,
    supplier: f.supplier ?? null,
    moqMax: f.moqMax ?? null,
    priceMin: f.priceMin ?? null,
    priceMax: f.priceMax ?? null,
    currency: f.currency ?? null,
    offset: (f.page - 1) * pageSize,
    limit: pageSize,
  };
}

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

// ---------------------------------------------------------------------------------------------- compare selection

/** "a,b,c" (or a repeated key) to at most COMPARE_LIMIT distinct valid ids, in order. */
export function parseCompareIds(raw: string | string[] | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const out: string[] = [];
  for (const part of text.split(',')) {
    const id = part.trim();
    if (id && uuidSchema.safeParse(id).success && !out.includes(id)) out.push(id);
    if (out.length >= COMPARE_LIMIT) break;
  }
  return out;
}

export const compareHref = (ids: string[]) => `/catalogue/compare?ids=${ids.slice(0, COMPARE_LIMIT).join(',')}`;

// ---------------------------------------------------------------------------------------------- compare model

const present = (v: unknown) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

/** True when the values are not all identical, counting "not given" as a value of its own. */
export function valuesDiffer(values: readonly (string | null | undefined)[]): boolean {
  const norm = values.map((v) => (present(v) ? String(v).trim() : null));
  return new Set(norm).size > 1;
}

/** Distinct specification names across the items, sorted; only names at least one item gives a value for. */
export function specKeys(items: readonly Pick<CatalogueItemDetail, 'specs'>[]): string[] {
  const keys = new Set<string>();
  for (const it of items) for (const [k, v] of Object.entries(it.specs ?? {})) if (present(v)) keys.add(k);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

export const specValue = (item: Pick<CatalogueItemDetail, 'specs'>, key: string): string | null => {
  const v = item.specs?.[key];
  return present(v) ? String(v) : null;
};

export interface TierGroup {
  variantSku: string | null;
  variantLabel: string | null;
  tiers: CatalogueTier[];
}

/** Tiers grouped by variant (the product-level group first), each group ordered by minimum quantity. */
export function groupTiers(tiers: readonly CatalogueTier[], variants: readonly Pick<CatalogueVariant, 'sku' | 'label'>[] = []): TierGroup[] {
  const groups = new Map<string | null, CatalogueTier[]>();
  for (const t of tiers) {
    const key = t.variant_sku ?? null;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a.localeCompare(b)));
  return order.map((sku) => ({
    variantSku: sku,
    variantLabel: sku ? (variants.find((v) => v.sku === sku)?.label ?? sku) : null,
    tiers: [...(groups.get(sku) as CatalogueTier[])].sort((a, b) => a.min_qty - b.min_qty),
  }));
}

export interface CompareModel {
  items: CatalogueItemDetail[];
  specKeys: string[];
  currencies: Currency[];
  /** More than one currency in the selection: prices are shown side by side, never converted or ranked. */
  mixedCurrencies: boolean;
  differs: { moq: boolean; leadTime: boolean; availability: boolean; currency: boolean; supplier: boolean; category: boolean; unit: boolean };
}

export function buildCompareModel(items: CatalogueItemDetail[]): CompareModel {
  const currencies = [...new Set(items.map((i) => i.currency))];
  const lt = (i: CatalogueItemDetail) => (i.lead_time_min_days == null && i.lead_time_max_days == null ? null : `${i.lead_time_min_days ?? ''}-${i.lead_time_max_days ?? ''}`);
  return {
    items,
    specKeys: specKeys(items),
    currencies,
    mixedCurrencies: currencies.length > 1,
    differs: {
      moq: valuesDiffer(items.map((i) => (i.moq == null ? null : String(i.moq)))),
      leadTime: valuesDiffer(items.map(lt)),
      availability: valuesDiffer(items.map((i) => `${i.availability_status}|${i.availability_confirmed_on ?? ''}`)),
      currency: currencies.length > 1,
      supplier: valuesDiffer(items.map((i) => i.supplier.id)),
      category: valuesDiffer(items.map((i) => i.category_slug)),
      unit: valuesDiffer(items.map((i) => i.unit)),
    },
  };
}

// ---------------------------------------------------------------------------------------------- request quantity

/** The minimum order for the chosen option: the option's own MOQ when it has one, otherwise the product's. */
export function effectiveMoq(item: Pick<CatalogueItemDetail, 'moq' | 'variants'>, variantSku: string | null | undefined): number {
  const v = variantSku ? item.variants.find((x) => x.sku === variantSku) : undefined;
  return v?.moq != null ? Number(v.moq) : Number(item.moq);
}

/** Display text for money: "INR 450.00". The currency code is always shown; the digits are the stored decimal (no conversion). */
export function priceText(amount: string | number, currency: Currency, locale: string): string {
  const tag = ({ en: 'en-MY', ta: 'ta-MY', ms: 'ms-MY' } as Record<string, string>)[locale] ?? 'en-MY';
  try {
    return `${currency} ${new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(String(amount) as unknown as number)}`;
  } catch {
    return `${currency} ${amount}`;
  }
}
