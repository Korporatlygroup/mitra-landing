import { describe, expect, it } from 'vitest';
import { crc32, pdfHasRiskyTokens, stripImageMetadata } from '@/lib/upload';
import { ingestDocument, type IngestDeps } from '@/server/services/documents';
import { createHash } from 'node:crypto';

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// ---- JPEG builders
const seg = (marker: number, payload: Uint8Array) => cat(new Uint8Array([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
const SOI = new Uint8Array([0xff, 0xd8]);
const EOI = new Uint8Array([0xff, 0xd9]);
const APP0 = seg(0xe0, enc('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'));
const EXIF = seg(0xe1, enc('Exif\0\0GPSLatitude=3.1390N secret'));
const XMP = seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'));
const IPTC = seg(0xed, enc('Photoshop 3.0\x008BIM'));
const COM = seg(0xfe, enc('shot by Someone at home'));
const ICC = seg(0xe2, enc('ICC_PROFILE\0abc'));
const SOS = seg(0xda, new Uint8Array([1, 1, 0, 0, 0x3f, 0]));
const DATA = new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]); // includes byte stuffing and an RST marker

describe('JPEG metadata stripping', () => {
  const dirty = cat(SOI, APP0, EXIF, XMP, IPTC, COM, ICC, SOS, DATA, EOI, enc('TRAILING-GARBAGE-GPS'));
  const r = stripImageMetadata(dirty, 'image/jpeg');

  it('drops APP1 (EXIF and XMP), APP13 and COM, keeps the rest and the image data, and removes trailing bytes', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hex(r.bytes)).toBe(hex(cat(SOI, APP0, ICC, SOS, DATA, EOI)));
    const text = Buffer.from(r.bytes).toString('latin1');
    for (const secret of ['GPSLatitude', 'xmpmeta', 'Photoshop', 'shot by', 'TRAILING']) expect(text).not.toContain(secret);
  });

  it('is a no-op on an already clean image', () => {
    const clean = cat(SOI, APP0, SOS, DATA, EOI);
    const out = stripImageMetadata(clean, 'image/jpeg');
    expect(out.ok && hex(out.bytes)).toBe(hex(clean));
  });

  it('handles several scans (progressive) after the first SOS', () => {
    const two = cat(SOI, EXIF, SOS, DATA, seg(0xc4, new Uint8Array([0, 1, 2])), SOS, DATA, EOI);
    const out = stripImageMetadata(two, 'image/jpeg');
    expect(out.ok && hex(out.bytes)).toBe(hex(cat(SOI, SOS, DATA, seg(0xc4, new Uint8Array([0, 1, 2])), SOS, DATA, EOI)));
  });

  it.each([
    ['no EOI', cat(SOI, APP0, SOS, DATA)],
    ['segment length past the end', cat(SOI, new Uint8Array([0xff, 0xe1, 0x10, 0x00, 1, 2, 3]))],
    ['segment length below 2', cat(SOI, new Uint8Array([0xff, 0xe1, 0x00, 0x01]))],
    ['junk between segments', cat(SOI, new Uint8Array([0x01, 0x02, 0x03, 0x04]))],
    ['missing SOI', cat(APP0, EOI)],
    ['truncated header', new Uint8Array([0xff, 0xd8, 0xff])],
  ])('rejects malformed JPEG: %s', (_n, bytes) => {
    expect(stripImageMetadata(bytes, 'image/jpeg')).toEqual({ ok: false });
  });
});

// ---- PNG builders
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
function chunk(type: string, data: Uint8Array, badCrc = false): Uint8Array {
  const td = cat(enc(type), data);
  return cat(u32(data.length), td, u32(badCrc ? crc32(td) ^ 1 : crc32(td)));
}
const SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = chunk('IHDR', cat(u32(1), u32(1), new Uint8Array([8, 2, 0, 0, 0])));
const IDAT = chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1]));
const IEND = chunk('IEND', new Uint8Array());
const meta = [
  chunk('tEXt', enc('Author\0Someone')),
  chunk('iTXt', enc('XML:com.adobe.xmp\0\0\0\0\0<x/>')),
  chunk('zTXt', enc('Comment\0\0zz')),
  chunk('eXIf', enc('MM\0*GPS')),
  chunk('tIME', new Uint8Array([7, 234, 11, 6, 12, 0, 0])),
];

