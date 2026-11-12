import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS, ImportError, ROW_ERROR_KEYS, importCatalogueFile } from '@/server/import';
import { NOW, SUPPLIER, baseRow, bytes, csvText, issuesFor, runCsv } from './util';

const ch = (n: number) => String.fromCodePoint(n);

describe('baseline', () => {
  it('a fully valid row has no issues and normalised data', () => {
    const r = runCsv([baseRow()]);
    expect(r.rows[0].ok).toBe(true);
    expect(r.rows[0].data).toEqual({
      sku: 'A-001',
      name: 'Cotton kurta (synthetic)',
      description: 'Synthetic cotton kurta for testing only.',
      category_slug: 'textiles-apparel',
      unit: 'piece',
      moq: '100',
      currency: 'INR',
      price_mode: 'fixed',
      unit_price: '250.50',
      lead_time_min_days: '21',
      lead_time_max_days: '21',
      availability_confirmed_on: '2026-06-01',
      specs: { Material: 'cotton', Size: 'M' },
    });
    expect(r.rows[0].requestedStatus).toBe('draft');
    expect(Object.keys(r.rows[0].data)).not.toContain('tiers'); // the SQL treats a present `tiers` key as tier input
  });
});

describe('required values', () => {
  for (const f of ['supplier_code', 'sku', 'name', 'category', 'description', 'unit', 'moq', 'currency', 'specifications', 'lead_time_days', 'availability_date', 'status']) {
    it(`blank ${f} is required`, () => {
      expect(issuesFor({ [f]: '' })).toContain(`${f}:required`);
    });
  }
  it('blank price is price_required when no mode and no tiers', () => {
    expect(issuesFor({ price: '' })).toEqual(['price:price_required']);
  });
});

describe('sku', () => {
  const cases: [string, string[]][] = [
    ['A-1.b_c', []],
    ['A/1', []],
    ['0123', []],
    ['A 1', ['sku:invalid_format']],
    ['_A1', ['sku:invalid_format']],
    ['x'.repeat(40), []],
    ['x'.repeat(41), ['sku:too_long']],
    ['-A1', ['sku:formula_injection']],
    ['=A1', ['sku:formula_injection']],
  ];
  for (const [sku, expected] of cases) it(`${JSON.stringify(sku.slice(0, 12))} -> ${expected.join(',') || 'ok'}`, () => expect(issuesFor({ sku })).toEqual(expected));
});

describe('name and description lengths', () => {
  it('name 2..160 (SQL)', () => {
    expect(issuesFor({ name: 'a' })).toEqual(['name:too_short']);
    expect(issuesFor({ name: 'ab' })).toEqual([]);
    expect(issuesFor({ name: 'n'.repeat(160) })).toEqual([]);
    expect(issuesFor({ name: 'n'.repeat(161) })).toEqual(['name:too_long']);
  });
  it('description up to 2000 (SQL)', () => {
    expect(issuesFor({ description: 'd'.repeat(2000) })).toEqual([]);
    expect(issuesFor({ description: 'd'.repeat(2001) })).toEqual(['description:too_long']);
    expect(issuesFor({ packaging: 'p'.repeat(300) })).toEqual([]);
    expect(issuesFor({ packaging: 'p'.repeat(301) })).toEqual(['packaging:too_long']);
  });
  it('a 5001 character cell refuses the file', () => {
    expect(() => runCsv([baseRow({ description: 'd'.repeat(5001) })])).toThrowError(expect.objectContaining({ key: 'import_cell_too_long' }));
  });
  it('multiline descriptions keep line breaks, collapse the rest', () => {
    const r = runCsv([baseRow({ description: 'Line one is here.\r\n\r\n\r\n\r\n  Line   two   is here.' })]);
    expect(r.rows[0].data.description).toBe('Line one is here.\n\nLine two is here.');
  });
});

