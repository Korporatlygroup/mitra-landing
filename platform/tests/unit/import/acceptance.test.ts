import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalRowsForRpc, importCatalogueFile } from '@/server/import';
import { NOW, SUPPLIER } from './util';

const FIXTURE = path.resolve(import.meta.dirname, '../../fixtures/import/acceptance-10rows.csv');

describe('acceptance: 10-row synthetic file (7 valid, 3 invalid)', () => {
  const result = importCatalogueFile(readFileSync(FIXTURE), 'acceptance-10rows.csv', { supplierCode: SUPPLIER, now: NOW });

  it('has the expected totals', () => {
    expect(result.totals).toEqual({ rows: 10, valid: 7, invalid: 3, duplicates: 0 });
    expect(result.fileErrors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports the invalid rows with exact spreadsheet row numbers and error keys', () => {
    const invalid = result.rows.filter((r) => !r.ok).map((r) => ({ row: r.rowNumber, sku: r.sku, errors: r.errors.map((e) => `${e.field}:${e.key}`) }));
    expect(invalid).toEqual([
      { row: 4, sku: 'A-003', errors: ['price:decimal_invalid'] },
      { row: 7, sku: 'A-006', errors: ['category:category_invalid', 'currency:currency_invalid'] },
      { row: 10, sku: 'A-009', errors: ['supplier_code:unknown_supplier'] },
    ]);
  });

  it('the valid rows are exactly rows 2,3,5,6,8,9,11', () => {
    expect(result.rows.filter((r) => r.ok).map((r) => r.rowNumber)).toEqual([2, 3, 5, 6, 8, 9, 11]);
  });

  it('normalises values: category label, grouped price, dd/mm/yyyy date, request price mode', () => {
    const byRow = new Map(result.rows.map((r) => [r.rowNumber, r.data]));
    expect(byRow.get(3)).toMatchObject({ category_slug: 'textiles-apparel', unit_price: '1250.50', price_mode: 'fixed' });
    expect(result.rows.find((r) => r.rowNumber === 3)?.requestedStatus).toBe('submit');
    expect(byRow.get(9)).toMatchObject({ availability_confirmed_on: '2026-06-15' });
    expect(byRow.get(6)).toMatchObject({ moq: '2.5', price_mode: 'request' });
    expect(byRow.get(6)).not.toHaveProperty('unit_price');
  });

  it('rpc payload: flat SQL draft objects with _row, in file order; rejected rows are flagged', () => {
    const rows = canonicalRowsForRpc(result.rows);
    expect(rows.map((r) => r._row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(rows.filter((r) => r._client_invalid).map((r) => r._row)).toEqual([4, 7, 10]);
    expect(rows[2]._client_invalid).toEqual(['price:decimal_invalid']);
    expect(rows[0]).toEqual({
      _row: 2,
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
    expect(JSON.stringify(rows)).not.toContain('"raw"');
    expect(canonicalRowsForRpc(result.rows, { invalid: 'omit' }).map((r) => r._row)).toEqual([2, 3, 5, 6, 8, 9, 11]);
  });
});
