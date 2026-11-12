import { numericCellToText } from './decimal';
import { ImportError, type Warning } from './errors';
import type { Grid } from './csv';
import { LIMITS } from './limits';
import { listZip, readEntry, type ZipEntry } from './zip';
import { SHEET_INSTRUCTIONS, SHEET_PRODUCTS, SHEET_TIERS, SHEET_VARIANTS, compactHeader } from './columns';

/**
 * XLSX reader. Data only: formulas are never evaluated (any formula cell refuses the file), macros,
 * external links, embedded objects and charts are never read, and only the documented sheets are parsed.
 */

const decoder = new TextDecoder('utf-8');

const MAIN_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const DANGEROUS_PART = /(^|\/)vbaProject\.bin$|^xl\/macrosheets\/|^xl\/embeddings\/|^xl\/activeX\/|^xl\/dialogsheets\//i;

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, g: string) => {
    switch (g) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
    }
    const code = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
    return String.fromCodePoint(code);
  });
}

function unescapeXlsxChars(s: string): string {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  return out;
}


/**
 * Linear-time element scanner (indexOf based, no backtracking regex), so crafted XML cannot cause
 * quadratic scans. An element that is opened but never closed is malformed.
 */
function* elements(xml: string, tag: string): Generator<{ attrs: string; inner: string }> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const i = xml.indexOf(open, pos);
    if (i < 0) return;
    const next = xml.charCodeAt(i + open.length);
    if (!(next === 32 || next === 9 || next === 10 || next === 13 || next === 62 || next === 47)) {
      pos = i + open.length;
      continue;
    }
    const gt = xml.indexOf('>', i);
    if (gt < 0) throw new ImportError('import_malformed', { reason: 'xml' });
    if (xml[gt - 1] === '/') {
      yield { attrs: xml.slice(i + open.length, gt - 1), inner: '' };
      pos = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt + 1);
    if (end < 0) throw new ImportError('import_malformed', { reason: 'xml' });
    yield { attrs: xml.slice(i + open.length, gt), inner: xml.slice(gt + 1, end) };
    pos = end + close.length;
  }
}

function stripPhonetic(s: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const i = s.indexOf('<rPh', pos);
    if (i < 0) return out + s.slice(pos);
    out += s.slice(pos, i);
    const e = s.indexOf('</rPh>', i);
    if (e < 0) throw new ImportError('import_malformed', { reason: 'xml' });
    pos = e + 6;
  }
}

function textOf(inner: string): string {
  let out = '';
  for (const t of elements(stripPhonetic(inner), 't')) out += decodeEntities(t.inner);
  return unescapeXlsxChars(out);
}

function assertSafeXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ImportError('import_malformed', { reason: 'dtd' });
}

function colIndex(ref: string): number {
  const m = /^([A-Z]{1,3})\d*$/i.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colName(idx: number): string {
  let s = '';
  for (let n = idx; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '');
  return /[dmyhs]/i.test(stripped);
}

function parseDateStyles(styles: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of elements(styles, 'numFmt')) {
    const a = attrs(m.attrs);
    if (a.numFmtId && a.formatCode !== undefined) custom.set(Number(a.numFmtId), a.formatCode);
  }
  const dateXfs = new Set<number>();
  const block = elements(styles, 'cellXfs').next();
  if (block.done) return dateXfs;
  let i = 0;
  for (const m of elements(block.value.inner, 'xf')) {
    const id = Number(attrs(m.attrs).numFmtId ?? 0);
    if (BUILTIN_DATE_FMTS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)!))) dateXfs.add(i);
    i++;
  }
  return dateXfs;
}

function serialToIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 61 || serial > 2958465) return null;
  const base = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 86400000 : 0);
  return new Date(base + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
}

interface SheetCtx {
  name: string;
  shared: string[];
  dateXfs: Set<number>;
  date1904: boolean;
  maxDataRows: number;
}

function parseSheet(xml: string, ctx: SheetCtx): Grid {
  assertSafeXml(xml);
  const rows: Grid['rows'] = [];
  const formulaCells: string[] = [];
  let formulaCount = 0;
  let seq = 0;
  let nonEmpty = 0;
  for (const rm of elements(xml, 'row')) {
    seq++;
    const ra = attrs(rm.attrs);
    const rowNumber = ra.r ? Number(ra.r) : seq;
    if (!Number.isInteger(rowNumber) || rowNumber < 1) throw new ImportError('import_malformed', { reason: 'bad_row_index' });
    if (rowNumber > LIMITS.maxRowIndex) throw new ImportError('import_too_many_rows', { max: LIMITS.maxRows });
    const inner = rm.inner;
    const cells: string[] = [];
    let cseq = 0;
    for (const cm of elements(inner, 'c')) {
      cseq++;
      const ca = attrs(cm.attrs);
      const col = ca.r ? colIndex(ca.r) : cseq;
      if (col < 1) throw new ImportError('import_malformed', { reason: 'bad_cell_ref' });
      const body = cm.inner;
      if (/<f[\s>/]/.test(body)) {
        formulaCount++;
        if (formulaCells.length < 20) formulaCells.push(`${colName(col)}${rowNumber}`);
        continue;
      }
      let value = '';
      const t = ca.t ?? 'n';
      if (t === 'inlineStr') {
        const is = elements(body, 'is').next();
        value = is.done ? '' : textOf(is.value.inner);
      } else {
        const vm = elements(body, 'v').next();
        const v = vm.done ? '' : decodeEntities(vm.value.inner);
        if (v !== '') {
          if (t === 's') {
            const idx = Number(v);
            if (!Number.isInteger(idx) || idx < 0 || idx >= ctx.shared.length) throw new ImportError('import_malformed', { reason: 'bad_shared_string' });
            value = ctx.shared[idx];
          } else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'str' || t === 'e' || t === 'd') value = unescapeXlsxChars(v);
          else if (ca.s !== undefined && ctx.dateXfs.has(Number(ca.s))) value = serialToIso(Number(v), ctx.date1904) ?? numericCellToText(v);
          else value = numericCellToText(v);
        }
      }
      if (value === '') continue;
      if (value.length > LIMITS.maxCellLength) throw new ImportError('import_cell_too_long', { sheet: ctx.name, row: rowNumber, max: LIMITS.maxCellLength });
      if (col > LIMITS.maxColumns) throw new ImportError('import_too_many_columns', { max: LIMITS.maxColumns });
      while (cells.length < col - 1) cells.push('');
      cells[col - 1] = value;
    }
    if (cells.length === 0) continue;
    nonEmpty++;
    if (nonEmpty > ctx.maxDataRows + 1) throw new ImportError('import_too_many_rows', { max: ctx.maxDataRows });
    rows.push({ rowNumber, cells });
  }
  if (formulaCount > 0) throw new ImportError('import_formula_not_allowed', { sheet: ctx.name, cells: formulaCells, count: formulaCount });
  return { rows, delimiter: ',' };
}