describe('category', () => {
  it('accepts every one of the 12 slugs', () => {
    expect(CATEGORY_SLUGS).toHaveLength(12);
    for (const slug of CATEGORY_SLUGS) expect(runCsv([baseRow({ category: slug })]).rows[0].data.category_slug).toBe(slug);
  });
  const labels: [string, string][] = [
    ['Textiles & Apparel', 'textiles-apparel'],
    ['textiles and apparel', 'textiles-apparel'],
    ['  FOOD   groceries ', 'food-groceries'],
    ['Spices & Condiments', 'spices-condiments'],
    ['Jewelry', 'jewellery-accessories'],
    ['Home & Kitchen', 'home-kitchen'],
    ['Religious Items / Puja', 'religious-items-puja'],
    ['religious_items_puja', 'religious-items-puja'],
    ['Cosmetics & Personal Care', 'cosmetics-personal-care'],
    ['Stationery & Books', 'stationery-books'],
    ['Hardware & Tools', 'hardware-tools'],
    ['Electronics', 'electronics-accessories'],
    ['Packaging', 'packaging'],
    ['Other', 'other'],
  ];
  for (const [label, slug] of labels) it(`label ${JSON.stringify(label)} -> ${slug}`, () => expect(runCsv([baseRow({ category: label })]).rows[0].data.category_slug).toBe(slug));
  it('rejects unknown categories', () => expect(issuesFor({ category: 'gadgets' })).toEqual(['category:category_invalid']));
});

describe('unit, currency, status', () => {
  it('unit synonyms normalise', () => {
    for (const [u, e] of [['pcs', 'piece'], ['Kilogram', 'kg'], ['LITER', 'litre'], ['Dozen', 'dozen'], ['packet', 'pack']]) {
      expect(runCsv([baseRow({ unit: u })]).rows[0].data.unit).toBe(e);
    }
    expect(issuesFor({ unit: 'furlong' })).toEqual(['unit:unit_invalid']);
  });
  it('currency is INR, MYR or USD (case-insensitive)', () => {
    expect(runCsv([baseRow({ currency: 'myr' })]).rows[0].data.currency).toBe('MYR');
    expect(issuesFor({ currency: 'USD' })).toEqual([]);
    expect(issuesFor({ currency: 'EUR' })).toEqual(['currency:currency_invalid']);
    expect(issuesFor({ currency: 'RM' })).toEqual(['currency:currency_invalid']);
  });
  it('status is only draft or submit; importing never publishes', () => {
    expect(runCsv([baseRow({ status: 'Submitted' })]).rows[0].requestedStatus).toBe('submit');
    for (const s of ['published', 'publish', 'approved', 'live']) expect(issuesFor({ status: s })).toEqual(['status:status_invalid']);
  });
});

describe('moq', () => {
  const cases: [string, string[]][] = [
    ['1', []],
    ['2.5', []],
    ['0.001', []],
    ['1,000,000', []],
    ['0', ['moq:moq_not_positive']],
    ['0.000', ['moq:moq_not_positive']],
    ['2.5555', ['moq:decimal_too_many_places']],
    ['-1', ['moq:decimal_negative']],
    ['abc', ['moq:decimal_invalid']],
    ['1e3', ['moq:decimal_invalid']],
    ['1,5', ['moq:decimal_ambiguous']],
    ['12345678901', []],
    ['123456789012', ['moq:decimal_too_large']],
  ];
  for (const [v, expected] of cases) it(`moq ${JSON.stringify(v)} -> ${expected.join(',') || 'ok'}`, () => expect(issuesFor({ moq: v })).toEqual(expected));
});

describe('lead time', () => {
  const cases: [string, string[]][] = [
    ['0', []],
    ['365', []],
    ['366', ['lead_time_days:out_of_range']],
    ['-1', ['lead_time_days:integer_invalid']],
    ['7.5', ['lead_time_days:integer_invalid']],
    ['abc', ['lead_time_days:integer_invalid']],
    ['1e2', ['lead_time_days:integer_invalid']],
  ];
  for (const [v, expected] of cases) it(`lead_time_days ${JSON.stringify(v)} -> ${expected.join(',') || 'ok'}`, () => expect(issuesFor({ lead_time_days: v })).toEqual(expected));
});

