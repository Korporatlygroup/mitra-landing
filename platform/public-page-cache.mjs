// Short-lived, per-isolate cache of the HTML of anonymous, public pages (legal notices, sign-in forms, home, directory, catalogue, news).
// Why: on the Cloudflare Free plan a rendered Next.js page costs 20-50 ms of CPU against a 10 ms allowance, and requests over it are
// cut off (error 1102 / 503). Serving a stored copy costs about a millisecond.
// What is cached: only GET navigations for the exact paths below, without a query string, without any Supabase session cookie, with a 200 HTML
// answer whose only cookie is next-intl's NEXT_LOCALE. Signed-in and private responses are never stored, and the stored copy lives in memory
// for minutes to hours, never beyond the isolate.
// Stale-while-revalidate: a copy past its fresh time is still served at once and renewed in the background, so a refresh that the CPU limit
// cuts off costs no visitor an error. Only the first visit to a page in a new isolate has to render in the request.
// CSP: the page's per-request nonce is replaced by a fresh random nonce (in the markup and in the Content-Security-Policy header) on every
// response, so no two responses share a nonce and the policy keeps its meaning.

const LOCALES = '(?:en|ms|ta)';
// Legal and sign-in pages: identical for every anonymous visitor until the next deployment.
const STATIC_PAGE = new RegExp(`^/${LOCALES}/(?:privacy|terms|marketplace-policy|cookies|government-disclaimer|complaints|login|signup|forgot-password)$`);
// Public data that changes when staff approve listings or publish news: fresh for a minute.
const SHORT_PAGE = new RegExp(`^/${LOCALES}(?:/(?:directory|catalogue|business-help|news))?$`);
export const STATIC_TTL_MS = 10 * 60 * 1000;
export const SHORT_TTL_MS = 60 * 1000;
// How long a past-fresh copy may still be served while it is renewed in the background.
export const STATIC_STALE_MS = 24 * 60 * 60 * 1000;
export const SHORT_STALE_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 60;

const store = new Map();

/** Fresh lifetime in ms for a cacheable request, 0 when the request must not be cached. */
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

/** Stores a rendered response when it is safe to; returns the response to send (a copy with its own fresh nonce, or the original). */
async function capture(res, key, ttl, now) {
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
    if (store.size >= MAX_ENTRIES && !store.has(key)) store.delete(store.keys().next().value);
    const stale = ttl === STATIC_TTL_MS ? STATIC_STALE_MS : SHORT_STALE_MS;
    const entry = { body, headers, nonce, fresh: now + ttl, expires: now + stale, refreshing: false };
    store.set(key, entry);
    // The response for this visitor also gets its own fresh nonce (the render's nonce is stored, never reused).
    const out = fromEntry(entry);
    out.headers.set('x-inok-page-cache', 'miss');
    return out;
  } catch {
    return res;
  }
}

/**
 * Serves a stored copy, or renders through `render()` and stores the result when it is safe to.
 * `opts.ctx.waitUntil` (when given) lets a stale copy be renewed after the response is sent. Never throws for cache reasons.
 */
export async function servePublicPage(request, render, opts = {}) {
  const ttl = cacheTtl(request);
  if (!ttl) return render();
  const now = opts.now ?? Date.now();
  const key = new URL(request.url).pathname;
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    if (hit.fresh <= now && !hit.refreshing && opts.ctx?.waitUntil) {
      hit.refreshing = true;
      opts.ctx.waitUntil(
        Promise.resolve()
          .then(() => render())
          .then((res) => capture(res, key, ttl, now))
          .catch(() => {})
          .finally(() => {
            hit.refreshing = false;
          }),
      );
    }
    return fromEntry(hit);
  }
  return capture(await render(), key, ttl, now);
}

export const _store = store;
