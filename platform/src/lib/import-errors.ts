import { ROW_ERROR_KEYS } from '@/server/import/errors';
import { splitErrorKey } from './partner-ui';

/** Minimal shape of a next-intl translator (server or client). */
export interface Tr {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
}

const ROW_KEYS = new Set<string>(ROW_ERROR_KEYS);

/**
 * Splits one stored row error into {field, key}. Two shapes exist: the database's `key` or `key:detail` (detail = a field name or an index), and
 * the import engine's `field:key` for rows it rejected itself (the key is one of ROW_ERROR_KEYS, which never appears as a database detail).
 */
export function parseRowError(raw: string): { key: string; field: string | null; index: number | null } {
  const { key, detail } = splitErrorKey(raw);
  if (detail && ROW_KEYS.has(detail)) return { key: detail, field: key, index: null };
  if (detail && /^\d{1,3}$/.test(detail)) return { key, field: null, index: Number(detail) };
  return { key, field: detail && /^[a-z_]{2,40}(\[\d+\])?$/.test(detail) ? detail : null, index: null };
}

/**
 * Plain-language text for one row error. `t` is the `p5partner.import` translator and `te` the `errors` translator. Every key resolves to
 * `p5partner.import.errors.<key>` first, then to the shared `errors.<key>` message, and last to a generic sentence, so a row never shows a code.
 */
export function importErrorText(t: Tr, te: Tr, raw: string): string {
  const { key, field, index } = parseRowError(raw);
  const msg = t.has(`errors.${key}`) ? t(`errors.${key}`) : te.has(key) ? te(key) : t('errors.unknown');
  const where = field ? (t.has(`fields.${field}`) ? t(`fields.${field}`) : field) : index != null ? t('rowPart', { n: index }) : null;
  return where ? `${where}: ${msg}` : msg;
}
