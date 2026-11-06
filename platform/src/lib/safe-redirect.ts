/**
 * Returns `candidate` only if it is a same-origin relative path ("/something"); otherwise `fallback`.
 * Rejects protocol-relative ("//evil.com"), backslash tricks ("/\evil.com"), absolute URLs, "javascript:" and
 * any control character (browsers strip tab/newline, which could turn "/\t/evil.com" into "//evil.com").
 */
export function safeRedirectPath(candidate: string | null | undefined, fallback = '/'): string {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 2000) return fallback;
  if (candidate[0] !== '/') return fallback;
  if (candidate[1] === '/' || candidate[1] === '\\') return fallback;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || candidate[i] === '\\') return fallback;
  }
  return candidate;
}

/** Rewrites a leading "/en/" or "/ta/" segment of an (already safe) path to `locale`. Other paths are unchanged. */
export function retargetLocale(path: string, locale: string): string {
  return path.replace(/^\/(en|ta)(?=\/|$|\?)/, `/${locale}`);
}
