import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { ImportError, canonicalRowsForRpc, importCatalogueFile, parseCatalogueFile } from '@/server/import';
import { NOW, SUPPLIER, baseRow, csvText, runCsv, runXlsx, sheetRows, strToU8, xlsxFile, zipSync } from './util';

const ch = (n: number) => String.fromCodePoint(n);

function keyOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ImportError ? e.key : `other:${String(e)}`;
  }
  return 'none';
}
function errOf(fn: () => unknown): ImportError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ImportError) return e;
    throw e;
  }
  throw new Error('expected an ImportError');
}

const products = (rows = [baseRow()]) => ({ name: 'Products', rows: sheetRows(rows) });
const parse = (b: Uint8Array, name = 'x.xlsx') => parseCatalogueFile(b, name);

/** Rewrite parts of a generated xlsx (null removes a part). */
function patch(base: Uint8Array, changes: Record<string, string | Uint8Array | null>): Uint8Array {
  const files: Record<string, Uint8Array> = unzipSync(base);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete files[k];
    else files[k] = typeof v === 'string' ? strToU8(v) : v;
  }
  return zipSync(files);
}

describe('xlsx happy path (generated in the test)', () => {
  it('reads Products with 1-based row numbers; numeric cells become plain decimals', () => {
    const rows = sheetRows([baseRow({ sku: 'X-1' }), baseRow({ sku: 'X-2' })]);
    rows[1][6] = 100; // moq as a real number cell
    rows[2][8] = 250.5; // price as a real number cell
    rows[2][10] = 21; // lead time number
    const r = runXlsx([{ name: 'Products', rows }]);
    expect(r.format).toBe('xlsx');
    expect(r.totals).toEqual({ rows: 2, valid: 2, invalid: 0, duplicates: 0 });
    expect(r.rows.map((x) => x.rowNumber)).toEqual([2, 3]);
    expect(r.rows[0].data.moq).toBe('100');
    expect(r.rows[1].data.unit_price).toBe('250.50');
  });

  it('reads the optional Variants and PriceTiers sheets keyed by sku', () => {
    const r = runXlsx([
      { name: 'Instructions', rows: [['How to fill this in']] },
      { name: 'Products', rows: sheetRows([baseRow({ sku: 'P-1', price: '' }), baseRow({ sku: 'P-2' })]) },
      { name: 'Variants', rows: [['sku', 'variant_sku', 'label', 'attributes', 'moq'], ['p-1', 'P-1-R', 'Red', 'Size: L', '10'], ['P-1', 'P-1-B', 'Blue', '', '']] },
      {
        name: 'PriceTiers',
        rows: [
          ['sku', 'variant_sku', 'min_qty', 'max_qty', 'unit_price', 'currency'],
          ['P-1', '', '1', '99', '10', 'INR'],
          ['P-1', '', '100', '', '9', 'INR'],
          ['P-1', 'P-1-R', '1', '', '11.5', ''],
        ],
      },
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.fileErrors).toEqual([]);
    expect(r.totals.valid).toBe(2);
    const p1 = r.rows[0].data;
    expect(p1.price_mode).toBe('tiers');
    expect(p1.variants).toEqual([
      { sku: 'P-1-R', label: 'Red', attributes: { Size: 'L' }, moq: '10' },
      { sku: 'P-1-B', label: 'Blue' },
    ]);
    expect(p1.tiers).toEqual([
      { min_qty: '1', max_qty: '99', unit_price: '10.00' },
      { min_qty: '100', unit_price: '9.00' },
      { variant_sku: 'P-1-R', min_qty: '1', unit_price: '11.50' },
    ]);
    expect(r.rows[1].data).not.toHaveProperty('variants');
  });

  it('sheet names tolerate case and spaces; extra sheets warn; Instructions is silent', () => {
    const r = runXlsx([
      { name: 'Instructions', rows: [['x']] },
      { name: 'products', rows: sheetRows([baseRow()]) },
      { name: 'Price Tiers', rows: [['sku', 'min_qty', 'unit_price']] },
      { name: 'Notes', rows: [['scratch']] },
    ]);
    expect(r.warnings).toEqual([{ key: 'sheet_ignored', params: { sheet: 'Notes' } }]);
    expect(r.totals.valid).toBe(1);
  });

  it('errors in child rows are attached to the product with sheet and row params', () => {
    const r = runXlsx([
      { name: 'Products', rows: sheetRows([baseRow({ sku: 'P-1', price: '' })]) },
      { name: 'PriceTiers', rows: [['sku', 'min_qty', 'max_qty', 'unit_price'], ['P-1', '1', '100', '10'], ['P-1', '50', '', '9']] },
    ]);
    expect(r.rows[0].errors).toEqual([{ field: 'min_qty', key: 'tier_overlap', params: { sheet: 'PriceTiers', row: 3 } }]);
  });

  it('child rows for an unknown sku are file-level errors (never silently dropped)', () => {
    const r = runXlsx([
      { name: 'Products', rows: sheetRows([baseRow({ sku: 'P-1' })]) },
      { name: 'Variants', rows: [['sku', 'label'], ['NOPE', 'Red'], ['', 'Blue']] },
    ]);
    expect(r.fileErrors).toEqual([
      { sheet: 'Variants', rowNumber: 2, sku: 'NOPE', field: 'sku', key: 'orphan_child_row' },
      { sheet: 'Variants', rowNumber: 3, sku: '', field: 'sku', key: 'required' },
    ]);
  });

  it('a tier naming an undefined variant is unknown_variant; a sheet currency mismatch is flagged', () => {
    const r = runXlsx([
      { name: 'Products', rows: sheetRows([baseRow({ sku: 'P-1', price: '' })]) },
      { name: 'PriceTiers', rows: [['sku', 'variant_sku', 'min_qty', 'unit_price', 'currency'], ['P-1', 'GHOST', '1', '5', 'MYR']] },
    ]);
    expect(r.rows[0].errors.map((e) => `${e.field}:${e.key}`)).toEqual(['currency:tier_currency_mismatch', 'variant_sku:unknown_variant']);
  });

  it('missing required columns in a child sheet name the sheet', () => {
    const e = errOf(() => parse(xlsxFile([products(), { name: 'Variants', rows: [['sku', 'colour']] }])));
    expect(e.key).toBe('import_missing_columns');
    expect(e.params).toEqual({ columns: ['label'], sheet: 'Variants' });
  });

  it('header-only Products sheet is import_empty; no Products sheet is import_missing_sheet', () => {
    expect(keyOf(() => parse(xlsxFile([{ name: 'Products', rows: [Object.keys(baseRow())] }])))).toBe('import_empty');
    expect(keyOf(() => parse(xlsxFile([{ name: 'Stock', rows: sheetRows([baseRow()]) }])))).toBe('import_missing_sheet');
  });

  it('reads shared strings, rich text, inline strings, booleans and date-formatted cells', () => {
    const headers = Object.keys(baseRow());
    const sst = ['supplier_code', 'SUP-A'];
    const idx = (s: string) => {
      let i = sst.indexOf(s);
      if (i < 0) {
        sst.push(s);
        i = sst.length - 1;
      }
      return i;
    };
    const head = headers.map((h, c) => `<c r="${String.fromCharCode(65 + c)}1" t="s"><v>${idx(h)}</v></c>`).join('');
    const serial = (Date.UTC(2026, 5, 1) - Date.UTC(1899, 11, 30)) / 86400000;
    const vals = baseRow({ sku: 'S-1' });
    const cells = headers
      .map((h, c) => {
        const ref = `${String.fromCharCode(65 + c)}2`;
        if (h === 'availability_date') return `<c r="${ref}" s="2"><v>${serial}</v></c>`;
        if (h === 'moq') return `<c r="${ref}"><v>100</v></c>`;
        if (h === 'name') return `<c r="${ref}" t="inlineStr"><is><r><t>Cotton </t></r><r><t>&amp; silk kurta</t></r></is></c>`;
        return `<c r="${ref}" t="s"><v>${idx(vals[h])}</v></c>`;
      })
      .join('');
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${head}</row><row r="2">${cells}</row><row r="3"/></sheetData></worksheet>`;
    const sstXml = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sst.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t><rPh sb="0" eb="1"><t>IGNORED</t></rPh></si>`).join('')}</sst>`;
    const styles =
      '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>';
    const file = patch(xlsxFile([products()]), { 'xl/worksheets/sheet1.xml': sheet, 'xl/sharedStrings.xml': sstXml, 'xl/styles.xml': styles });
    const r = importCatalogueFile(file, 'x.xlsx', { supplierCode: SUPPLIER, now: NOW });
    expect(r.rows[0].errors).toEqual([]);
    expect(r.rows[0].data.name).toBe('Cotton & silk kurta');
    expect(r.rows[0].data.availability_confirmed_on).toBe('2026-06-01');
    expect(r.rows[0].data.moq).toBe('100');
  });
});

describe('xlsx is data only', () => {
  it('a formula cell refuses the file, with sheet, cell and count', () => {
    const rows = sheetRows([baseRow(), baseRow({ sku: 'A-2' })]);
    rows[1][8] = { formula: 'SUM(1,2)', value: 3 };
    rows[2][1] = { formula: 'HYPERLINK("http://example.invalid","x")', value: 'x' };
    const e = errOf(() => parse(xlsxFile([{ name: 'Products', rows }])));
    expect(e.key).toBe('import_formula_not_allowed');
    expect(e.params).toEqual({ sheet: 'Products', cells: ['I2', 'B3'], count: 2 });
  });
  it('a formula with no cached value is refused too', () => {
    const rows = sheetRows([baseRow()]);
    rows[1][6] = { formula: '1+1' };
    expect(keyOf(() => parse(xlsxFile([{ name: 'Products', rows }])))).toBe('import_formula_not_allowed');
  });
  it('a formula in the Variants sheet is refused', () => {
    const e = errOf(() => parse(xlsxFile([products(), { name: 'Variants', rows: [['sku', 'label'], ['A-001', { formula: '"a"&"b"', value: 'ab' }]] }])));
    expect(e.key).toBe('import_formula_not_allowed');
    expect(e.params).toMatchObject({ sheet: 'Variants', cells: ['B2'] });
  });
  it('text that merely looks like a formula is data and is rejected by validation, not evaluated', () => {
    const r = runXlsx([{ name: 'Products', rows: sheetRows([baseRow({ name: "'=1+1 quoted text" })]) }]);
    expect(r.rows[0].data.name).toBe("'=1+1 quoted text");
    expect(r.rows[0].errors).toEqual([]);
  });
  it('escaped control characters in strings are decoded and then judged (_x003D_ is "=")', () => {
    const file = patch(xlsxFile([products([baseRow({ name: 'placeholder name' })])]), {});
    const files = unzipSync(file);
    const sheet = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']).replace('placeholder name', '_x003D_cmd today');
    const r = importCatalogueFile(patch(file, { 'xl/worksheets/sheet1.xml': sheet }), 'x.xlsx', { supplierCode: SUPPLIER, now: NOW });
    expect(r.rows[0].errors).toEqual([{ field: 'name', key: 'formula_injection' }]);
  });
  it('hidden sheets are ignored with a warning (a hidden Products sheet counts as missing)', () => {
    const r = runXlsx([
      { name: 'Products', rows: sheetRows([baseRow({ sku: 'P-1' })]) },
      { name: 'Variants', rows: [['sku', 'label'], ['P-1', 'Secret']], hidden: true },
    ]);
    expect(r.warnings).toEqual([{ key: 'sheet_hidden_ignored', params: { sheet: 'Variants' } }]);
    expect(r.rows[0].data).not.toHaveProperty('variants');
    expect(keyOf(() => parse(xlsxFile([{ ...products(), hidden: true }])))).toBe('import_missing_sheet');
  });
  it('external link parts are present but never read or followed', () => {
    const file = patch(xlsxFile([products()]), {
      'xl/externalLinks/externalLink1.xml': '<externalLink><externalBook r:id="rId1"/></externalLink>',
      'xl/externalLinks/_rels/externalLink1.xml.rels': '<Relationships><Relationship Id="rId1" Target="file:///C:/secret.xlsx" TargetMode="External"/></Relationships>',
    });
    expect(importCatalogueFile(file, 'x.xlsx', { supplierCode: SUPPLIER, now: NOW }).totals.valid).toBe(1);
  });
  it('macros, embedded objects and macro-enabled workbooks are refused', () => {
    const base = xlsxFile([products()]);
    for (const part of ['xl/vbaProject.bin', 'xl/macrosheets/sheet1.xml', 'xl/embeddings/oleObject1.bin', 'xl/activeX/activeX1.xml']) {
      expect(keyOf(() => parse(patch(base, { [part]: 'x' })))).toBe('import_unsupported_file');
    }
    const ct = new TextDecoder().decode(unzipSync(base)['[Content_Types].xml']).replace('sheet.main+xml', 'sheet.macroEnabled.main+xml').replace('openxmlformats-officedocument.spreadsheetml.sheet.macroEnabled', 'ms-excel.sheet.macroEnabled');
    expect(keyOf(() => parse(patch(base, { '[Content_Types].xml': ct })))).toBe('import_unsupported_file');
  });
  it('unclosed or pathological XML is refused fast (no quadratic scanning)', () => {
    const base = xlsxFile([products()]);
    const evil = `<worksheet><sheetData>${'<row r="1"><c '.repeat(300000)}</sheetData></worksheet>`;
    const t = Date.now();
    expect(keyOf(() => parse(patch(base, { 'xl/worksheets/sheet1.xml': evil })))).toBe('import_malformed');
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('a DOCTYPE / entity declaration is refused (no entity expansion)', () => {
    const base = xlsxFile([products()]);
    const sheet = new TextDecoder().decode(unzipSync(base)['xl/worksheets/sheet1.xml']);
    const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]>${sheet.replace('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '')}`;
    expect(keyOf(() => parse(patch(base, { 'xl/worksheets/sheet1.xml': evil })))).toBe('import_malformed');
  });
});

