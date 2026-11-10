import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header. Returns false when the secret is unset or empty
 * (the endpoint is then disabled). Both sides are hashed first so the comparison length never leaks.
 */
export function bearerMatches(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = header.match(/^Bearer (.+)$/);
  if (!m) return false;
  const a = createHash('sha256').update(m[1]).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

/** RFC 5987 value for Content-Disposition `filename*` (UTF-8, percent-encoded, including the characters encodeURIComponent keeps). */
export function contentDispositionAttachment(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}

export const ALLOWED_DOWNLOAD_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);
