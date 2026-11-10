/**
 * Pure upload validation: size, type allow-list, magic bytes, risky PDF content and file-name hygiene.
 * Extension, declared MIME type and the file's own magic bytes must all agree.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type FileKind = 'pdf' | 'png' | 'jpeg';

const KINDS: Record<FileKind, { mime: string; exts: readonly string[]; storageExt: string }> = {
  pdf: { mime: 'application/pdf', exts: ['pdf'], storageExt: 'pdf' },
  png: { mime: 'image/png', exts: ['png'], storageExt: 'png' },
  jpeg: { mime: 'image/jpeg', exts: ['jpg', 'jpeg'], storageExt: 'jpg' },
};

export type RejectReason = 'empty' | 'too_large' | 'bad_type' | 'unsafe_content';

/** Message keys (errors.*) per rejection reason. */
export const REJECT_ERROR_KEY: Record<RejectReason, string> = {
  empty: 'file_empty',
  too_large: 'file_too_large',
  bad_type: 'file_type_not_allowed',
  unsafe_content: 'file_unsafe_content',
};

const startsWith = (b: Uint8Array, sig: readonly number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];

/** Type implied by the leading bytes, or null. */
export function detectKind(bytes: Uint8Array): FileKind | null {
  if (startsWith(bytes, PDF_SIG)) return 'pdf';
  if (startsWith(bytes, PNG_SIG)) return 'png';
  if (startsWith(bytes, JPEG_SIG)) return 'jpeg';
  return null;
}

const RISKY = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA|GoToR|GoToE|SubmitForm|ImportData|XFA)(?![A-Za-z0-9])/;

/**
 * True when a PDF carries active-content markers. Name obfuscation (/J#61vaScript) is decoded first.
 * Stream bodies are skipped: binary data inside compressed streams would otherwise match by chance.
 * ADVISORY ONLY: this is a cheap heuristic, not a PDF sanitiser. Markers hidden inside compressed object streams
 * are not visible here. The antivirus scan (clamd) is the actual control; without it files stay quarantined.
 */
export function pdfHasRiskyTokens(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes).toString('latin1');
  const outsideStreams = text.replace(/stream\r?\n[\s\S]*?endstream/g, ' ');
  const decoded = outsideStreams.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return RISKY.test(decoded);
}

export type ValidationResult =
  | { ok: true; kind: FileKind; mime: string; storageExt: string }
  | { ok: false; reason: RejectReason; errorKey: string };

const reject = (reason: RejectReason): ValidationResult => ({ ok: false, reason, errorKey: REJECT_ERROR_KEY[reason] });

export function validateUpload(input: { fileName: string; declaredMime: string; bytes: Uint8Array }): ValidationResult {
  const { bytes } = input;
  if (bytes.length === 0) return reject('empty');
  if (bytes.length > MAX_UPLOAD_BYTES) return reject('too_large');

  const ext = (input.fileName.split(/[\\/]/).pop() ?? '').split('.').slice(1).pop()?.toLowerCase() ?? '';
  const kind = detectKind(bytes);
  if (!kind) return reject('bad_type');
  const spec = KINDS[kind];
  if (!spec.exts.includes(ext)) return reject('bad_type');
  if (input.declaredMime.trim().toLowerCase() !== spec.mime) return reject('bad_type');

  if (kind === 'pdf' && pdfHasRiskyTokens(bytes)) return reject('unsafe_content');
  return { ok: true, kind, mime: spec.mime, storageExt: spec.storageExt };
}

const MAX_NAME = 120;

/**
 * Display-name hygiene: no path components, no control / bidi-override / separator characters, no leading dots,
 * no characters that are awkward in headers, at most 120 characters.
 */
export function sanitizeFileName(raw: string): string {
  const last = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = [...last]
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return false;
      if (c === 0x2028 || c === 0x2029) return false;
      if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x200e || c === 0x200f) return false;
      return true;
    })
    .join('')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const limited = [...cleaned].slice(0, MAX_NAME).join('').trim();
  return limited || 'document';
}

/** Storage object path: org / claim type / random id + extension derived from the validated type (never the file name). */
export function storagePathFor(orgId: string, claimType: string, id: string, storageExt: string): string {
  return `${orgId}/${claimType}/${id}.${storageExt}`;
}


// ---------------------------------------------------------------------------------------------------------------
// Image metadata stripping (privacy: EXIF GPS, XMP, comments). No dependencies.
// ---------------------------------------------------------------------------------------------------------------

export type StripResult = { ok: true; bytes: Uint8Array } | { ok: false };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

/** Drops text/EXIF/time chunks; every kept chunk's CRC is verified. Trailing bytes after IEND are removed. */
function stripPng(b: Uint8Array): StripResult {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let off = 8;
  let first = true;
  for (;;) {
    if (off + 12 > b.length) return { ok: false };
    const len = dv.getUint32(off);
    const end = off + 12 + len;
    if (len > 0x7fffffff || end > b.length) return { ok: false };
    const type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    if (!/^[A-Za-z]{4}$/.test(type)) return { ok: false };
    if (first && type !== 'IHDR') return { ok: false };
    first = false;
    const chunk = b.subarray(off, end);
    if (!PNG_DROP.has(type)) {
      if (crc32(b.subarray(off + 4, off + 8 + len)) !== dv.getUint32(off + 8 + len)) return { ok: false };
      out.push(chunk);
    }
    off = end;
    if (type === 'IEND') break;
  }
  return { ok: true, bytes: concat(out) };
}

const concat = (parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Drops APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) and COM segments. Image data is kept; data after EOI is removed. */
function stripJpeg(b: Uint8Array): StripResult {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return { ok: false };
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  for (;;) {
    // find the next marker (skip fill bytes)
    if (i >= b.length || b[i] !== 0xff) return { ok: false };
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) return { ok: false };
    const marker = b[i++];
    const start = i - 2;
    if (marker === 0xd9) {
      out.push(new Uint8Array([0xff, 0xd9]));
      return { ok: true, bytes: concat(out) };
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      if (marker === 0x00) return { ok: false };
      out.push(b.subarray(start, i));
      continue;
    }
    if (i + 2 > b.length) return { ok: false };
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2 || i + len > b.length) return { ok: false };
    const segEnd = i + len;
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) out.push(b.subarray(start, segEnd));
    i = segEnd;
    if (marker === 0xda) {
      // entropy-coded data: runs until the next real marker (FF followed by neither 00 nor RSTn)
      const dataStart = i;
      while (i + 1 < b.length) {
        if (b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7) && b[i + 1] !== 0xff) break;
        i++;
      }
      if (i + 1 >= b.length) return { ok: false };
      out.push(b.subarray(dataStart, i));
    }
  }
}

/** Removes embedded metadata from a validated PNG or JPEG. Malformed structure is rejected (ok: false). */
export function stripImageMetadata(bytes: Uint8Array, mime: string): StripResult {
  try {
    if (mime === 'image/png') return stripPng(bytes);
    if (mime === 'image/jpeg') return stripJpeg(bytes);
  } catch {
    return { ok: false };
  }
  return { ok: true, bytes };
}