describe('availability date -> availability_confirmed_on (ISO or dd/mm/yyyy, 2020-01-01 .. today, never future)', () => {
  const cases: [string, string[], string?][] = [
    ['2026-06-01', [], '2026-06-01'],
    ['31/12/2025', [], '2025-12-31'],
    ['1/6/2026', [], '2026-06-01'],
    ['01/06/2026', [], '2026-06-01'],
    ['2026-02-30', ['availability_date:date_invalid']],
    ['31/02/2026', ['availability_date:date_invalid']],
    ['2026/06/01', ['availability_date:date_invalid']],
    ['06-01-2026', ['availability_date:date_invalid']],
    ['soon', ['availability_date:date_invalid']],
    ['2026-07-01', [], '2026-07-01'],
    ['2026-07-02', ['availability_date:date_in_future']],
    ['2099-01-01', ['availability_date:date_in_future']],
    ['2020-01-01', [], '2020-01-01'],
    ['2019-12-31', ['availability_date:date_out_of_range']],
    ['1999-01-01', ['availability_date:date_out_of_range']],
  ];
  for (const [v, expected, iso] of cases) {
    it(`${v} -> ${expected.join(',') || 'ok'}`, () => {
      expect(issuesFor({ availability_date: v })).toEqual(expected);
      if (iso) expect(runCsv([baseRow({ availability_date: v })]).rows[0].data.availability_confirmed_on).toBe(iso);
    });
  }
  it('the out-of-range error carries the window', () => {
    const e = runCsv([baseRow({ availability_date: '1999-01-01' })]).rows[0].errors[0];
    expect(e.params).toEqual({ min: '2020-01-01', max: '2026-07-01' });
  });
});

describe('specifications: key: value; key: value', () => {
  it('parses pairs, trims, allows colons inside values and newline separators', () => {
    const r = runCsv([baseRow({ specifications: ' Ratio : 1:2 ;\nColour: red;; ' })]);
    expect(r.rows[0].errors).toEqual([]);
    expect(r.rows[0].data.specs).toEqual({ Ratio: '1:2', Colour: 'red' });
  });
  const bad: [string, string][] = [
    ['just text', 'specs_invalid'],
    ['key:', 'specs_invalid'],
    [': value', 'specs_invalid'],
    ['A: 1; a: 2', 'specs_duplicate_key'],
    [Array.from({ length: 21 }, (_, i) => `k${i}: v`).join('; '), 'specs_too_many'],
    [`${'k'.repeat(41)}: v`, 'too_long'],
    [`k: ${'v'.repeat(201)}`, 'too_long'],
  ];
  for (const [spec, key] of bad) it(`${spec.slice(0, 20)}... -> ${key}`, () => expect(issuesFor({ specifications: spec })).toEqual([`specifications:${key}`]));
  it('20 pairs is fine', () => expect(issuesFor({ specifications: Array.from({ length: 20 }, (_, i) => `k${i}: v`).join('; ') })).toEqual([]));
});

describe('supplier code', () => {
  it('matches the selected supplier case-insensitively', () => expect(issuesFor({ supplier_code: ' sup-a ' })).toEqual([]));
  it('another supplier code is unknown_supplier (a file can never touch another supplier)', () => {
    expect(issuesFor({ supplier_code: 'SUP-B' })).toEqual(['supplier_code:unknown_supplier']);
  });
  it('the result and the draft never carry the file value (the supplier is an RPC argument)', () => {
    const r = runCsv([baseRow({ supplier_code: 'sup-a' })]);
    expect(r.supplierCode).toBe(SUPPLIER);
    expect(r.rows[0].data).not.toHaveProperty('supplier_code');
  });
});

describe('price modes', () => {
  it('request mode allows a blank price and rejects a price', () => {
    expect(issuesFor({ price_mode: 'request', price: '' })).toEqual([]);
    expect(issuesFor({ price_mode: 'On request', price: '' })).toEqual([]);
    expect(issuesFor({ price_mode: 'request', price: '10' })).toEqual(['price:price_mode_conflict']);
  });
  it('fixed needs a price', () => expect(issuesFor({ price_mode: 'fixed', price: '' })).toEqual(['price:price_required']));
  it('tiers needs tiers', () => expect(issuesFor({ price_mode: 'tiers', price: '' })).toEqual(['price:price_required']));
  it('unknown mode', () => expect(issuesFor({ price_mode: 'barter' })).toContain('price_mode:price_mode_invalid'));
  it('mode is derived: price -> fixed, tiers -> tiers; both is a conflict (SQL: unit_price_not_allowed)', () => {
    expect(runCsv([baseRow()]).rows[0].data.price_mode).toBe('fixed');
    expect(runCsv([baseRow({ price: '', tier1_min: '1', tier1_price: '5' })]).rows[0].data.price_mode).toBe('tiers');
    expect(issuesFor({ tier1_min: '1', tier1_price: '5' })).toEqual(['price:price_mode_conflict']);
    expect(issuesFor({ price_mode: 'tiers', tier1_min: '1', tier1_price: '5' })).toEqual(['price:price_mode_conflict']);
  });
  it('fixed with tiers conflicts', () => expect(issuesFor({ price_mode: 'fixed', tier1_min: '1', tier1_price: '5' })).toEqual(['price_mode:price_mode_conflict']));
});

