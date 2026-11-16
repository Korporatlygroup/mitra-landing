// Short-lived, per-isolate cache of the HTML of anonymous, public pages (legal notices, sign-in forms, home, directory).
// Why: on the Cloudflare Free plan a rendered Next.js page costs 20-50 ms of CPU against a 10 ms allowance, and requests over it are
// cut off (error 1102 / 503). Serving a stored copy costs about a millisecond.
// What is cached: only GET navigations for the exact paths below, without a query string, without any Supabase session cookie, with a 200 HTML
// answer whose only cookie is next-intl's NEXT_LOCALE. Signed-in and private responses are never stored, and the stored copy lives in memory
// for minutes, never beyond the isolate.
// CSP: the page's per-request nonce is replaced by a fresh random nonce (in the markup and in the Content-Security-Policy header) on every
// response, so no two responses share a nonce and the policy keeps its meaning.

const LOCALES = '(?:en|ms|ta)';
// Legal and sign-in pages: identical for every anonymous visitor until the next deployment.
const STATIC_PAGE = new RegExp(`^/${LOCALES}/(?:privacy|terms|marketplace-policy|cookies|government-disclaimer|complaints|login|signup|forgot-password)$`);
// Public data that changes when staff approve listings: stored for a minute only.
const SHORT_PAGE = new RegExp(`^/${LOCALES}(?:/directory)?$`);
export const STATIC_TTL_MS = 10 * 60 * 1000;
export const SHORT_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 60;

const store = new Map();

export function cacheTtl(request) {
  if (request.method !== 'GET') return 0;
  const url = new URL(request.url);
  if (url.search) return 0;
  const h = request.headers;
  if (h.get('rsc') || h.get('next-router-prefetch') || h.get('next-router-state-tree') || h.get('next-action') || h.get('range')) return 0;
  if (h.get('authorization') && !/^basic /i.test(h.get('authorization'))) return 0;
  if (/(?:^|;\s*)sb-/.test(h.get('cookie') ?? '')) return 0;
  if (!(h.get('accept') ?? '').includes('text/html')) return 0;
  if (STATIC_PAGE.test(url.pathname)) return STATIC_TTL_MS;
  if (SHORT_PAGE.test(url.pathname)) return SHORT_TTL_MS;
  return 0;
}

export const freshNonce = () => btoa(crypto.randomUUID());

function nonceOf(csp) {
  const m = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp ?? '');
  return m ? m[1] : null;
}

/** Build a response from a stored entry with a new nonce. */
export function fromEntry(entry, nonce = freshNonce()) {
  const headers = new Headers();
  for (const [k, v] of entry.headers) headers.append(k, v.split(entry.nonce).join(nonce));
  headers.set('x-inok-page-cache', 'hit');
  return new Response(entry.body.split(entry.nonce).join(nonce), { status: 200, headers });
}

/**
 * Serves a stored copy, or renders through `render()` and stores the result when it is safe to.
 * Returns the response; never throws for cache reasons.
 */
export async function servePublicPage(request, render, now = Date.now()) {
  const ttl = cacheTtl(request);
  if (!ttl) return render();
  const key = new URL(request.url).pathname;
  const hit = store.get(key);
  if (hit && hit.expires > now) return fromEntry(hit);

  const res = await render();
  try {
    const type = res.headers.get('content-type') ?? '';
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const nonce = nonceOf(res.headers.get('content-security-policy'));
    const onlyLocaleCookie = cookies.every((c) => c.startsWith('NEXT_LOCALE='));
    if (res.status !== 200 || !type.includes('text/html') || !nonce || !onlyLocaleCookie) return res;
    const body = await res.text();
    if (!body.includes(nonce)) return new Response(body, { status: res.status, headers: res.headers });
    const headers = [];
    res.headers.forEach((v, k) => {
      if (k !== 'content-length' && k !== 'set-cookie' && k !== 'x-inok-page-cache') headers.push([k, v]);
    });
    // next-intl sets NEXT_LOCALE only when the request lacked it, so the first render may carry no cookie at all. Every visitor gets the
    // same cookie from the stored copy (the locale of the path), exactly what the application sets for a first visit.
    const locale = key.split('/')[1];
    headers.push(['set-cookie', `NEXT_LOCALE=${locale}; Path=/; SameSite=lax`]);
    if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
    const entry = { body, headers, nonce, expires: now + ttl };
    store.set(key, entry);
    // The response for this visitor also gets its own fresh nonce (the render's nonce is stored, never reused).
    const out = fromEntry(entry);
    out.headers.set('x-inok-page-cache', 'miss');
    return out;
  } catch {
    return res;
  }
}

export const _store = store;
