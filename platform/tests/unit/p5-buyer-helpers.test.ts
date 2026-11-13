import { describe, expect, it } from 'vitest';
import {
  buildCompareModel,
  compareHref,
  effectiveMoq,
  groupTiers,
  hasActiveFilters,
  pageCount,
  parseCompareIds,
  parseSearchFilters,
  priceText,
  searchQueryString,
  specKeys,
  specValue,
  toServiceParams,
  valuesDiffer,
} from '@/components/catalogue/helpers';
import { parseEntries } from '@/components/catalogue/compare-store';
import { messagesFor } from '@/i18n/messages';
import type { CatalogueItemDetail, CatalogueTier } from '@/server/services/p5-types';
import { flatten } from './helpers';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U4 = '44444444-4444-4444-8444-444444444444';
const U5 = '55555555-5555-4555-8555-555555555555';

function item(over: Partial<CatalogueItemDetail> = {}): CatalogueItemDetail {
  return {
    id: U1, sku: 'A-1', name: 'Saree', category_slug: 'textiles-apparel', unit: 'piece', moq: 10, currency: 'INR', price_mode: 'tiers', from_price: '450.00',
    price_confirmed_on: '2026-10-01', lead_time_min_days: 10, lead_time_max_days: 20, availability_status: 'available', availability_confirmed_on: '2026-10-01',
    availability_outdated: false, published_at: '2026-10-02T00:00:00Z', summary: null, image_id: null,
    supplier: { id: 's1', name: 'Chennai Textiles', country: 'India', state_city: 'Chennai', reviewed: null },
    description: null, specs: {}, packaging: null, variants: [], tiers: [], media: [], supplier_detail: { description: null, capabilities: null, main_category: null },
    ...over,
  };
}

describe('search query string', () => {
  it('parses tolerantly: bad values are dropped', () => {
    const f = parseSearchFilters({ q: '  silk  ', category: 'nope', supplier: 'not-a-uuid', currency: 'EUR', moq_max: 'abc', page: '-4' });
    expect(f).toMatchObject({ q: 'silk', category: undefined, supplier: undefined, currency: undefined, moqMax: undefined, page: 1, priceNeedsCurrency: false });
  });

  it('canonicalises prices and keeps the currency', () => {
    const f = parseSearchFilters({ currency: 'INR', price_min: '250', price_max: '1,250.50', moq_max: '100', page: '3' });
    expect(f).toMatchObject({ currency: 'INR', priceMin: '250.00', priceMax: '1250.50', moqMax: 100, page: 3, priceNeedsCurrency: false });
  });

  it('drops a price filter without a currency and says so', () => {
    const f = parseSearchFilters({ price_min: '10' });
    expect(f.priceMin).toBeUndefined();
    expect(f.priceNeedsCurrency).toBe(true);
  });

  it('takes the first value of a repeated key', () => {
    expect(parseSearchFilters({ q: ['a', 'b'] }).q).toBe('a');
  });

  it('builds a stable query string and leaves empty values out', () => {
    const f = parseSearchFilters({ q: 'silk saree', category: 'textiles-apparel', page: '2' });
    expect(searchQueryString(f)).toBe('?q=silk+saree&category=textiles-apparel&page=2');
    expect(searchQueryString(f, { page: 1 })).toBe('?q=silk+saree&category=textiles-apparel');
    expect(searchQueryString({})).toBe('');
    expect(searchQueryString(f, { q: undefined, category: undefined, page: 1 })).toBe('');
  });

  it('round-trips through the parser', () => {
    const f = parseSearchFilters({ q: 'a&b=c', currency: 'MYR', price_min: '1.5', moq_max: '20', supplier: U1 });
    const again = parseSearchFilters(Object.fromEntries(new URLSearchParams(searchQueryString(f))));
    expect(again).toMatchObject({ q: 'a&b=c', currency: 'MYR', priceMin: '1.50', moqMax: 20, supplier: U1 });
  });

  it('turns the page into a stable offset and counts pages', () => {
    const f = parseSearchFilters({ page: '3', q: 'x' });
    expect(toServiceParams(f, 20)).toMatchObject({ offset: 40, limit: 20, q: 'x', category: null, currency: null });
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
    expect(hasActiveFilters(parseSearchFilters({}))).toBe(false);
    expect(hasActiveFilters(parseSearchFilters({ q: 'x' }))).toBe(true);
  });
});

