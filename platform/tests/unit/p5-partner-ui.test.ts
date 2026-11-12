import { describe, expect, it } from 'vitest';
import { messagesFor } from '@/i18n/messages';
import { importErrorText, parseRowError, type Tr } from '@/lib/import-errors';
import { clearedBlanks, productEditable, supplierEditable, supplierMissing, validateTiers, type TierRow } from '@/lib/partner-ui';
import { FILE_ERROR_KEYS, ROW_ERROR_KEYS } from '@/server/import/errors';
import { P5_VALIDATOR_KEYS } from '@/lib/errors';

const row = (min: string, max: string, price = '10', variant = ''): TierRow => ({ variant_sku: variant, min_qty: min, max_qty: max, unit_price: price });
const keys = (rows: TierRow[], moq: number | null = null) => validateTiers(rows, moq).map((p) => `${p.row}:${p.key}`);

describe('validateTiers (live price range checks)', () => {
  it('accepts contiguous ascending ranges with an open last range', () => {
    expect(keys([row('100', '499'), row('500', '')], 100)).toEqual([]);
  });
  it('finds gaps, overlaps, order and a closed last range', () => {
    expect(keys([row('100', '499'), row('600', '')])).toEqual(['1:tier_gap']);
    expect(keys([row('100', '499'), row('400', '')])).toEqual(['1:tier_overlap']);
    expect(keys([row('100', '499'), row('50', '')])).toEqual(['1:tier_not_ascending']);
    expect(keys([row('100', '499'), row('500', '900')])).toEqual(['1:tier_last_not_open']);
  });
  it('first range must start at or below the minimum order', () => {
    expect(keys([row('200', '')], 100)).toEqual(['0:tier_does_not_cover_moq']);
  });
  it('checks quantities and money format', () => {
    expect(keys([row('0', '')])).toEqual(['0:invalid_tier_qty']);
    expect(keys([row('1', '', '1.234')])).toEqual(['0:invalid_price']);
    expect(keys([row('1', '', '1,100')])).toEqual(['0:invalid_price']);
  });
  it('checks each option separately', () => {
    expect(keys([row('1', '9', '5', 'A'), row('10', '', '4', 'A'), row('1', '', '6', 'B')])).toEqual([]);
  });
});

describe('status rules', () => {
  it('supplier editing', () => {
    expect(supplierEditable('draft', false)).toBe(true);
    expect(supplierEditable('awaiting_review', true)).toBe(false);
    expect(supplierEditable('approved', false)).toBe(true);
    expect(supplierEditable('approved', true)).toBe(false);
    expect(supplierEditable('suspended', false)).toBe(false);
  });
  it('product editing', () => {
    expect(productEditable('draft')).toBe(true);
    expect(productEditable('submitted')).toBe(false);
    expect(productEditable('suspended')).toBe(false);
    expect(productEditable('published', 'submitted')).toBe(false);
    expect(productEditable('published', null)).toBe(true);
  });
  it('lists what a supplier still lacks', () => {
    expect(supplierMissing({ draft: {}, private: null, documents: [] })).toEqual(['name', 'country', 'category', 'description', 'contact', 'document']);
    expect(
      supplierMissing({
        draft: { name: 'Kumar', country: 'India', main_category: 'packaging', description: 'x'.repeat(25) },
        private: { contact_name: 'R', contact_email: 'r@example.test', contact_phone: null, registration_id: null, website: null, updated_at: '' },
        documents: [{ id: '1', doc_type: 'other', display_name: 'a', mime_type: 'application/pdf', size_bytes: 1, scan_status: 'clean', locked: false, created_at: '' }],
      }),
    ).toEqual([]);
  });
});

describe('clearedBlanks', () => {
  it('lets a blank field remove a stored value and drops fields that do not apply', () => {
    const out = clearedBlanks({ packaging: '', price_mode: 'tiers', unit_price: '' }, { unit_price: undefined });
    expect(out.packaging).toBe('');
    expect(out.unit_price).toBe('');
    expect(out.tiers).toBeUndefined();
    expect(clearedBlanks({ price_mode: 'fixed' }, {}).tiers).toBe('');
  });
});

describe('import error keys', () => {
  const messages = (loc: 'en' | 'ta' | 'ms') => (messagesFor(loc) as { p5partner: { import: { errors: Record<string, string>; fileErrors: Record<string, string> } }; errors: Record<string, string> }).p5partner.import;
  const top = (loc: 'en' | 'ta' | 'ms') => (messagesFor(loc) as { errors: Record<string, string> }).errors;
  it('parses both stored shapes', () => {
    expect(parseRowError('price:decimal_invalid')).toEqual({ key: 'decimal_invalid', field: 'price', index: null });
    expect(parseRowError('invalid_price:tiers[1]')).toEqual({ key: 'invalid_price', field: 'tiers[1]', index: null });
    expect(parseRowError('invalid_tier:2')).toEqual({ key: 'invalid_tier', field: null, index: 2 });
    expect(parseRowError('sku_exists')).toEqual({ key: 'sku_exists', field: null, index: null });
  });
  for (const loc of ['en', 'ta', 'ms'] as const) {
    it(`${loc}: every engine row key, file key and database key has a message`, () => {
      const m = messages(loc);
      for (const k of ROW_ERROR_KEYS) expect(m.errors[k], `import.errors.${k}`).toBeTruthy();
      for (const k of [...FILE_ERROR_KEYS, 'orphan_rows']) expect(m.fileErrors[k], `fileErrors.${k}`).toBeTruthy();
      for (const k of P5_VALIDATOR_KEYS) expect(m.errors[k] ?? top(loc)[k], `errors.${k}`).toBeTruthy();
    });
  }
  it('importErrorText resolves keys with a field label and never shows a code', () => {
    const m = messages('en') as unknown as { errors: Record<string, string> };
    const t = Object.assign((k: string, v?: Record<string, string | number>) => (k === 'rowPart' ? `item ${v?.n}` : k.startsWith('errors.') ? m.errors[k.slice(7)]! : k), { has: (k: string) => k.startsWith('errors.') && k.slice(7) in m.errors }) as unknown as Tr;
    const te = Object.assign((k: string) => top('en')[k]!, { has: (k: string) => k in top('en') }) as unknown as Tr;
    expect(importErrorText(t, te, 'price:decimal_invalid')).toContain('plain number');
    expect(importErrorText(t, te, 'sku_exists')).toBe(top('en').sku_exists);
    expect(importErrorText(t, te, 'something_new')).toBe(m.errors.unknown);
  });
});
