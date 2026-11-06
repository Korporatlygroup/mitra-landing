import { createServerClient, type CookieOptions } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { buildCsp, newNonce, supabaseOriginFromEnv } from './lib/csp';
import { routing } from './i18n/routing';
import { sessionCookieOptions } from './lib/supabase/config';

const intl = createIntlMiddleware(routing);

type PendingCookie = { name: string; value: string; options: CookieOptions };

/**
 * 1) Supabase session refresh (validated with the Auth server via getUser; refreshed cookies are forwarded to the
 *    render of this same request and set on the response), 2) per-request CSP nonce, 3) next-intl locale routing.
 *
 * Request headers (CSP + x-nonce) can only be forwarded to the render through a rebuilt request, which is safe for
 * GET/HEAD. Mutations (server actions, POST) skip the rebuild: they return RSC payloads, not HTML documents.
 */
export default async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === 'development', supabaseOrigin: supabaseOriginFromEnv() });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const pending: PendingCookie[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith('sb-'));
  if (url && key && hasSession) {
    const supabase = createServerClient(url, key, {
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          pending.push(...cookiesToSet);
        },
      },
    });
    await supabase.auth.getUser();
  }

  const forward = request.method === 'GET' || request.method === 'HEAD';
  let source: NextRequest = request;
  if (forward) {
    if (pending.length) {
      // Same-request visibility of refreshed tokens: merge them into the cookie header handed to the render.
      const jar = new Map(request.cookies.getAll().map((c) => [c.name, c.value]));
      for (const c of pending) {
        if (c.value) jar.set(c.name, c.value);
        else jar.delete(c.name);
      }
      headers.set('cookie', [...jar].map(([n, v]) => `${n}=${v}`).join('; '));
    }
    source = new NextRequest(request.url, { headers, method: request.method });
  }

  const response = intl(source);
  for (const c of pending) response.cookies.set(c.name, c.value, c.options as Parameters<typeof response.cookies.set>[2]);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Skip API routes, the auth callback (outside the locale prefix), Next internals and files with a dot.
  matcher: '/((?!api|auth|trpc|_next|_vercel|.*\\..*).*)',
};
