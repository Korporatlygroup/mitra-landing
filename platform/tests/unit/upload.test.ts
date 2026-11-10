import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, detectKind, pdfHasRiskyTokens, sanitizeFileName, storagePathFor, validateUpload } from '@/lib/upload';

const enc = (s: string) => new TextEncoder().encode(s);
const pdf = (body = '1 0 obj <</Type /Catalog>> endobj\n%%EOF') => enc(`%PDF-1.7\n${body}`);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

describe('magic-byte detection', () => {
  it('recognises PDF, PNG and JPEG', () => {
    expect(detectKind(pdf())).toBe('pdf');
    expect(detectKind(png())).toBe('png');
    expect(detectKind(jpeg())).toBe('jpeg');
  });
  it('rejects everything else', () => {
    expect(detectKind(enc('MZ\x90\x00'))).toBeNull();
    expect(detectKind(enc('<html></html>'))).toBeNull();
    expect(detectKind(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // "%PDF" without the dash
    expect(detectKind(new Uint8Array())).toBeNull();
  });
});

describe('validateUpload', () => {
  it('accepts each type when extension, declared MIME and bytes agree', () => {
    expect(validateUpload({ fileName: 'ssm.pdf', declaredMime: 'application/pdf', bytes: pdf() })).toMatchObject({ ok: true, kind: 'pdf', storageExt: 'pdf' });
    expect(validateUpload({ fileName: 'a.PNG', declaredMime: 'image/png', bytes: png() })).toMatchObject({ ok: true, kind: 'png' });
    expect(validateUpload({ fileName: 'a.jpg', declaredMime: 'image/jpeg', bytes: jpeg() })).toMatchObject({ ok: true, storageExt: 'jpg' });
    expect(validateUpload({ fileName: 'a.jpeg', declaredMime: 'image/jpeg', bytes: jpeg() })).toMatchObject({ ok: true, storageExt: 'jpg' });
  });

  it('rejects zero bytes and oversize', () => {
    expect(validateUpload({ fileName: 'a.pdf', declaredMime: 'application/pdf', bytes: new Uint8Array() })).toMatchObject({ ok: false, reason: 'empty', errorKey: 'file_empty' });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(pdf());
    expect(validateUpload({ fileName: 'a.pdf', declaredMime: 'application/pdf', bytes: big })).toMatchObject({ ok: false, reason: 'too_large', errorKey: 'file_too_large' });
    const exactly = new Uint8Array(MAX_UPLOAD_BYTES);
    exactly.set(pdf());
    expect(validateUpload({ fileName: 'a.pdf', declaredMime: 'application/pdf', bytes: exactly }).ok).toBe(true);
  });

  it.each([
    ['executable renamed .pdf', 'a.pdf', 'application/pdf', enc('MZ\x90\x00\x03')],
    ['html renamed .png', 'a.png', 'image/png', enc('<script>alert(1)</script>')],
    ['PNG bytes with .pdf name', 'a.pdf', 'application/pdf', png()],
    ['PDF bytes with .png name', 'a.png', 'image/png', pdf()],
    ['JPEG bytes declared as PNG', 'a.jpg', 'image/png', jpeg()],
    ['PDF with wrong declared mime', 'a.pdf', 'text/html', pdf()],
    ['PDF with empty declared mime', 'a.pdf', '', pdf()],
    ['no extension', 'a', 'application/pdf', pdf()],
    ['double extension ending in exe', 'a.pdf.exe', 'application/pdf', pdf()],
    ['svg', 'a.svg', 'image/svg+xml', enc('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['gif', 'a.gif', 'image/gif', enc('GIF89a')],
  ])('rejects spoofed or unsupported file: %s', (_n, fileName, declaredMime, bytes) => {
    expect(validateUpload({ fileName, declaredMime, bytes })).toMatchObject({ ok: false, reason: 'bad_type', errorKey: 'file_type_not_allowed' });
  });

  it.each(['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia', '/OpenAction'])('rejects a PDF containing %s', (token) => {
    const bytes = pdf(`1 0 obj <</Type /Action ${token} (app.alert(1))>> endobj`);
    expect(validateUpload({ fileName: 'a.pdf', declaredMime: 'application/pdf', bytes })).toMatchObject({ ok: false, reason: 'unsafe_content', errorKey: 'file_unsafe_content' });
  });

  it('decodes name obfuscation (/J#61vaScript)', () => {
    expect(pdfHasRiskyTokens(pdf('<</S /J#61vaScript>>'))).toBe(true);
    expect(pdfHasRiskyTokens(pdf('<</Open#41ction 5 0 R>>'.replace('Open#41ction', '/Open#41ction')))).toBe(true);
  });

  it('does not flag harmless names or token-like bytes inside stream bodies', () => {
    expect(pdfHasRiskyTokens(pdf('<</Type /JSONish /Subtype /Form>>'))).toBe(false);
    expect(pdfHasRiskyTokens(pdf('<</Length 20>>\nstream\nxx /JS yy /Launch zz\nendstream\nendobj'))).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('strips path components', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\ssm.pdf')).toBe('ssm.pdf');
    expect(sanitizeFileName('/tmp/x/y.png')).toBe('y.png');
  });
  it('strips control characters, line separators and bidi overrides', () => {
    const sep = String.fromCharCode(0x2028);
    const rlo = String.fromCharCode(0x202e);
    expect(sanitizeFileName(`a\r\nb\u0000c${sep}d${rlo}e.pdf`)).toBe('abcde.pdf');
    expect(sanitizeFileName('x\u0085y.pdf')).toBe('xy.pdf');
  });
  it('removes header-awkward characters and leading dots, collapses spaces', () => {
    expect(sanitizeFileName('  .hidden   file "x".pdf ')).toBe('hidden file _x_.pdf');
    expect(sanitizeFileName('a<b>c|d?.pdf')).toBe('a_b_c_d_.pdf');
  });
  it('limits to 120 characters and falls back when empty', () => {
    expect([...sanitizeFileName('a'.repeat(300) + '.pdf')]).toHaveLength(120);
    expect(sanitizeFileName('')).toBe('document');
    expect(sanitizeFileName('\u0000\u0001')).toBe('document');
    expect(sanitizeFileName('...')).toBe('document');
  });
});

describe('storagePathFor', () => {
  it('uses the validated extension, never the file name', () => {
    expect(storagePathFor('org-1', 'business_location', 'uuid-1', 'pdf')).toBe('org-1/business_location/uuid-1.pdf');
  });
});