describe('PNG metadata stripping', () => {
  it('known CRC-32 value (IEND)', () => {
    expect(crc32(enc('IEND'))).toBe(0xae426082);
  });

  it('drops tEXt, iTXt, zTXt, eXIf and tIME, keeps the other chunks with valid CRCs, removes trailing bytes', () => {
    const pHYs = chunk('pHYs', new Uint8Array([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]));
    const dirty = cat(SIG, IHDR, ...meta, pHYs, IDAT, meta[0], IEND, enc('TRAILING-SECRET'));
    const r = stripImageMetadata(dirty, 'image/png');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hex(r.bytes)).toBe(hex(cat(SIG, IHDR, pHYs, IDAT, IEND)));
    const text = Buffer.from(r.bytes).toString('latin1');
    for (const s of ['Someone', 'xmp', 'GPS', 'TRAILING']) expect(text).not.toContain(s);
  });

  it('rejects a kept chunk with a bad CRC, truncation, a missing IHDR and absurd lengths', () => {
    expect(stripImageMetadata(cat(SIG, IHDR, chunk('IDAT', new Uint8Array([1, 2, 3]), true), IEND), 'image/png')).toEqual({ ok: false });
    expect(stripImageMetadata(cat(SIG, IHDR, IDAT), 'image/png')).toEqual({ ok: false }); // no IEND
    expect(stripImageMetadata(cat(SIG, IDAT, IEND), 'image/png')).toEqual({ ok: false }); // IHDR not first
    expect(stripImageMetadata(cat(SIG, IHDR, u32(0xfffffff0), enc('IDAT'), IEND), 'image/png')).toEqual({ ok: false });
    expect(stripImageMetadata(cat(SIG, IHDR, IDAT.subarray(0, IDAT.length - 3)), 'image/png')).toEqual({ ok: false });
  });
});

describe('ingestion of images: scanned bytes are the stored bytes', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  function run(bytes: Uint8Array, name: string, mime: string) {
    const scanned: Uint8Array[] = [];
    const uploaded: Uint8Array[] = [];
    const registered: { sha256: string; size: number }[] = [];
    const rejected: string[] = [];
    const deps: IngestDeps = {
      scan: async (b) => {
        scanned.push(b);
        return { status: 'clean', engine: 'clamd' };
      },
      upload: async (_p, b) => {
        uploaded.push(b);
        return true;
      },
      remove: async () => true,
      register: async (i) => {
        registered.push({ sha256: i.sha256, size: i.size });
        return { ok: true, id: 'd' };
      },
      recordRejected: async (_o, _u, _c, reason) => {
        rejected.push(reason);
      },
      newId: () => 'id',
    };
    const result = ingestDocument(deps, { orgId: ORG, userId: USER, claimType: 'business_location', docType: 'address_proof', fileName: name, declaredMime: mime, bytes });
    return { result, scanned, uploaded, registered, rejected };
  }

  it('JPEG: the scanner receives exactly the bytes that are uploaded, metadata is gone, hash and size describe the stored bytes', async () => {
    const dirty = cat(SOI, APP0, EXIF, COM, SOS, DATA, EOI);
    const t = run(dirty, 'photo.jpg', 'image/jpeg');
    expect(await t.result).toMatchObject({ ok: true, scanStatus: 'clean' });
    expect(t.scanned).toHaveLength(1);
    expect(t.uploaded).toHaveLength(1);
    expect(hex(t.scanned[0])).toBe(hex(t.uploaded[0]));
    expect(hex(t.uploaded[0])).not.toBe(hex(dirty));
    expect(Buffer.from(t.uploaded[0]).toString('latin1')).not.toContain('GPSLatitude');
    expect(t.registered[0].sha256).toBe(createHash('sha256').update(t.uploaded[0]).digest('hex'));
    expect(t.registered[0].size).toBe(t.uploaded[0].length);
  });

  it('PNG: same guarantee', async () => {
    const dirty = cat(SIG, IHDR, ...meta, IDAT, IEND);
    const t = run(dirty, 'scan.png', 'image/png');
    await t.result;
    expect(hex(t.scanned[0])).toBe(hex(t.uploaded[0]));
    expect(hex(t.uploaded[0])).toBe(hex(cat(SIG, IHDR, IDAT, IEND)));
    expect(t.registered[0].sha256).toBe(createHash('sha256').update(t.uploaded[0]).digest('hex'));
  });

  it('PDFs are stored unchanged', async () => {
    const pdf = enc('%PDF-1.7\n1 0 obj <</Type /Catalog>> endobj\n%%EOF');
    const t = run(pdf, 'a.pdf', 'application/pdf');
    await t.result;
    expect(hex(t.uploaded[0])).toBe(hex(pdf));
    expect(hex(t.scanned[0])).toBe(hex(pdf));
  });

  it('a malformed image is rejected with file_unsafe_content, nothing scanned or stored, and the rejection is recorded', async () => {
    const t = run(cat(SIG, IHDR, IDAT), 'broken.png', 'image/png');
    expect(await t.result).toEqual({ ok: false, errorKey: 'file_unsafe_content' });
    expect(t.scanned).toHaveLength(0);
    expect(t.uploaded).toHaveLength(0);
    expect(t.rejected).toEqual(['unsafe_content']);
  });
});

describe('more risky PDF tokens', () => {
  it.each(['/AA', '/GoToR', '/GoToE', '/SubmitForm', '/ImportData', '/XFA'])('flags %s', (token) => {
    expect(pdfHasRiskyTokens(enc(`%PDF-1.7\n<</Type /Annot ${token} 5 0 R>>`))).toBe(true);
  });
  it('does not flag look-alike names', () => {
    expect(pdfHasRiskyTokens(enc('%PDF-1.7\n<</Type /AAPL /Foo /GoToRight /XFAmily>>'))).toBe(false);
  });
});
