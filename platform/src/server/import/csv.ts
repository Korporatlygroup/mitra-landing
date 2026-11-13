import { ImportError } from './errors';
import { LIMITS } from './limits';

/** A grid of cells plus the 1-based spreadsheet row number of each record (blank lines still count). */
export interface Grid {
  rows: { rowNumber: number; cells: string[] }[];
  delimiter: ',' | ';';
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new ImportError('import_bad_encoding');
  }
}

function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === '\n' || ch === '\r') break;
      if (ch === ',') commas++;
      else if (ch === ';') semis++;
    }
  }
  return semis > commas ? ';' : ',';
}

/** RFC 4180 style parser: quoted fields, doubled quotes, CRLF/LF/CR line ends, embedded newlines in quotes. */
export function parseCsvText(text: string): Grid {
  const delimiter = detectDelimiter(text);
  const rows: Grid['rows'] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let atStart = true;
  let rowNumber = 1;

  const endField = () => {
    if (field.length > LIMITS.maxCellLength) throw new ImportError('import_cell_too_long', { row: rowNumber, max: LIMITS.maxCellLength });
    cells.push(field);
    field = '';
    atStart = true;
  };
  const endRecord = () => {
    endField();
    let last = cells.length;
    while (last > 0 && cells[last - 1] === '') last--;
    if (last > LIMITS.maxColumns) throw new ImportError('import_too_many_columns', { max: LIMITS.maxColumns });
    if (last > 0) rows.push({ rowNumber, cells: cells.slice(0, last) });
    cells = [];
    rowNumber++;
    if (rowNumber > LIMITS.maxRowIndex) throw new ImportError('import_too_many_rows', { max: LIMITS.maxRows });
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        field += ch;
        if (field.length > LIMITS.maxCellLength) throw new ImportError('import_cell_too_long', { row: rowNumber, max: LIMITS.maxCellLength });
      }
      continue;
    }
    if (ch === '"' && atStart) {
      inQuotes = true;
      atStart = false;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
    } else {
      field += ch;
      atStart = false;
    }
  }
  if (inQuotes) throw new ImportError('import_malformed', { reason: 'unterminated_quote' });
  if (field !== '' || cells.length > 0) endRecord();
  return { rows, delimiter };
}
