import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FILE_ERROR_KEYS,
  ROW_ERROR_KEYS,
  WARNING_KEYS,
  buildErrorReportCsv,
  buildTemplateCsv,
  buildTemplateXlsx,
  canonicalRowsForRpc,
  fileSha256,
  importCatalogueFile,
  parseCatalogueFile,
  safeCell,
  toCsv,
  TEMPLATE_HEADER,
} from '@/server/import';
import { NOW, SUPPLIER, baseRow, bytes, csvText, runCsv } from './util';

const ch = (n: number) => String.fromCodePoint(n);

describe('safeCell (export formula-injection guard)', () => {
  const cases: [unknown, string][] = [
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', "'\rcmd"],
    [`${ch(0x20)}=cmd`, `'${ch(0x20)}=cmd`],
    [`${ch(0xa0)}=cmd`, `'${ch(0xa0)}=cmd`],
    ['\n=cmd', "'\n=cmd"],
    ['=HYPERLINK("http://x.invalid","click")', "'=HYPERLINK(\"http://x.invalid\",\"click\")"],
    ['plain text', 'plain text'],
    ['a=b', 'a=b'],
    ['Bahasa Melayu', 'Bahasa Melayu'],
    ['தமிழ்', 'தமிழ்'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    [42, '42'],
    [0, '0'],
    [-5, "'-5"],
  ];
  for (const [input, out] of cases) it(`${JSON.stringify(input)} -> ${JSON.stringify(out)}`, () => expect(safeCell(input)).toBe(out));
  it('removes NUL bytes', () => expect(safeCell('a\u0000b')).toBe('ab'));
});

describe('toCsv', () => {
  it('quotes, escapes and neutralises every cell; BOM + CRLF', () => {
    const out = toCsv([['a,b', 'say "hi"', '=evil()', 'line\nbreak']]);
    expect(out).toBe(`${ch(0xfeff)}"a,b","say ""hi""",'=evil(),"line\nbreak"\r\n`);
  });
});

describe('error report: only failed rows, with an errors column', () => {
  const rows = [
    baseRow({ sku: 'OK-1' }),
    baseRow({ sku: 'BAD-1', name: '=HYPERLINK("http://x.invalid","x")', moq: '0' }),
    baseRow({ sku: 'OK-1', description: 'Duplicate of the first row.' }),
    baseRow({ sku: 'BAD-2', price: '1.2.3', packaging: '+evil' }),
  ];
  const result = runCsv(rows);
  const report = buildErrorReportCsv(result);
  const lines = report.replace(ch(0xfeff), '').trimEnd().split('\r\n');

  it('contains the header and only the 3 failed rows, with original row numbers', () => {
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(`row_number,${result.columns.join(',')},errors`);
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['3', '4', '5']);
    expect(lines.some((l) => l.startsWith('2,'))).toBe(false);
  });
  it('has the errors as field: key text', () => {
    expect(report).toContain('name: formula_injection | moq: moq_not_positive');
    expect(report).toContain('sku: duplicate_sku (firstRow=2)');
    expect(report).toContain('price: decimal_invalid');
  });
  it('neutralises user-supplied dangerous cells in the export', () => {
    expect(report).toContain(`'=HYPERLINK(""http://x.invalid"",""x"")`);
    expect(report).toContain("'+evil");
    for (const l of lines) for (const cell of l.split(',')) expect(/^[=+\-@]/.test(cell) && !/^[-+]?\d/.test(cell)).toBe(false);
  });
  it('can be re-uploaded: row_number and errors columns are ignored silently', () => {
    const fixed = buildErrorReportCsv(runCsv([baseRow({ sku: 'BAD-9', moq: '0' })]));
    const r = importCatalogueFile(bytes(fixed), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    expect(r.warnings).toEqual([]);
    expect(r.totals.rows).toBe(1);
  });
  it('accepts a translator for the issues', () => {
    const t = buildErrorReportCsv(result, (i) => `T(${i.key})`);
    expect(t).toContain('T(moq_not_positive)');
  });
  it('a result with no failures gives a header-only report', () => {
    const clean = buildErrorReportCsv(runCsv([baseRow()]));
    expect(clean.trimEnd().split('\r\n')).toHaveLength(1);
  });
});

describe('templates', () => {
  it('csv template: header, one clearly synthetic example row, and it parses with no unknown columns', () => {
    const text = buildTemplateCsv({ now: NOW });
    const parsed = parseCatalogueFile(bytes(text), 'template.csv');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.columns).toEqual(TEMPLATE_HEADER);
    expect(parsed.rows[0].cells.sku).toBe('EXAMPLE-001');
    expect(parsed.rows[0].cells.name).toContain('EXAMPLE');
    expect(text.startsWith(ch(0xfeff))).toBe(true);
  });
  it('the example row is valid only for its own fake supplier code; for any real supplier it is rejected', () => {
    const text = buildTemplateCsv({ now: NOW });
    const real = importCatalogueFile(bytes(text), 'template.csv', { supplierCode: SUPPLIER, now: NOW });
    expect(real.totals.valid).toBe(0);
    expect(real.rows[0].errors).toEqual([{ field: 'supplier_code', key: 'unknown_supplier' }]);
    const fake = importCatalogueFile(bytes(text), 'template.csv', { supplierCode: 'EXAMPLE-DELETE-ME', now: NOW });
    expect(fake.rows[0].errors).toEqual([]);
    expect(fake.rows[0].data.tiers).toHaveLength(3);
    expect(fake.rows[0].data.variants).toHaveLength(2);
  });
  it('xlsx template: Instructions, Products, Variants, PriceTiers; parses back; contains no formulas', () => {
    const file = buildTemplateXlsx({ now: NOW });
    expect(file[0]).toBe(0x50);
    const parsed = parseCatalogueFile(file, 'template.xlsx');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.variantRows).toHaveLength(1);
    expect(parsed.tierRows).toHaveLength(1);
    expect(parsed.columns).toEqual(TEMPLATE_HEADER);
    const real = importCatalogueFile(file, 'template.xlsx', { supplierCode: SUPPLIER, now: NOW });
    expect(real.totals.valid).toBe(0);
  });
  it('xlsx template Instructions sheet is plain language and generated in code (deterministic)', () => {
    const a = buildTemplateXlsx({ now: NOW });
    const b = buildTemplateXlsx({ now: NOW });
    expect(fileSha256(a)).toBe(fileSha256(b));
  });
});

