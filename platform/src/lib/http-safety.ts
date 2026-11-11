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

// ---------------------------------------------------------------------------------------------------------------
// Phase 5: guards for cookie-authenticated POST route handlers (file uploads).
// ---------------------------------------------------------------------------------------------------------------

type HeaderReader = { get(name: string): string | null };

/**
 * CSRF guard for cookie-authenticated POST routes. A browser always sends `Origin` on cross-site POSTs, and `Sec-Fetch-Site`
 * on modern browsers; a request is accepted only when the Origin host equals the Host header (or the request URL host), or, without
 * an Origin, when Sec-Fetch-Site says same-origin or none. Anything else (no signal at all, `Origin: null`, another site) is refused.
 */
export function isSameOriginRequest(headers: HeaderReader, requestUrl: string): boolean {
  const origin = headers.get('origin');
  if (origin) {
    try {
      const host = headers.get('host') ?? new URL(requestUrl).host;
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const site = headers.get('sec-fetch-site');
  return site === 'same-origin' || site === 'none';
}

/** Multipart overhead allowed on top of the file limit (boundaries, other fields). */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Body-size guard decided from Content-Length BEFORE the body is read. A missing or invalid length is refused (chunked bodies
 * cannot be bounded cheaply), as is anything above `maxFileBytes` plus the multipart overhead.
 */
export function contentLengthVerdict(headers: HeaderReader, maxFileBytes: number): 'ok' | 'missing' | 'too_large' {
  const raw = headers.get('content-length');
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 0) return 'missing';
  return n > maxFileBytes + MULTIPART_OVERHEAD_BYTES ? 'too_large' : 'ok';
}

/** Content type for serving a stored product image. Only these are ever served inline. */
export const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