function resolveTarget(target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') {
      if (!out.length) throw new ImportError('import_malformed', { reason: 'bad_rel' });
      out.pop();
    } else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

export interface XlsxSheets {
  products: Grid;
  variants: Grid | null;
  tiers: Grid | null;
  warnings: Warning[];
}

export function readXlsx(bytes: Uint8Array): XlsxSheets {
  const entries = listZip(bytes);
  const byName = new Map<string, ZipEntry>(entries.map((e) => [e.name, e]));
  for (const e of entries) {
    if (DANGEROUS_PART.test(e.name)) throw new ImportError('import_unsupported_file', { reason: 'macro_or_embedded_content' });
  }
  const budget = { remaining: 50 * 1024 * 1024 };
  const read = (name: string): string | null => {
    const e = byName.get(name);
    return e ? decoder.decode(readEntry(bytes, e, budget)) : null;
  };

  const ct = read('[Content_Types].xml');
  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  if (ct === null || wb === null || rels === null) throw new ImportError('import_unsupported_file', { reason: 'not_xlsx' });
  assertSafeXml(ct);
  assertSafeXml(wb);
  assertSafeXml(rels);
  const mainOverride = [...elements(ct, 'Override')].map((m) => attrs(m.attrs)).find((a) => a.PartName === '/xl/workbook.xml');
  if (!mainOverride || mainOverride.ContentType !== MAIN_CT) throw new ImportError('import_unsupported_file', { reason: 'not_plain_xlsx' });

  const relTargets = new Map<string, string>();
  for (const m of elements(rels, 'Relationship')) {
    const a = attrs(m.attrs);
    if (a.Id && a.Target && a.Type?.endsWith('/worksheet') && !/^https?:|^file:/i.test(a.Target) && a.TargetMode !== 'External') relTargets.set(a.Id, resolveTarget(a.Target));
  }
  const wbPr = elements(wb, 'workbookPr').next();
  const date1904 = !wbPr.done && /^(1|true)$/i.test(attrs(wbPr.value.attrs).date1904 ?? '');

  const warnings: Warning[] = [];
  const wanted: Record<'products' | 'variants' | 'tiers', string | null> = { products: null, variants: null, tiers: null };
  const bySheetName: Record<string, keyof typeof wanted> = {
    [compactHeader(SHEET_PRODUCTS)]: 'products',
    [compactHeader(SHEET_VARIANTS)]: 'variants',
    [compactHeader(SHEET_TIERS)]: 'tiers',
  };
  for (const m of elements(wb, 'sheet')) {
    const a = attrs(m.attrs);
    const name = a.name ?? '';
    const kind = bySheetName[compactHeader(name)];
    if (!kind) {
      if (compactHeader(name) !== compactHeader(SHEET_INSTRUCTIONS)) warnings.push({ key: 'sheet_ignored', params: { sheet: name.slice(0, 80) } });
      continue;
    }
    if (a.state === 'hidden' || a.state === 'veryHidden') {
      warnings.push({ key: 'sheet_hidden_ignored', params: { sheet: name } });
      continue;
    }
    const target = relTargets.get(a['r:id'] ?? '');
    if (!target || !byName.has(target)) throw new ImportError('import_malformed', { reason: 'sheet_part_missing' });
    if (wanted[kind] === null) wanted[kind] = target;
  }
  if (wanted.products === null) throw new ImportError('import_missing_sheet', { sheet: SHEET_PRODUCTS });

  const sharedXml = read('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedXml !== null) {
    assertSafeXml(sharedXml);
    for (const m of elements(sharedXml, 'si')) shared.push(textOf(m.inner));
  }
  const stylesXml = read('xl/styles.xml');
  if (stylesXml !== null) assertSafeXml(stylesXml);
  const dateXfs = stylesXml ? parseDateStyles(stylesXml) : new Set<number>();

  const parse = (kind: keyof typeof wanted, name: string, max: number): Grid | null => {
    const part = wanted[kind];
    if (part === null) return null;
    const xml = read(part);
    if (xml === null) throw new ImportError('import_malformed', { reason: 'sheet_part_missing' });
    return parseSheet(xml, { name, shared, dateXfs, date1904, maxDataRows: max });
  };
  const products = parse('products', SHEET_PRODUCTS, LIMITS.maxRows)!;
  const variants = parse('variants', SHEET_VARIANTS, LIMITS.maxChildRows);
  const tiers = parse('tiers', SHEET_TIERS, LIMITS.maxChildRows);
  return { products, variants, tiers, warnings };
}
