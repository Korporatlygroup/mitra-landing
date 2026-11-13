import { Inflate } from 'fflate';
import { ImportError } from './errors';
import { LIMITS } from './limits';

/**
 * Minimal, defensive ZIP reader (central directory based). It never extracts to disk, never trusts the
 * declared sizes (output is counted while inflating and aborted at the declared size), and refuses zip64,
 * encryption, unusual methods, path tricks, duplicate names, too many entries and oversize archives.
 */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function hasZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function listZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > LIMITS.maxCompressedBytes) throw new ImportError('import_too_large', { max: LIMITS.maxCompressedBytes });
  if (!hasZipMagic(bytes)) throw new ImportError('import_unsupported_file');
  // End Of Central Directory record: last 22..65557 bytes
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError('import_malformed', { reason: 'no_central_directory' });
  const total = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ImportError('import_unsupported_file', { reason: 'zip64' });
  if (total > LIMITS.maxZipEntries) throw new ImportError('import_too_large', { reason: 'entries', max: LIMITS.maxZipEntries });
  if (cdOffset + cdSize > eocd) throw new ImportError('import_malformed', { reason: 'bad_directory' });

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let declaredTotal = 0;
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ImportError('import_malformed', { reason: 'bad_entry' });
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    if (p + 46 + nameLen > bytes.length) throw new ImportError('import_malformed', { reason: 'bad_entry' });
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1 || flags & 0x40) throw new ImportError('import_unsupported_file', { reason: 'encrypted' });
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || name.includes('\0')) {
      throw new ImportError('import_unsupported_file', { reason: 'bad_path' });
    }
    if (names.has(name)) throw new ImportError('import_malformed', { reason: 'duplicate_entry' });
    names.add(name);
    if (name.endsWith('/')) continue;
    if (method !== 0 && method !== 8) throw new ImportError('import_unsupported_file', { reason: 'method' });
    if (size === 0xffffffff || compressedSize === 0xffffffff) throw new ImportError('import_unsupported_file', { reason: 'zip64' });
    declaredTotal += size;
    if (declaredTotal > LIMITS.maxUncompressedBytes) throw new ImportError('import_too_large', { reason: 'expansion', max: LIMITS.maxUncompressedBytes });
    entries.push({ name, method, compressedSize, size, localOffset });
  }
  return entries;
}

/** Inflate one entry; output is counted live and aborted if it exceeds the declared size or the shared budget. */
export function readEntry(bytes: Uint8Array, entry: ZipEntry, budget: { remaining: number }): Uint8Array {
  const o = entry.localOffset;
  if (o + 30 > bytes.length || u32(bytes, o) !== 0x04034b50) throw new ImportError('import_malformed', { reason: 'bad_local_header' });
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ImportError('import_malformed', { reason: 'truncated' });
  const data = bytes.subarray(start, end);
  if (entry.method === 0) {
    if (data.length !== entry.size) throw new ImportError('import_malformed', { reason: 'size_mismatch' });
    budget.remaining -= data.length;
    if (budget.remaining < 0) throw new ImportError('import_too_large', { reason: 'expansion' });
    return data;
  }
  const chunks: Uint8Array[] = [];
  let produced = 0;
  const inf = new Inflate();
  inf.ondata = (chunk) => {
    produced += chunk.length;
    budget.remaining -= chunk.length;
    if (produced > entry.size) throw new ImportError('import_too_large', { reason: 'expansion' });
    if (budget.remaining < 0) throw new ImportError('import_too_large', { reason: 'expansion' });
    chunks.push(chunk);
  };
  try {
    const STEP = 4096;
    if (data.length === 0) inf.push(data, true);
    for (let i = 0; i < data.length; i += STEP) inf.push(data.subarray(i, Math.min(i + STEP, data.length)), i + STEP >= data.length);
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('import_malformed', { reason: 'inflate' });
  }
  if (produced !== entry.size) throw new ImportError('import_malformed', { reason: 'size_mismatch' });
  const out = new Uint8Array(produced);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
