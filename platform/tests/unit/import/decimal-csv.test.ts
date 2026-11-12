import { describe, expect, it } from 'vitest';
import { ImportError, importCatalogueFile, parseCatalogueFile, parseDecimal } from '@/server/import';
import { numericCellToText } from '@/server/import/decimal';
import { NOW, SUPPLIER, baseRow, bytes, csvText, runCsv } from './util';

const money = (s: string) => parseDecimal(s, { maxScale: 2, maxIntDigits: 12, fixedScale: true });
const ch = (n: number) => String.fromCodePoint(n);

describe('decimal parsing table (money, 2 places, no floats)', () => {
  const ok: [string, string][] = [
    ['250', '250.00'],
    ['250.5', '250.50'],
    ['1,250.50', '1250.50'],
    ['1,250,000', '1250000.00'],
    ['1,25,000.50', '125000.50'],
    ['12,34,567', '1234567.00'],
    ['0', '0.00'],
    ['0.99', '0.99'],
    ['007', '7.00'],
    ['10.500', '10.50'],
    ['999999999999.99', '999999999999.99'],
    ['  42  ', '42.00'],
    ['0.10', '0.10'],
    ['19.99', '19.99'],
  ];
  for (const [input, expected] of ok) {
    it(`accepts ${JSON.stringify(input)} -> ${expected}`, () => {
      const r = money(input);
      expect(r.ok && r.text).toBe(expected);
    });
  }
  const bad: [string, string][] = [
    ['1.2.3', 'decimal_invalid'],
    ['abc', 'decimal_invalid'],
    ['1e3', 'decimal_invalid'],
    ['1E3', 'decimal_invalid'],
    ['.5', 'decimal_invalid'],
    ['5.', 'decimal_invalid'],
    ['+5', 'decimal_invalid'],
    ['1 250', 'decimal_invalid'],
    ['1,2,3', 'decimal_invalid'],
    ['1,,250.50', 'decimal_invalid'],
    ['12.5%', 'decimal_invalid'],
    ['Rs 250', 'decimal_invalid'],
    ['NaN', 'decimal_invalid'],
    ['Infinity', 'decimal_invalid'],
    ['0x10', 'decimal_invalid'],
    [`${ch(0xff11)}${ch(0xff12)}`, 'decimal_invalid'],
    ['1,50', 'decimal_ambiguous'],
    ['12,50', 'decimal_ambiguous'],
    ['1,250', 'decimal_ambiguous'],
    ['1.250,50', 'decimal_ambiguous'],
    ['1.234.567,89', 'decimal_ambiguous'],
    ['-5', 'decimal_negative'],
    ['-0.5', 'decimal_negative'],
    ['-1,250.50', 'decimal_negative'],
    ['--5', 'decimal_invalid'],
    ['10.505', 'decimal_too_many_places'],
    ['0.001', 'decimal_too_many_places'],
    ['1234567890123', 'decimal_too_large'],
    ['', 'required'],
  ];
  for (const [input, key] of bad) {
    it(`rejects ${JSON.stringify(input)} -> ${key}`, () => {
      const r = money(input);
      expect(r.ok ? 'ok' : r.key).toBe(key);
    });
  }
  it('uses exact integer (BigInt) arithmetic: 0.1 + 0.2 style values stay exact', () => {
    const a = money('0.10');
    const b = money('0.20');
    const c = money('0.30');
    expect(a.ok && b.ok && c.ok && a.scaled + b.scaled === c.scaled).toBe(true);
    const big = money('999999999999.99');
    expect(big.ok && big.scaled).toBe(99999999999999n);
  });
  it('quantity precision: up to 3 places, canonical text has no trailing zeros', () => {
    const q = (s: string) => parseDecimal(s, { maxScale: 3, maxIntDigits: 9 });
    expect(q('2.500')).toMatchObject({ ok: true, text: '2.5' });
    expect(q('100')).toMatchObject({ ok: true, text: '100' });
    expect(q('0.0005')).toMatchObject({ ok: false, key: 'decimal_too_many_places' });
  });
});

describe('numeric spreadsheet cells to text', () => {
  const cases: [string, string][] = [
    ['1250.5', '1250.5'],
    ['1.25E+3', '1250'],
    ['19.989999999999998', '19.99'],
    ['0.1', '0.1'],
    ['0.30000000000000004', '0.3'],
    ['1E-7', '0.0000001'],
    ['-5', '-5'],
    ['42', '42'],
    ['abc', 'abc'],
  ];
  for (const [i, o] of cases) it(`${i} -> ${o}`, () => expect(numericCellToText(i)).toBe(o));
});