describe('determinism and hashing', () => {
  it('same input gives identical output, including the rpc payload', () => {
    const text = csvText([baseRow({ sku: 'A' }), baseRow({ sku: 'B', moq: '0' }), baseRow({ sku: 'A' })]);
    const a = importCatalogueFile(bytes(text), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    const b = importCatalogueFile(bytes(text), 'x.csv', { supplierCode: SUPPLIER, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(canonicalRowsForRpc(a.rows))).toBe(JSON.stringify(canonicalRowsForRpc(b.rows)));
    expect(JSON.stringify(canonicalRowsForRpc(a.rows, { invalid: 'omit' }))).toBe(JSON.stringify(canonicalRowsForRpc(b.rows, { invalid: 'omit' })));
  });
  it('fileSha256 is the plain SHA-256 hex of the bytes', () => {
    const b = bytes('hello');
    expect(fileSha256(b)).toBe(createHash('sha256').update('hello').digest('hex'));
    expect(fileSha256(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)).toBe(fileSha256(b));
    expect(fileSha256(bytes('hello!'))).not.toBe(fileSha256(b));
  });
  it('rpc rows are flat SQL drafts with a fixed key order; rejected rows carry error keys, never English text', () => {
    const r = runCsv([baseRow({ moq: 'x' }), baseRow({ sku: 'OK-2', packaging: '10 per bag', variant1_label: 'Blue', variant1_sku: 'OK-2-B', price: '', tier1_min: '1', tier1_price: '5' })]);
    const [bad, good] = canonicalRowsForRpc(r.rows);
    expect(Object.keys(bad)).toEqual([
      '_row', 'sku', 'name', 'description', 'category_slug', 'unit', 'moq', 'currency', 'price_mode', 'unit_price', 'lead_time_min_days', 'lead_time_max_days', 'availability_confirmed_on', 'specs', '_client_invalid',
    ]);
    expect(bad.moq).toBe('x'); // raw text kept so the database reports its own error
    expect(bad._client_invalid).toEqual(['moq:decimal_invalid']);
    expect(Object.keys(good)).toEqual([
      '_row', 'sku', 'name', 'description', 'category_slug', 'unit', 'moq', 'currency', 'price_mode', 'tiers', 'variants', 'lead_time_min_days', 'lead_time_max_days', 'availability_confirmed_on', 'specs', 'packaging',
    ]);
    for (const row of [bad, good]) {
      expect(row).not.toHaveProperty('supplier_code');
      expect(row).not.toHaveProperty('status');
      expect(row).not.toHaveProperty('raw');
    }
  });
});

describe('documented error keys', () => {
  it('lists are unique and prefixed consistently', () => {
    for (const list of [FILE_ERROR_KEYS, ROW_ERROR_KEYS, WARNING_KEYS]) expect(new Set(list).size).toBe(list.length);
    for (const k of FILE_ERROR_KEYS) expect(k.startsWith('import_')).toBe(true);
    expect(FILE_ERROR_KEYS).toEqual(
      expect.arrayContaining(['import_unsupported_file', 'import_too_large', 'import_too_many_rows', 'import_too_many_columns', 'import_malformed', 'import_formula_not_allowed', 'import_empty']),
    );
  });
});
