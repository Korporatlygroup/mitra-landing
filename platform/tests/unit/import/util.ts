import { strToU8, zipSync } from 'fflate';
import { importCatalogueFile, type ImportResult } from '@/server/import';
import { writeXlsx, type XlsxCell, type XlsxSheetInput } from '@/server/import/xlsx-write';

export const NOW = new Date('2026-07-01T00:00:00Z');
export const SUPPLIER = 'SUP-A';

export type Cells = Record<string, string>;

export function baseRow(over: Cells = {}): Cells {
  return {
    supplier_code: SUPPLIER,
    sku: 'A-001',
    name: 'Cotton kurta (synthetic)',
    category: 'textiles-apparel',
    description: 'Synthetic cotton kurta for testing only.',
    unit: 'piece',
    moq: '100',
    currency: 'INR',
    price: '250.50',
    specifications: 'Material: cotton; Size: M',
    lead_time_days: '21',
    availability_date: '2026-06-01',
    status: 'draft',
    ...over,
  };
}

const q = (v: string) => (/[",;\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export function csvText(rows: Cells[], opts: { delimiter?: ',' | ';'; eol?: string; headers?: string[] } = {}): string {
  const d = opts.delimiter ?? ',';
  const eol = opts.eol ?? '\n';
  const headers = opts.headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [headers.join(d), ...rows.map((r) => headers.map((h) => q(r[h] ?? '')).join(d))].join(eol) + eol;
}

export const bytes = (s: string, bom = false): Uint8Array => strToU8((bom ? '\uFEFF' : '') + s);

export function runCsv(rows: Cells[], opts?: Parameters<typeof csvText>[1]): ImportResult {
  return importCatalogueFile(bytes(csvText(rows, opts)), 'catalogue.csv', { supplierCode: SUPPLIER, now: NOW });
}

/** One row validated alone; returns its issues as "field:key" strings. */
export function issuesFor(over: Cells): string[] {
  const r = runCsv([baseRow(over)]);
  return r.rows[0].errors.map((e) => `${e.field}:${e.key}`);
}

export function sheetRows(rows: Cells[], headers?: string[]): XlsxCell[][] {
  const h = headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [h, ...rows.map((r) => h.map((k) => r[k] ?? ''))];
}

export function xlsxFile(sheets: XlsxSheetInput[]): Uint8Array {
  return writeXlsx(sheets);
}

export function runXlsx(sheets: XlsxSheetInput[], fileName = 'catalogue.xlsx'): ImportResult {
  return importCatalogueFile(xlsxFile(sheets), fileName, { supplierCode: SUPPLIER, now: NOW });
}

export { zipSync, strToU8 };
