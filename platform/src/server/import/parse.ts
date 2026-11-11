import { decodeUtf8, parseCsvText, type Grid } from './csv';
import { ImportError, type Warning } from './errors';
import { LIMITS } from './limits';
import { PRODUCT_SPEC, SHEET_TIERS, SHEET_VARIANTS, TIER_SPEC, VARIANT_SPEC, mapHeaders, type SheetSpec } from './columns';
import { hasZipMagic } from './zip';
import { readXlsx } from './xlsx-read';

export type CatalogueFormat = 'csv' | 'xlsx';

/** One spreadsheet row with raw (un-normalised) string cells keyed by canonical column name. */
export interface RawRow {
  /** 1-based spreadsheet row number; header is row 1, first data row is row 2 */
  rowNumber: number;
  cells: Record<string, string>;
}
export interface RawChildRow extends RawRow {
  sheet: string;
}

export interface ParsedCatalogue {
  format: CatalogueFormat;
  fileName: string;
  /** canonical Products columns present in the file, in file order */
  columns: string[];
  rows: RawRow[];
  variantRows: RawChildRow[];
  tierRows: RawChildRow[];
  warnings: Warning[];
}

type Bytes = Uint8Array | ArrayBuffer;

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

function toBytes(b: Bytes): Uint8Array {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i < 0 ? '' : base.slice(i + 1).toLowerCase();
}

function gridToRows(grid: Grid, spec: SheetSpec, sheet: string | undefined, warnings: Warning[]): { columns: string[]; rows: RawRow[] } {
  if (grid.rows.length === 0) throw new ImportError('import_empty');
  const header = grid.rows[0];
  if (header.cells.length > LIMITS.maxColumns) throw new ImportError('import_too_many_columns', { max: LIMITS.maxColumns });
  const mapping = mapHeaders(header.cells, spec, sheet);
  warnings.push(...mapping.warnings);
  if (mapping.missing.length) throw new ImportError('import_missing_columns', { columns: mapping.missing, ...(sheet ? { sheet } : {}) });
  const rows: RawRow[] = [];
  for (const r of grid.rows.slice(1)) {
    const cells: Record<string, string> = {};
    for (const c of mapping.present) cells[c] = '';
    r.cells.forEach((value, idx) => {
      const canon = mapping.columns[idx];
      if (canon) cells[canon] = value;
    });
    if (Object.values(cells).every((v) => v.trim() === '')) continue;
    rows.push({ rowNumber: r.rowNumber, cells });
  }
  return { columns: mapping.present, rows };
}

/**
 * Parse a CSV or XLSX catalogue file (data only, no database, no network) into raw rows.
 * Throws ImportError (typed, with an error key) for refused files.
 */
export function parseCatalogueFile(buffer: Bytes, fileName: string): ParsedCatalogue {
  const bytes = toBytes(buffer);
  const ext = extensionOf(fileName);
  if (ext !== 'csv' && ext !== 'xlsx') throw new ImportError('import_unsupported_file', { extension: ext.slice(0, 10) });
  if (bytes.length === 0) throw new ImportError('import_empty');
  if (bytes.length > LIMITS.maxCompressedBytes) throw new ImportError('import_too_large', { max: LIMITS.maxCompressedBytes });

  const warnings: Warning[] = [];
  if (ext === 'csv') {
    if (hasZipMagic(bytes) || OLE_MAGIC.every((b, i) => bytes[i] === b) || bytes.includes(0)) throw new ImportError('import_unsupported_file', { reason: 'not_text' });
    const grid = parseCsvText(decodeUtf8(bytes));
    const { columns, rows } = gridToRows(grid, PRODUCT_SPEC, undefined, warnings);
    if (rows.length === 0) throw new ImportError('import_empty');
    if (rows.length > LIMITS.maxRows) throw new ImportError('import_too_many_rows', { max: LIMITS.maxRows });
    return { format: 'csv', fileName, columns, rows, variantRows: [], tierRows: [], warnings };
  }

  if (!hasZipMagic(bytes)) throw new ImportError('import_unsupported_file', { reason: 'not_zip' });
  const sheets = readXlsx(bytes);
  warnings.push(...sheets.warnings);
  const products = gridToRows(sheets.products, PRODUCT_SPEC, undefined, warnings);
  if (products.rows.length === 0) throw new ImportError('import_empty');
  if (products.rows.length > LIMITS.maxRows) throw new ImportError('import_too_many_rows', { max: LIMITS.maxRows });
  const child = (grid: Grid | null, spec: SheetSpec, sheet: string): RawChildRow[] => {
    if (!grid || grid.rows.length === 0) return [];
    return gridToRows(grid, spec, sheet, warnings).rows.map((r) => ({ ...r, sheet }));
  };
  return {
    format: 'xlsx',
    fileName,
    columns: products.columns,
    rows: products.rows,
    variantRows: child(sheets.variants, VARIANT_SPEC, SHEET_VARIANTS),
    tierRows: child(sheets.tiers, TIER_SPEC, SHEET_TIERS),
    warnings,
  };
}
