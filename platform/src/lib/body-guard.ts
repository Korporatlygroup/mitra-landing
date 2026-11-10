/**
 * Cheap mitigation for the large (16 MB) body limits that next.config.ts needs for document uploads: those limits
 * apply to every proxied route. Only the two pages that host the upload form may send a big body; any other POST that
 * announces more than 1 MB is refused (413) before Next buffers it.
 *
 * Limits of this guard: it trusts Content-Length (a chunked request without it is not caught) and it does not cover
 * /api and /auth, which the proxy skips. Edge / WAF body limits remain the real control.
 */
export const MAX_PLAIN_BODY_BYTES = 1024 * 1024;

const UPLOAD_PAGE = /^\/(en|ta)\/orgs\/[0-9a-f-]{36}\/business\/(onboarding|verification)\/?$/i;

export function isOversizedNonUpload(method: string, contentLength: string | null, pathname: string): boolean {
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return false;
  const len = Number(contentLength);
  if (!contentLength || !Number.isFinite(len) || len <= MAX_PLAIN_BODY_BYTES) return false;
  return !UPLOAD_PAGE.test(pathname);
}