describe('price tiers (wide columns)', () => {
  const tiers = (over: Record<string, string>) => issuesFor({ price: '', ...over });
  it('valid: ascending, contiguous (next min = previous max + 1), last open-ended', () => {
    const r = runCsv([baseRow({ price: '', tier1_min: '1', tier1_max: '99', tier1_price: '10', tier2_min: '100', tier2_max: '499', tier2_price: '9.50', tier3_min: '500', tier3_price: '9' })]);
    expect(r.rows[0].errors).toEqual([]);
    expect(r.rows[0].data.tiers).toEqual([
      { min_qty: '1', max_qty: '99', unit_price: '10.00' },
      { min_qty: '100', max_qty: '499', unit_price: '9.50' },
      { min_qty: '500', unit_price: '9.00' },
    ]);
    expect(r.rows[0].data).not.toHaveProperty('unit_price');
  });
  it('min must be >= 1 and a whole number', () => {
    expect(tiers({ tier1_min: '0', tier1_price: '5' })).toEqual(['tier1_min:tier_min_invalid']);
    expect(tiers({ tier1_min: '0.5', tier1_price: '5' })).toEqual(['tier1_min:tier_qty_not_integer']);
    expect(tiers({ tier1_min: '1.5', tier1_price: '5' })).toEqual(['tier1_min:tier_qty_not_integer']);
    expect(runCsv([baseRow({ price: '', tier1_min: '2.0', tier1_price: '5' })]).rows[0].data.tiers).toEqual([{ min_qty: '2', unit_price: '5.00' }]);
  });
  it('max must be >= min', () => {
    expect(tiers({ tier1_min: '10', tier1_max: '5', tier1_price: '5' })).toEqual(['tier1_max:tier_range_invalid', 'tier1_max:tier_last_not_open']);
  });
  it('the last tier must be open-ended', () => expect(tiers({ tier1_min: '1', tier1_max: '99', tier1_price: '5' })).toEqual(['tier1_max:tier_last_not_open']));
  it('gaps are refused', () => {
    expect(tiers({ tier1_min: '1', tier1_max: '99', tier1_price: '5', tier2_min: '150', tier2_price: '4' })).toEqual(['tier2_min:tier_gap']);
  });
  it('overlap', () => {
    expect(tiers({ tier1_min: '1', tier1_max: '100', tier1_price: '5', tier2_min: '100', tier2_price: '4' })).toEqual(['tier2_min:tier_overlap']);
  });
  it('not ascending', () => {
    expect(tiers({ tier1_min: '10', tier1_max: '20', tier1_price: '5', tier2_min: '5', tier2_max: '9', tier2_price: '4' })).toEqual(['tier2_min:tier_not_ascending', 'tier2_max:tier_last_not_open']);
  });
  it('only the last tier may be open-ended', () => {
    expect(tiers({ tier1_min: '1', tier1_price: '5', tier2_min: '100', tier2_price: '4' })).toEqual(['tier1_min:tier_open_ended_not_last']);
  });
  it('a tier needs min and price', () => {
    expect(tiers({ tier1_min: '1' })).toEqual(['tier1_price:tier_incomplete']);
    expect(tiers({ tier1_price: '5' })).toEqual(['tier1_min:tier_incomplete']);
  });
  it('tier price follows the money rules', () => {
    expect(tiers({ tier1_min: '1', tier1_price: '5.555' })).toEqual(['tier1_price:decimal_too_many_places']);
    expect(tiers({ tier1_min: '1', tier1_price: '-5' })).toEqual(['tier1_price:decimal_negative']);
    expect(tiers({ tier1_min: '1', tier1_price: '0' })).toEqual(['tier1_price:price_not_positive']);
  });
  it('a price must be above zero (SQL valid_money)', () => {
    expect(issuesFor({ price: '0' })).toEqual(['price:price_not_positive']);
    expect(issuesFor({ price: '0.01' })).toEqual([]);
  });
});