describe('xlsx limits and malformed archives', () => {
  it('2,000 rows is accepted, 2,001 refused', () => {
    const many = (n: number) => sheetRows(Array.from({ length: n }, (_, i) => baseRow({ sku: `S-${i}` })));
    expect(runXlsx([{ name: 'Products', rows: many(2000) }]).totals.rows).toBe(2000);
    expect(keyOf(() => parse(xlsxFile([{ name: 'Products', rows: many(2001) }])))).toBe('import_too_many_rows');
  });
  it('a sparse sheet with a huge row index is refused', () => {
    const base = xlsxFile([products()]);
    const sheet = new TextDecoder().decode(unzipSync(base)['xl/worksheets/sheet1.xml']).replace('</sheetData>', '<row r="900000"><c r="A900000" t="inlineStr"><is><t>x</t></is></c></row></sheetData>');
    expect(keyOf(() => parse(patch(base, { 'xl/worksheets/sheet1.xml': sheet })))).toBe('import_too_many_rows');
  });
  it('60 columns accepted, 61 refused', () => {
    const wide = (n: number) => {
      const row = baseRow();
      const header = [...Object.keys(row), ...Array.from({ length: n - 13 }, (_, i) => `extra${i}`)];
      const values = [...Object.values(row), ...Array.from({ length: n - 13 }, () => 'x')];
      return [{ name: 'Products', rows: [header, values] }];
    };
    expect(runXlsx(wide(60)).totals.rows).toBe(1);
    expect(keyOf(() => parse(xlsxFile(wide(61))))).toBe('import_too_many_columns');
  });
  it('a cell over 5,000 characters is refused', () => {
    expect(keyOf(() => parse(xlsxFile([{ name: 'Products', rows: sheetRows([baseRow({ description: 'd'.repeat(5001) })]) }])))).toBe('import_cell_too_long');
  });

  /** Build a ZIP whose single big part compresses to almost nothing. */
  const bombWith = (bytes: number, extra: Record<string, Uint8Array> = {}) => {
    const base = unzipSync(xlsxFile([products()]));
    return zipSync({ ...base, 'xl/big.bin': new Uint8Array(bytes), ...extra }, { level: 9 });
  };
  it('zip bomb: declared expansion over 50 MiB is refused without inflating', () => {
    const file = bombWith(60 * 1024 * 1024);
    expect(file.length).toBeLessThan(5 * 1024 * 1024);
    expect(keyOf(() => parse(file))).toBe('import_too_large');
  });
  it('zip bomb: many entries that together exceed 50 MiB are refused', () => {
    const base = unzipSync(xlsxFile([products()]));
    const parts = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`xl/big${i}.bin`, new Uint8Array(9 * 1024 * 1024)]));
    expect(keyOf(() => parse(zipSync({ ...base, ...parts }, { level: 9 })))).toBe('import_too_large');
  });
  it('zip bomb: a header that lies about the size is caught while inflating', () => {
    const base = unzipSync(xlsxFile([products()]));
    const sheet = new TextDecoder().decode(base['xl/worksheets/sheet1.xml']);
    const file = zipSync({ ...base, 'xl/worksheets/sheet1.xml': strToU8(sheet + ' '.repeat(20 * 1024 * 1024)) }, { level: 9 });
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    // find the central directory entry for sheet1.xml and shrink its declared uncompressed size (a part the reader does read)
    const target = strToU8('xl/worksheets/sheet1.xml');
    let patched = 0;
    for (let i = 0; i < file.length - 46; i++) {
      if (dv.getUint32(i, true) === 0x02014b50) {
        const nameLen = dv.getUint16(i + 28, true);
        const name = file.subarray(i + 46, i + 46 + nameLen);
        if (name.length === target.length && name.every((b, k) => b === target[k])) {
          dv.setUint32(i + 24, 1000, true);
          patched++;
        }
      }
    }
    expect(patched).toBe(1);
    expect(keyOf(() => parse(file))).toBe('import_too_large');
  });
  it('a compressed upload over 5 MiB is refused', () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set([0x50, 0x4b, 3, 4]);
    expect(keyOf(() => parse(big))).toBe('import_too_large');
  });
  it('more than 100 entries is refused', () => {
    const base = unzipSync(xlsxFile([products()]));
    const extra = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`xl/media/i${i}.txt`, strToU8('x')]));
    expect(keyOf(() => parse(zipSync({ ...base, ...extra })))).toBe('import_too_large');
  });
  it('path traversal in entry names is refused', () => {
    const base = unzipSync(xlsxFile([products()]));
    expect(keyOf(() => parse(zipSync({ ...base, '../evil.txt': strToU8('x') })))).toBe('import_unsupported_file');
  });
  it('encrypted entries are refused', () => {
    const file = xlsxFile([products()]);
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    for (let i = 0; i < file.length - 46; i++) if (dv.getUint32(i, true) === 0x02014b50) dv.setUint16(i + 8, dv.getUint16(i + 8, true) | 1, true);
    expect(keyOf(() => parse(file))).toBe('import_unsupported_file');
  });
  it('a truncated archive is malformed; garbage after PK magic is malformed', () => {
    const file = xlsxFile([products()]);
    expect(keyOf(() => parse(file.subarray(0, Math.floor(file.length / 2))))).toBe('import_malformed');
    expect(keyOf(() => parse(Uint8Array.from([0x50, 0x4b, 3, 4, ...new Array(60).fill(7)])))).toBe('import_malformed');
  });
  it('corrupt compressed data is refused cleanly (typed error, no crash)', () => {
    const file = xlsxFile([products()]).slice();
    for (let i = 60; i < 200; i++) file[i] ^= 0xff;
    const k = keyOf(() => parse(file));
    expect(k.startsWith('import_')).toBe(true);
  });
  it('a zip that is not a spreadsheet (no workbook part) is unsupported', () => {
    const file = zipSync({ 'word/document.xml': strToU8('<w/>'), '[Content_Types].xml': strToU8('<Types/>') });
    expect(keyOf(() => parse(file, 'x.xlsx'))).toBe('import_unsupported_file');
  });
});

