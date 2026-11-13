import { createHmac } from 'node:crypto';

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('invalid base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s step). */
export function totp(secretBase32: string, atMs = Date.now(), digits = 6, step = 30): string {
  const counter = Math.floor(atMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(buf).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const code = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

const used = new Set<string>();
/** A code not yet used by this process (the server accepts one step of clock skew either way). */
export function freshCode(secret: string): string {
  for (const delta of [0, 30_000, -30_000]) {
    const c = totp(secret, Date.now() + delta);
    const k = `${secret}:${c}`;
    if (!used.has(k)) {
      used.add(k);
      return c;
    }
  }
  return totp(secret);
}

/** A well-formed 6-digit code that is certainly wrong right now. */
export function wrongCode(secret: string): string {
  const valid = new Set([-30_000, 0, 30_000, -60_000, 60_000].map((d) => totp(secret, Date.now() + d)));
  for (let n = 123456; ; n++) {
    const c = String(n % 1_000_000).padStart(6, '0');
    if (!valid.has(c)) return c;
  }
}
