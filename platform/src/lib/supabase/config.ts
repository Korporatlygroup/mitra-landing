import type { CookieOptionsWithName } from '@supabase/ssr';

/**
 * Session cookie options (pure). HttpOnly keeps tokens out of reach of page scripts; all auth runs on the
 * server, so the browser never needs to read them. Secure whenever the site is https OR the build is production.
 */
export function cookieOptionsFor(env: { siteUrl?: string; nodeEnv?: string }): CookieOptionsWithName {
  const secure = (env.siteUrl ?? '').trim().toLowerCase().startsWith('https://') || env.nodeEnv === 'production';
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}

export function sessionCookieOptions(): CookieOptionsWithName {
  return cookieOptionsFor({ siteUrl: process.env.SITE_URL, nodeEnv: process.env.NODE_ENV });
}
