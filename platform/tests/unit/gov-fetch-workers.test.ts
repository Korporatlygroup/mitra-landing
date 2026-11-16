import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchRefused, guardedLookup, isCloudflareWorkers, safeFetch, workersFetchTransport } from '@/server/gov/safe-fetch';

// The Workers transport: node:https rejects the `lookup` option there, so safeFetch uses fetch after the same address check.
const HOSTS = ['www.tekun.gov.my'];
const UA = 'INOK-Test/1';
const publicResolver = async () => [{ address: '104.20.23.154', family: 4 }];
const privateResolver = async () => [{ address: '127.0.0.1', family: 4 }];
const mixedResolver = async () => [{ address: '104.20.23.154', family: 4 }, { address: '10.0.0.5', family: 4 }];

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('runtime detection', () => {
  it('is false on Node and true when the Workers user agent is present', () => {
    expect(isCloudflareWorkers()).toBe(false);
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    expect(isCloudflareWorkers()).toBe(true);
  });

  it('safeFetch picks the fetch transport on Workers and never touches node:https', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    const fetchMock = vi.fn(async () => html('<p>ok</p>'));
    vi.stubGlobal('fetch', fetchMock);
    const r = await safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver });
    expect(r.status).toBe(200);
    expect(r.text).toBe('<p>ok</p>');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('workers transport safety', () => {
  it.each([
    ['a private address', privateResolver],
    ['one private address among public ones', mixedResolver],
  ])('refuses %s before any request is made', async (_label, resolver) => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    const fetchMock = vi.fn(async () => html('x'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver })).rejects.toMatchObject({ name: 'FetchRefused', code: 'private_address' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks fetch for manual redirects and revalidates every hop', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    const fetchMock = vi.fn(async (_url: URL | string, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver })).rejects.toMatchObject({ code: 'host_not_allowed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows an allowed redirect and sends the identifying headers', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    const seen: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        seen.push({ url: String(url), headers: init?.headers as Record<string, string> });
        return seen.length === 1 ? new Response(null, { status: 301, headers: { location: '/b/' } }) : html('<p>second</p>');
      }),
    );
    const r = await safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver });
    expect(r.finalUrl).toBe('https://www.tekun.gov.my/b/');
    expect(r.text).toBe('<p>second</p>');
    expect(seen[0]!.headers['User-Agent']).toBe(UA);
  });

  it('does not decode a body twice: fetch already decoded it, so the content-encoding header is dropped', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    vi.stubGlobal('fetch', vi.fn(async () => html('<p>plain</p>', { 'content-encoding': 'gzip' })));
    const r = await safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver });
    expect(r.text).toBe('<p>plain</p>');
  });

  it('keeps the size limit and the content-type allowlist', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    vi.stubGlobal('fetch', vi.fn(async () => html('x'.repeat(5000))));
    await expect(safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver, maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver })).rejects.toMatchObject({ code: 'bad_content_type' });
  });

  it('reports an error status without a body', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503, headers: { 'retry-after': '120', 'content-type': 'text/html' } })));
    const r = await safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver });
    expect(r).toMatchObject({ status: 503, text: '', retryAfterSeconds: 120 });
  });

  it('turns a connection failure into a refusal, and a stalled request into a timeout', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver })).rejects.toBeInstanceOf(FetchRefused);

    vi.stubGlobal('fetch', vi.fn((_url: URL | string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new Error('aborted')));
    })));
    await expect(safeFetch('https://www.tekun.gov.my/a/', { allowedHosts: HOSTS, userAgent: UA, resolver: publicResolver, timeoutMs: 50 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('exposes the transport so it can be injected directly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => html('<p>direct</p>')));
    const res = await workersFetchTransport(new URL('https://www.tekun.gov.my/'), { headers: {}, timeoutMs: 1000, lookup: guardedLookup(publicResolver) });
    expect(res.status).toBe(200);
    res.destroy();
  });
});
