import { createHash } from 'node:crypto';
import type { RowIssue } from './errors';
import type { DraftData, ImportResult, RowResult } from './validate';
import { toCsv } from './text';

/** SHA-256 (hex) of the uploaded bytes: the idempotency key for stage/commit retries. */
export function fileSha256(buffer: Uint8Array | ArrayBuffer): string {
  return createHash('sha256').update(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)).digest('hex');
}

/** One element of the staging RPC's `p_rows`: a flat draft object plus `_row` (the spreadsheet row number). */
export type RpcRow = { _row: number } & DraftData & { _client_invalid?: string[] };

export interface RpcOptions {
  /**
   * What to do with rows this engine rejected.
   *  - 'flag' (default): send them too (best-effort raw values) with `_client_invalid: ["field:key", ...]`, a key the SQL
   *    validator does not know, so the database also marks the row invalid (`unknown_field:_client_invalid`). Row counts then
   *    match the file, and a row that this engine rejected can never become valid in the database.
   *  - 'omit': send only rows that passed.
   */
  invalid?: 'flag' | 'omit';
}

/**
 * The JSON array passed to the staging RPC as `p_rows`. Deterministic: file order, fixed key order. Contains no
 * supplier_code and no sheet status (the supplier is an RPC argument; importing only ever creates or updates drafts) and
 * never the raw cells. The database re-validates every row; its validator is the authority.
 */
export function canonicalRowsForRpc(rows: RowResult[], opts: RpcOptions = {}): RpcRow[] {
  const mode = opts.invalid ?? 'flag';
  const out: RpcRow[] = [];
  for (const r of rows) {
    if (r.status === 'valid') out.push({ _row: r.rowNumber, ...r.data });
    else if (mode === 'flag') out.push({ _row: r.rowNumber, ...r.data, _client_invalid: r.errors.map((e) => `${e.field}:${e.key}`) });
  }
  return out;
}

export type IssueFormatter = (issue: RowIssue) => string;

const defaultFormat: IssueFormatter = (i) => {
  const p = i.params && Object.keys(i.params).length ? ` (${Object.entries(i.params).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : String(v)}`).join(', ')})` : '';
  return `${i.field}: ${i.key}${p}`;
};

/**
 * CSV containing only the rows that failed (invalid or duplicate), the original Products columns, and an extra
 * `errors` column so a partner can fix and re-upload. Every cell is formula-neutralised. Variants/PriceTiers
 * sheet problems are listed as extra lines. `format` lets the caller translate issues; default is "field: key".
 */
export function buildErrorReportCsv(result: ImportResult, format: IssueFormatter = defaultFormat): string {
  const header = ['row_number', ...result.columns, 'errors'];
  const lines: string[][] = [header];
  for (const r of result.rows) {
    if (r.status === 'valid') continue;
    lines.push([String(r.rowNumber), ...result.columns.map((c) => r.raw[c] ?? ''), r.errors.map(format).join(' | ')]);
  }
  const skuCol = result.columns.indexOf('sku');
  for (const f of result.fileErrors) {
    const row = new Array<string>(header.length).fill('');
    row[0] = String(f.rowNumber);
    if (skuCol >= 0) row[1 + skuCol] = f.sku;
    row[header.length - 1] = `${f.sheet}: ${f.field}: ${f.key}`;
    lines.push(row);
  }
  return toCsv(lines);
}
