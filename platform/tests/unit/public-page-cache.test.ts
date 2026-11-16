import { beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import { _store, cacheTtl, servePublicPage, SHORT_TTL_MS, STATIC_TTL_MS } from '../../public-page-cache.mjs';

const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`https://x.test${path}`, { ...init, headers: { accept: 'text/html', ...(init.headers ?? {}) } });

const NONCE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const page = (extra: Record<string, string> = {}, cookies: string[] = ['NEXT_LOCALE=en; Path=/']) => () => {
  const h = new Headers({ 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`, ...extra });
  for (const c of cookies) h.append('set-cookie', c);
  return Promise.resolve(new Response(`<html><script nonce="${NONCE}">x</script><p>public</p></html>`, { status: 200, headers: h }));
};

beforeEach(() => _store.clear());

describe('public page cache: what may be stored', () => {
  it('only the listed anonymous public pages', () => {
    expect(cacheTtl(req('/en/terms'))).toBe(STATIC_TTL_MS);
    expect(cacheTtl(req('/ms/privacy'))).toBe(STATIC_TTL_MS);
    expect(cacheTtl(req('/en/login'))).toBe(STATIC_TTL_MS);
    expect(cacheTtl(req('/en'))).toBe(SHORT_TTL_MS);
    expect(cacheTtl(req('/ta/directory'))).toBe(SHORT_TTL_MS);
    for (const p of ['/en/account', '/en/admin', '/en/orgs', '/en/directory/some-business', '/api/v1/health', '/en/reset-password', '/fr/terms', '/en/mfa/verify', '/en/sourcing', '/en/catalogue']) {
      expect(cacheTtl(req(p)), p).toBe(0);
    }
  });
  it('never with a query string, a session cookie, a Next RSC or action header, or a non-GET method', () => {
    expect(cacheTtl(req('/en/login?next=/en/account'))).toBe(0);
    expect(cacheTtl(req('/en/terms', { headers: { cookie: 'sb-abc-auth-token=1' } }))).toBe(0);
    expect(cacheTtl(req('/en/terms', { headers: { cookie: 'inok_access=k; sb-x-auth-token.0=1' } }))).toBe(0);
    expect(cacheTtl(req('/en/terms', { headers: { cookie: 'inok_access=k; NEXT_LOCALE=en' } }))).toBe(STATIC_TTL_MS);
    expect(cacheTtl(req('/en/terms', { headers: { rsc: '1' } }))).toBe(0);
    expect(cacheTtl(req('/en/terms', { headers: { 'next-action': 'abc' } }))).toBe(0);
    expect(cacheTtl(req('/en/terms', { method: 'POST' }))).toBe(0);
    expect(cacheTtl(req('/en/terms', { headers: { accept: 'application/json' } }))).toBe(0);
    expect(cacheTtl(req('/en/terms', { headers: { authorization: 'Bearer abc' } }))).toBe(0);
  });
});

describe('public page cache: serving', () => {
  it('renders once, then serves copies with a different nonce each time (markup and header agree)', async () => {
    let renders = 0;
    const render = () => {
      renders += 1;
      return page()();
    };
    const a = await servePublicPage(req('/en/terms'), render, 1000);
    const b = await servePublicPage(req('/en/terms'), render, 2000);
    const c = await servePublicPage(req('/en/terms'), render, 3000);
    expect(renders).toBe(1);
    expect([a, b, c].map((r) => r.headers.get('x-inok-page-cache'))).toEqual(['miss', 'hit', 'hit']);
    const nonces: string[] = [];
    for (const r of [a, b, c]) {
      const csp = r.headers.get('content-security-policy') ?? '';
      const n = /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
      const body = await r.text();
      expect(body).toContain(`nonce="${n}"`);
      expect(body).not.toContain(NONCE);
      expect(csp).not.toContain(NONCE);
      expect(r.headers.get('set-cookie')).toContain('NEXT_LOCALE=en');
      nonces.push(n);
    }
    expect(new Set(nonces).size).toBe(3);
  });
  it('expires after the lifetime', async () => {
    let renders = 0;
    const render = () => {
      renders += 1;
      return page()();
    };
    await servePublicPage(req('/en'), render, 0);
    await servePublicPage(req('/en'), render, SHORT_TTL_MS - 1);
    expect(renders).toBe(1);
    await servePublicPage(req('/en'), render, SHORT_TTL_MS + 1);
    expect(renders).toBe(2);
  });
  it('does not store errors, other cookies, or responses without a nonce; passes a session request straight through', async () => {
    let renders = 0;
    const counted = (f: () => Promise<Response>) => () => {
      renders += 1;
      return f();
    };
    await servePublicPage(req('/en/terms'), counted(() => Promise.resolve(new Response('boom', { status: 503, headers: { 'content-type': 'text/html' } }))));
    await servePublicPage(req('/en/terms'), counted(page({}, ['NEXT_LOCALE=en', 'other=1'])));
    await servePublicPage(req('/en/terms'), counted(() => Promise.resolve(new Response('<p>no nonce</p>', { headers: { 'content-type': 'text/html' } }))));
    await servePublicPage(req('/en/terms', { headers: { cookie: 'sb-x-auth-token=1' } }), counted(page()));
    expect(_store.size).toBe(0);
    await servePublicPage(req('/en/terms'), counted(page()));
    expect(_store.size).toBe(1);
    expect(renders).toBe(5);
  });
  it('always gives the locale cookie, even when the priming request already had one (so the render set none)', async () => {
    const primed = await servePublicPage(req('/ms/terms', { headers: { cookie: 'NEXT_LOCALE=ms' } }), page({}, []));
    const next = await servePublicPage(req('/ms/terms'), page({}, []));
    for (const r of [primed, next]) expect(r.headers.get('set-cookie')).toBe('NEXT_LOCALE=ms; Path=/; SameSite=lax');
  });
  it('keeps pages apart by path and by locale', async () => {
    await servePublicPage(req('/en/terms'), page());
    await servePublicPage(req('/ms/terms'), page());
    await servePublicPage(req('/en/privacy'), page());
    expect(_store.size).toBe(3);
  });
});