describe('variants (wide columns)', () => {
  it('parses label, sku, attributes and moq', () => {
    const r = runCsv([baseRow({ variant1_label: 'Blue', variant1_sku: 'A-001-B', variant1_attributes: 'Size: L', variant1_moq: '50', variant2_label: 'Red', variant2_sku: 'A-001-R' })]);
    expect(r.rows[0].errors).toEqual([]);
    expect(r.rows[0].data.variants).toEqual([
      { sku: 'A-001-B', label: 'Blue', attributes: { Size: 'L' }, moq: '50' },
      { sku: 'A-001-R', label: 'Red' },
    ]);
  });
  it('a variant needs its own sku (SQL invalid_variant_sku)', () => expect(issuesFor({ variant1_label: 'Blue' })).toEqual(['variant1_sku:required']));
  it('details without a label are incomplete', () => expect(issuesFor({ variant1_sku: 'X-1' })).toEqual(['variant1_label:variant_incomplete']));
  it('duplicate variant skus inside a product are flagged (case-insensitive)', () => {
    expect(issuesFor({ variant1_label: 'A', variant1_sku: 'V1', variant2_label: 'B', variant2_sku: 'v1' })).toEqual(['variant2_sku:duplicate_variant']);
  });
  it('variant attributes: at most 10 pairs, key 40, value 100', () => {
    const pairs = (n: number) => Array.from({ length: n }, (_, i) => `k${i}: v`).join('; ');
    expect(issuesFor({ variant1_label: 'A', variant1_sku: 'V1', variant1_attributes: pairs(10) })).toEqual([]);
    expect(issuesFor({ variant1_label: 'A', variant1_sku: 'V1', variant1_attributes: pairs(11) })).toEqual(['variant1_attributes:specs_too_many']);
    expect(issuesFor({ variant1_label: 'A', variant1_sku: 'V1', variant1_attributes: `k: ${'v'.repeat(101)}` })).toEqual(['variant1_attributes:too_long']);
  });
  it('variant moq follows the moq rules', () => expect(issuesFor({ variant1_label: 'A', variant1_sku: 'V1', variant1_moq: '0' })).toEqual(['variant1_moq:moq_not_positive']));
});

describe('duplicate SKUs inside the file', () => {
  it('flags every later duplicate and names the first row (case-insensitive)', () => {
    const r = runCsv([baseRow({ sku: 'D-1' }), baseRow({ sku: 'E-1' }), baseRow({ sku: 'd-1' }), baseRow({ sku: 'D-1' })]);
    expect(r.rows.map((x) => x.status)).toEqual(['valid', 'valid', 'duplicate', 'duplicate']);
    expect(r.rows[2].errors).toEqual([{ field: 'sku', key: 'duplicate_sku', params: { firstRow: 2 } }]);
    expect(r.rows[3].errors[0].params).toEqual({ firstRow: 2 });
    expect(r.totals).toEqual({ rows: 4, valid: 2, invalid: 0, duplicates: 2 });
  });
  it('a duplicate that is also invalid keeps all its errors and the duplicate status', () => {
    const r = runCsv([baseRow({ sku: 'D-1' }), baseRow({ sku: 'D-1', moq: '0' })]);
    expect(r.rows[1].status).toBe('duplicate');
    expect(r.rows[1].errors.map((e) => e.key)).toEqual(['moq_not_positive', 'duplicate_sku']);
  });
});

