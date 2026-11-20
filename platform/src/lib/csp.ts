/**
 * Per-request Content-Security-Policy (built in src/proxy.ts, following the Next.js 16 nonce guide).
 * Scripts: nonce + 'strict-dynamic', no 'unsafe-inline'. 'unsafe-eval' only in development.
 * Styles keep 'unsafe-inline': a nonce does not cover inline style="" attributes and Next/React may emit them;
 * inline styles cannot execute script, so this is an accepted, documented trade-off.
 */
export function buildCsp(opts: { nonce: string; isDev: boolean; supabaseOrigin: string; captchaOrigin?: string }): string {
  const connect = ["'self'", opts.supabaseOrigin].filter(Boolean);
  const captcha = opts.captchaOrigin ? [opts.captchaOrigin] : [];
  if (opts.isDev) connect.push('ws:', 'wss:');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.isDev ? " 'unsafe-eval'" : ''}${captcha.length ? ' ' + captcha.join(' ') : ''}`,
    ...(captcha.length ? [`frame-src ${captcha.join(' ')}`] : []),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function supabaseOriginFromEnv(url = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  try {
    return new URL(url ?? '').origin;
  } catch {
    return '';
  }
}

export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
