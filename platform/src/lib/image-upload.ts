import { REJECT_ERROR_KEY, stripImageMetadata, type RejectReason, type StripResult } from './upload';

/**
 * Product images: png, jpeg or webp, at most 5 MiB. Extension, declared MIME type and the file's own magic bytes must agree,
 * the pixel size is bounded (decompression bombs), and embedded metadata (EXIF, XMP, text chunks) is stripped before the file is hashed,
 * scanned and stored. Pure and dependency-free.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_SIDE = 12_000;

export type ImageKind = 'png' | 'jpeg' | 'webp';

const KINDS: Record<ImageKind, { mime: string; exts: readonly string[]; storageExt: string }> = {
  png: { mime: 'image/png', exts: ['png'], storageExt: 'png' },
  jpeg: { mime: 'image/jpeg', exts: ['jpg', 'jpeg'], storageExt: 'jpg' },
  webp: { mime: 'image/webp', exts: ['webp'], storageExt: 'webp' },
};

const ascii = (b: Uint8Array, off: number, len: number) => String.fromCharCode(...b.subarray(off, off + len));
const startsWith = (b: Uint8Array, sig: readonly number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const le24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];

export function detectImageKind(b: Uint8Array): ImageKind | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  return null;
}

/** Pixel size from the file header, or null when it cannot be read (the file is then rejected). */
export function imageSize(b: Uint8Array, kind: ImageKind): { width: number; height: number } | null {
  try {
    if (kind === 'png') {
      if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
      return { width: be32(b, 16), height: be32(b, 20) };
    }
    if (kind === 'jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        if (m === 0xff) {
          i++;
          continue;
        }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: be16(b, i + 5), width: be16(b, i + 7) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
          i += 2;
          continue;
        }
        i += 2 + be16(b, i + 2);
      }
      return null;
    }
    // webp: first image chunk
    let o = 12;
    while (o + 8 <= b.length) {
      const type = ascii(b, o, 4);
      const size = le32(b, o + 4);
      const d = o + 8;
      if (type === 'VP8X' && d + 10 <= b.length) return { width: le24(b, d + 4) + 1, height: le24(b, d + 7) + 1 };
      if (type === 'VP8 ' && d + 10 <= b.length) return { width: (b[d + 6] | (b[d + 7] << 8)) & 0x3fff, height: (b[d + 8] | (b[d + 9] << 8)) & 0x3fff };
      if (type === 'VP8L' && d + 5 <= b.length) {
        const bits = le32(b, d + 1);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      o = d + size + (size & 1);
    }
    return null;
  } catch {
    return null;
  }
}

/** Drops EXIF and XMP chunks (and their VP8X flags). Chunk sizes are bounds-checked; trailing bytes after the RIFF payload are removed. */
export function stripWebp(b: Uint8Array): StripResult {
  if (b.length < 20 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return { ok: false };
  const riffEnd = 8 + le32(b, 4);
  if (riffEnd > b.length || riffEnd < 20) return { ok: false };
  const parts: Uint8Array[] = [];
  let o = 12;
  let sawImage = false;
  while (o < riffEnd) {
    if (o + 8 > riffEnd) return { ok: false };
    const type = ascii(b, o, 4);
    const size = le32(b, o + 4);
    const end = o + 8 + size + (size & 1);
    if (end > riffEnd + 1 || o + 8 + size > riffEnd) return { ok: false };
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') sawImage = true;
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = b.slice(o, Math.min(end, riffEnd));
      if (type === 'VP8X') {
        if (size < 10) return { ok: false };
        chunk[8] &= ~(0x08 | 0x04); // EXIF and XMP flags
      }
      parts.push(chunk);
    }
    o = end;
  }
  if (!sawImage) return { ok: false };
  const payload = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(12 + payload);
  out.set(b.subarray(0, 12), 0);
  new DataView(out.buffer).setUint32(4, 4 + payload, true);
  let w = 12;
  for (const p of parts) {
    out.set(p, w);
    w += p.length;
  }
  return { ok: true, bytes: out };
}

export type ImageValidation =
  | { ok: true; kind: ImageKind; mime: string; storageExt: string }
  | { ok: false; reason: RejectReason; errorKey: string };

const reject = (reason: RejectReason): ImageValidation => ({ ok: false, reason, errorKey: REJECT_ERROR_KEY[reason] });

export function validateImageUpload(input: { fileName: string; declaredMime: string; bytes: Uint8Array }): ImageValidation {
  const { bytes } = input;
  if (bytes.length === 0) return reject('empty');
  if (bytes.length > MAX_IMAGE_BYTES) return reject('too_large');
  const ext = (input.fileName.split(/[\\/]/).pop() ?? '').split('.').slice(1).pop()?.toLowerCase() ?? '';
  const kind = detectImageKind(bytes);
  if (!kind) return reject('bad_type');
  const spec = KINDS[kind];
  if (!spec.exts.includes(ext) || input.declaredMime.trim().toLowerCase() !== spec.mime) return reject('bad_type');
  const size = imageSize(bytes, kind);
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || size.width * size.height > MAX_IMAGE_PIXELS) {
    return reject('unsafe_content');
  }
  return { ok: true, kind, mime: spec.mime, storageExt: spec.storageExt };
}

/** Removes embedded metadata from a validated image (png, jpeg or webp). Malformed structure is rejected. */
export function stripImage(bytes: Uint8Array, kind: ImageKind): StripResult {
  if (kind === 'webp') {
    try {
      return stripWebp(bytes);
    } catch {
      return { ok: false };
    }
  }
  return stripImageMetadata(bytes, KINDS[kind].mime);
}