describe('compare selection', () => {
  it('keeps valid distinct ids, in order, at most four', () => {
    expect(parseCompareIds(`${U1},${U2},bad,${U1},${U3},${U4},${U5}`)).toEqual([U1, U2, U3, U4]);
    expect(parseCompareIds(undefined)).toEqual([]);
    expect(parseCompareIds([U2, U1])).toEqual([U2, U1]);
  });
  it('builds the link', () => {
    expect(compareHref([U1, U2])).toBe(`/catalogue/compare?ids=${U1},${U2}`);
  });
  it('reads the stored selection defensively', () => {
    expect(parseEntries('not json')).toEqual([]);
    expect(parseEntries('{}')).toEqual([]);
    expect(parseEntries(JSON.stringify([{ id: U1, name: 'A' }, { id: U1, name: 'dup' }, { id: 'x', name: 'bad' }, { id: U2, name: 5 }]))).toEqual([
      { id: U1, name: 'A' },
      { id: U2, name: '5' },
    ]);
  });
});

describe('comparison model', () => {
  it('treats missing values as a difference of their own', () => {
    expect(valuesDiffer(['a', 'a'])).toBe(false);
    expect(valuesDiffer(['a', null])).toBe(true);
    expect(valuesDiffer([null, ''])).toBe(false);
    expect(valuesDiffer([' a ', 'a'])).toBe(false);
  });

  it('lists specification names given by at least one product', () => {
    const a = item({ specs: { Fabric: 'Cotton', Length: '6 m', Empty: '  ' } });
    const b = item({ id: U2, specs: { Fabric: 'Silk', Colour: 'Red' } });
    expect(specKeys([a, b])).toEqual(['Colour', 'Fabric', 'Length']);
    expect(specValue(a, 'Colour')).toBeNull();
    expect(specValue(a, 'Empty')).toBeNull();
    expect(specValue(b, 'Fabric')).toBe('Silk');
  });

  it('flags mixed currencies without converting anything', () => {
    const m = buildCompareModel([item(), item({ id: U2, currency: 'USD', from_price: '5.00' })]);
    expect(m.mixedCurrencies).toBe(true);
    expect(m.currencies).toEqual(['INR', 'USD']);
    expect(m.differs.currency).toBe(true);
    const same = buildCompareModel([item(), item({ id: U2 })]);
    expect(same.mixedCurrencies).toBe(false);
    expect(same.differs.moq).toBe(false);
    expect(same.differs.supplier).toBe(false);
  });

  it('flags differing MOQ, lead time and availability', () => {
    const m = buildCompareModel([item(), item({ id: U2, moq: 50, lead_time_max_days: null, availability_confirmed_on: '2026-09-01' })]);
    expect(m.differs).toMatchObject({ moq: true, leadTime: true, availability: true });
  });

  it('groups tiers by option and orders them by minimum quantity', () => {
    const t = (variant: string | null, min: number, max: number | null, price: string): CatalogueTier => ({ variant_sku: variant, min_qty: min, max_qty: max, unit_price: price, currency: 'INR' });
    const g = groupTiers([t('RED', 50, null, '9.00'), t(null, 100, null, '4.00'), t(null, 10, 99, '5.00'), t('RED', 10, 49, '10.00')], [{ sku: 'RED', label: 'Red' }]);
    expect(g.map((x) => x.variantSku)).toEqual([null, 'RED']);
    expect(g[0]!.tiers.map((x) => x.min_qty)).toEqual([10, 100]);
    expect(g[1]).toMatchObject({ variantLabel: 'Red' });
    expect(g[1]!.tiers.map((x) => x.unit_price)).toEqual(['10.00', '9.00']);
  });
});

describe('request quantity and price text', () => {
  it('uses the option minimum when it has one', () => {
    const base = { moq: 10, variants: [{ id: 'v1', sku: 'RED', label: 'Red', attributes: {}, moq: 25 }, { id: 'v2', sku: 'BLUE', label: 'Blue', attributes: {}, moq: null }] };
    expect(effectiveMoq(base, null)).toBe(10);
    expect(effectiveMoq(base, 'RED')).toBe(25);
    expect(effectiveMoq(base, 'BLUE')).toBe(10);
    expect(effectiveMoq(base, 'GONE')).toBe(10);
  });

  it('shows the currency code with the stored digits, no conversion', () => {
    expect(priceText('450.00', 'INR', 'en')).toBe('INR 450.00');
    expect(priceText(1250.5, 'MYR', 'en')).toBe('MYR 1,250.50');
    expect(priceText('0.5', 'USD', 'ms')).toBe('USD 0.50');
  });
});

describe('p5buyer messages', () => {
  const en = flatten(messagesFor('en')['p5buyer'] as Record<string, unknown>);
  const ta = flatten(messagesFor('ta')['p5buyer'] as Record<string, unknown>);
  const ms = flatten(messagesFor('ms')['p5buyer'] as Record<string, unknown>);
  it('has the same keys and placeholders in all three languages', () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: unknown) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) {
      expect(ph(ta[k]), k).toEqual(ph(en[k]));
      expect(ph(ms[k]), k).toEqual(ph(en[k]));
    }
  });
  it('never calls a supplier trusted, guaranteed or verified', () => {
    for (const v of Object.values(en)) expect(String(v).toLowerCase()).not.toMatch(/trusted|guarantee|verified|in stock/);
  });
});
