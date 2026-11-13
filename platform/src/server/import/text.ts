/** Text hygiene for imports and exports: unicode normalisation, control characters, formula injection. */

// C0 controls except \n (kept for multiline fields) and \t (turned into a space), C1 controls, zero-width
// space, directional marks/overrides/isolates, BOM. Zero-width joiners are kept (some scripts need them).
const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const DANGEROUS_FIRST = new Set(['=', '+', '-', '@', '\t', '\r']);

/** True if a spreadsheet application could treat the text as a formula. Checks the raw text. */
export function startsWithFormulaChar(raw: string): boolean {
  // leading spaces / NBSP / zero-width / newlines do not make a formula safe in every application
  const s = raw.replace(/^[ \u00A0\u200B\uFEFF\n]+/, '');
  return s.length > 0 && DANGEROUS_FIRST.has(s[0]);
}

/** Normalise one cell value: NFC, strip control chars, tidy whitespace, trim. */
export function cleanText(raw: string, multiline = false): string {
  let s = raw.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(STRIP, '');
  if (multiline) {
    s = s
      .split('\n')
      .map((l) => l.replace(/[ \u00A0]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return s.trim();
}

/** Neutralise formula injection for an exported cell: prefix a single quote. Numbers and null pass through safely. */
export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = (typeof value === 'string' ? value : String(value)).replace(/\u0000/g, '');
  const cleaned = s.replace(/^[ \u00A0\u200B\uFEFF\n]+/, '');
  if (cleaned.length > 0 && DANGEROUS_FIRST.has(cleaned[0])) return `'${s}`;
  return s;
}

/** RFC 4180 CSV writer (CRLF). Every cell goes through safeCell. Prefixed with a UTF-8 BOM so Excel reads Tamil/Malay correctly. */
export function toCsv(rows: string[][]): string {
  const q = (cell: string) => {
    const c = safeCell(cell);
    return /[",\r\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c;
  };
  return '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