describe('formula injection on import', () => {
  const dangerous = ['=1+1', '+cmd', '-cmd', '@SUM(A1)', '\tx', '\rx', `${ch(0x20)}=cmd`, `${ch(0xa0)}=cmd`, `${ch(0x200b)}@x`, '\n=cmd'];
  for (const text of ['name', 'description', 'unit', 'category', 'packaging', 'specifications']) {
    for (const v of dangerous) {
      it(`${text} ${JSON.stringify(v)} is rejected`, () => {
        const val = text === 'name' || text === 'description' ? `${v}rest of text here` : v;
        expect(issuesFor({ [text]: val })).toContain(`${text}:formula_injection`);
      });
    }
  }
  it('safe values containing the characters later in the text are fine', () => {
    expect(issuesFor({ name: 'A = B + C - D @ E', packaging: '10 x 2 - boxed' })).toEqual([]);
  });
  it('variant labels and attributes are text fields too', () => {
    expect(issuesFor({ variant1_label: '=evil', variant1_sku: 'V1' })).toEqual(['variant1_label:formula_injection']);
    expect(issuesFor({ variant1_label: 'ok', variant1_sku: 'V1', variant1_attributes: '@evil: x' })).toEqual(['variant1_attributes:formula_injection']);
  });
  it('a leading minus on a number is a negative number, not an injection', () => {
    expect(issuesFor({ price: '-5' })).toEqual(['price:decimal_negative']);
    expect(issuesFor({ moq: '-5' })).toEqual(['moq:decimal_negative']);
  });
});

describe('control characters and unicode normalisation', () => {
  it('strips control characters, bidi overrides and zero-width spaces; trims and collapses whitespace', () => {
    const dirty = `  Cotton${ch(1)}${ch(7)}   kurta${ch(0x202e)}${ch(0x200b)}${ch(0x8)}  `;
    const r = runCsv([baseRow({ name: dirty })]);
    expect(r.rows[0].data.name).toBe('Cotton kurta');
  });
  it('NFC-normalises (decomposed e + combining acute becomes one code point)', () => {
    const r = runCsv([baseRow({ name: `Cafe${ch(0x301)} table` })]);
    expect(r.rows[0].data.name).toBe(`Caf${ch(0xe9)} table`);
  });
});

describe('error keys', () => {
  it('every key the validator emits is in the documented list', () => {
    const results = [
      issuesFor({ sku: '' }),
      issuesFor({ moq: 'x' }),
      issuesFor({ availability_date: 'x' }),
      issuesFor({ price_mode: 'x', specifications: 'x' }),
    ].flat();
    for (const entry of results) expect(ROW_ERROR_KEYS as readonly string[]).toContain(entry.split(':')[1]);
    expect(new Set(ROW_ERROR_KEYS).size).toBe(ROW_ERROR_KEYS.length);
  });
});

describe('column mapping', () => {
  it('tolerates case, spaces, underscores and common English synonyms', () => {
    const row = baseRow();
    const mapped: Record<string, string> = {
      'Supplier Code': row.supplier_code,
      'SKU': row.sku,
      'Product Name': row.name,
      'Category': row.category,
      'Product Description': row.description,
      'UOM': row.unit,
      'Minimum Order Quantity': row.moq,
      'CURRENCY': row.currency,
      'Unit-Price': row.price,
      'Specs': row.specifications,
      'Lead Time (days)': row.lead_time_days,
      'Availability Date': row.availability_date,
      'Status': row.status,
    };
    const r = importCatalogueFile(bytes(csvText([mapped])), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    expect(r.rows[0].errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.columns).toEqual(['supplier_code', 'sku', 'name', 'category', 'description', 'unit', 'moq', 'currency', 'price', 'specifications', 'lead_time_days', 'availability_date', 'status']);
  });
  it('unknown columns are warnings and ignored; duplicate columns keep the first', () => {
    const r = runCsv([{ ...baseRow(), colour: 'red', 'Name ': 'second name here' }]);
    expect(r.warnings).toEqual([
      { key: 'unknown_column', params: { column: 'colour', index: 14 } },
      { key: 'duplicate_column', params: { column: 'name' } },
    ]);
    expect(r.rows[0].data.name).toBe('Cotton kurta (synthetic)');
  });
  it('missing required columns are one file-level error listing the names', () => {
    const rows = [Object.fromEntries(Object.entries(baseRow()).filter(([k]) => !['price', 'status', 'currency'].includes(k)))];
    try {
      runCsv(rows);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect((e as ImportError).key).toBe('import_missing_columns');
      expect((e as ImportError).params).toEqual({ columns: ['currency', 'price', 'status'] });
    }
  });
});