describe('file type checks (magic bytes, not only the extension)', () => {
  it('text pretending to be .xlsx', () => expect(keyOf(() => parse(strToU8(csvText([baseRow()])), 'x.xlsx'))).toBe('import_unsupported_file'));
  it('legacy .xls (OLE) bytes named .xlsx', () => expect(keyOf(() => parse(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'x.xlsx'))).toBe('import_unsupported_file'));
  it('real xlsx bytes named .csv', () => expect(keyOf(() => parse(xlsxFile([products()]), 'x.csv'))).toBe('import_unsupported_file'));
  for (const name of ['x.xls', 'x.xlsm', 'x.xltx', 'x.ods', 'x.xlsb']) {
    it(`${name} is refused by extension even if the bytes are a valid xlsx`, () => expect(keyOf(() => parse(xlsxFile([products()]), name))).toBe('import_unsupported_file'));
  }
  it('empty xlsx upload', () => expect(keyOf(() => parse(new Uint8Array(0), 'x.xlsx'))).toBe('import_empty'));
});

describe('Tamil and Malay text round trip', () => {
  const ta = 'பட்டு புடவை (தமிழ்நாடு)';
  const ms = 'Kain sutera tulen dari India, dibuat dengan tangan. Sesuai untuk majlis perkahwinan.';
  const row = baseRow({ name: ta, description: ms, specifications: 'நிறம்: சிவப்பு; Bahan: sutera' });
  const check = (r: ReturnType<typeof runCsv>) => {
    expect(r.rows[0].errors).toEqual([]);
    expect(r.rows[0].data.name).toBe(ta);
    expect(r.rows[0].data.description).toBe(ms);
    expect(r.rows[0].data.specs).toEqual({ நிறம்: 'சிவப்பு', Bahan: 'sutera' });
    expect(JSON.parse(JSON.stringify(canonicalRowsForRpc(r.rows)))[0].name).toBe(ta);
  };
  it('csv (with and without BOM)', () => {
    check(runCsv([row]));
    check(importCatalogueFile(strToU8(ch(0xfeff) + csvText([row])), 'x.csv', { supplierCode: SUPPLIER, now: NOW }));
  });
  it('xlsx', () => check(runXlsx([{ name: 'Products', rows: sheetRows([row]) }])));
});