describe('CSV dialects', () => {
  const expectOne = (r: ReturnType<typeof runCsv>) => {
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].errors).toEqual([]);
    expect(r.rows[0].rowNumber).toBe(2);
  };
  it('plain LF', () => expectOne(runCsv([baseRow()])));
  it('CRLF line endings', () => expectOne(runCsv([baseRow()], { eol: '\r\n' })));
  it('classic Mac CR line endings', () => expectOne(runCsv([baseRow()], { eol: '\r' })));
  it('semicolon delimiter is detected', () => {
    const r = runCsv([baseRow({ specifications: 'Material: cotton; Size: M' })], { delimiter: ';' });
    expectOne(r);
    expect(r.rows[0].data.specs).toEqual({ Material: 'cotton', Size: 'M' });
  });
  it('UTF-8 BOM is stripped from the first header', () => {
    const r = importCatalogueFile(bytes(csvText([baseRow()]), true), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    expect(r.warnings).toEqual([]);
    expect(r.rows[0].ok).toBe(true);
  });
  it('quoted fields with commas, doubled quotes and embedded newlines', () => {
    const r = runCsv([baseRow({ name: 'Brass "Diya", large', description: 'Line one of the text.\nLine two of the text.' })]);
    expectOne(r);
    expect(r.rows[0].data.name).toBe('Brass "Diya", large');
    expect(r.rows[0].data.description).toBe('Line one of the text.\nLine two of the text.');
  });
  it('row numbers follow the file: blank lines still count, a quoted multi-line cell is one row', () => {
    const text = csvText([baseRow({ sku: 'R-1', description: 'Multi line\ncell value here.' })]) + '\n\n' + csvText([baseRow({ sku: 'R-2' })]).split('\n').slice(1).join('\n');
    const r = importCatalogueFile(bytes(text), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    expect(r.rows.map((x) => [x.sku, x.rowNumber])).toEqual([
      ['R-1', 2],
      ['R-2', 5],
    ]);
  });
  it('fully blank rows are skipped', () => {
    const r = importCatalogueFile(bytes(csvText([baseRow()]) + ',,,,,\n'), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    expect(r.rows).toHaveLength(1);
  });
  it('no trailing newline', () => {
    const r = importCatalogueFile(bytes(csvText([baseRow()]).trimEnd()), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    expectOne(r);
  });
  it('unterminated quote is malformed', () => {
    expect(() => parseCatalogueFile(bytes('sku,name\n"abc,def\n'), 'x.csv')).toThrowError(expect.objectContaining({ key: 'import_malformed' }));
  });
  it('invalid UTF-8 (e.g. Windows-1252) is refused with import_bad_encoding', () => {
    const raw = Uint8Array.from([...bytes('sku,name\nA1,caf'), 0xe9, 0x0a]);
    expect(() => parseCatalogueFile(raw, 'x.csv')).toThrowError(expect.objectContaining({ key: 'import_bad_encoding' }));
  });
  it('a short row (fewer cells than headers) is read with blanks', () => {
    const header = Object.keys(baseRow()).join(',');
    const r = importCatalogueFile(bytes(`${header}\nSUP-A,A-1,Short row\n`), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    expect(r.rows[0].errors.map((e) => e.field)).toContain('category');
  });
});

describe('file-level refusals (csv)', () => {
  const key = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof ImportError ? e.key : `other:${String(e)}`;
    }
    return 'none';
  };
  it('empty file', () => expect(key(() => parseCatalogueFile(new Uint8Array(0), 'x.csv'))).toBe('import_empty'));
  it('whitespace-only file', () => expect(key(() => parseCatalogueFile(bytes('\n\n  \n'), 'x.csv'))).toBe('import_missing_columns'));
  it('header-only file', () => expect(key(() => parseCatalogueFile(bytes(Object.keys(baseRow()).join(',') + '\n'), 'x.csv'))).toBe('import_empty'));
  it('header-only file with BOM and CRLF', () => expect(key(() => parseCatalogueFile(bytes(Object.keys(baseRow()).join(',') + '\r\n', true), 'x.csv'))).toBe('import_empty'));
  it('2,000 rows is the limit, 2,001 is refused', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => baseRow({ sku: `S-${i}` }));
    expect(runCsv(rows(2000)).totals.rows).toBe(2000);
    expect(key(() => runCsv(rows(2001)))).toBe('import_too_many_rows');
  });
  it('60 columns is the limit, 61 is refused', () => {
    const extra = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`extra${i}`, 'x']));
    const r60 = runCsv([{ ...baseRow(), ...extra(47) }]); // 13 + 47 = 60
    expect(r60.rows).toHaveLength(1);
    expect(key(() => runCsv([{ ...baseRow(), ...extra(48) }]))).toBe('import_too_many_columns');
  });
  it('file over 5 MiB', () => expect(key(() => parseCatalogueFile(new Uint8Array(5 * 1024 * 1024 + 1).fill(97), 'x.csv'))).toBe('import_too_large'));
  it('NUL bytes mean it is not a text csv', () => expect(key(() => parseCatalogueFile(Uint8Array.from([97, 44, 0, 98, 10]), 'x.csv'))).toBe('import_unsupported_file'));
  it('UTF-16 text is refused (NUL bytes)', () => {
    const utf16 = Uint8Array.from([0xff, 0xfe, ...Array.from('sku,name\n').flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(key(() => parseCatalogueFile(utf16, 'x.csv'))).toBe('import_unsupported_file');
  });
  it('zip bytes with a .csv name', () => expect(key(() => parseCatalogueFile(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0]), 'x.csv'))).toBe('import_unsupported_file'));
  it('legacy OLE (.xls) bytes with a .csv name', () => expect(key(() => parseCatalogueFile(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), 'x.csv'))).toBe('import_unsupported_file'));
  for (const name of ['x.xls', 'x.xlsm', 'x.ods', 'x.xlsb', 'x.txt', 'x.csv.exe', 'x', 'x.CSV.zip']) {
    it(`extension of ${name} is refused`, () => expect(key(() => parseCatalogueFile(bytes('a,b\n1,2\n'), name))).toBe('import_unsupported_file'));
  }
  it('extension check is case-insensitive and ignores the path', () => {
    expect(() => parseCatalogueFile(bytes(csvText([baseRow()])), 'C:\\fakepath\\Catalogue.CSV')).not.toThrow();
  });
});
