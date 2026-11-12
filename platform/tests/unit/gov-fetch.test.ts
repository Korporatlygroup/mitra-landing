import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FetchRefused, guardedLookup, isPublicAddress, parseRetryAfter, safeFetch, validateUrl, type Transport } from '@/server/gov/safe-fetch';
import { robotsAllows } from '@/server/gov/robots';

const HOSTS = ['www.tekun.gov.my'];
const UA = 'INOK-Test/1';

function fake(responses: { status?: number; headers?: Record<string, string>; body?: Buffer | string }[]): { transport: Transport; seen: string[] } {
  const seen: string[] = [];
  let i = 0;
  const transport: Transport = async (url) => {
    seen.push(url.toString());
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    const body = typeof r.body === 'string' ? Buffer.from(r.body) : (r.body ?? Buffer.alloc(0));
    const stream = Readable.from([body]);
    return { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/html; charset=UTF-8' }, stream, destroy: () => stream.destroy() };
  };
  return { transport, seen };
}

const opts = (transport: Transport, extra = {}) => ({ allowedHosts: HOSTS, userAgent: UA, transport, ...extra });

describe('url validation', () => {
  it.each([
    ['http://www.tekun.gov.my/a/', 'bad_url'],
    ['https://evil.example/a/', 'host_not_allowed'],
    ['https://www.tekun.gov.my.evil.example/', 'host_not_allowed'],
    ['https://user:pw@www.tekun.gov.my/', 'bad_url'],
    ['https://www.tekun.gov.my:8443/', 'bad_url'],
    ['https://127.0.0.1/', 'host_not_allowed'],
    ['not a url', 'bad_url'],
    ['file:///etc/passwd', 'bad_url'],
  ])('refuses %s', (url, code) => {
    expect(() => validateUrl(url, HOSTS)).toThrowError(FetchRefused);
    try {
      validateUrl(url, HOSTS);
    } catch (e) {
      expect((e as FetchRefused).code).toBe(code);
    }
  });
  it('accepts an allowlisted https url', () => {
    expect(validateUrl('https://WWW.tekun.gov.my/skim/', HOSTS).hostname).toBe('www.tekun.gov.my');
  });
});

describe('address guard (SSRF / DNS rebinding)', () => {
  it.each(['127.0.0.1', '10.0.0.5', '172.16.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '224.0.0.1'])(
    'refuses %s',
    (ip) => expect(isPublicAddress(ip)).toBe(false),
  );
  it.each(['8.8.8.8', '103.8.64.1', '2606:4700::1111'])('allows %s', (ip) => expect(isPublicAddress(ip)).toBe(true));

  it('lookup refuses a hostname that resolves to a private address, even if another address is public', async () => {
    const lookup = guardedLookup(async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    const err = await new Promise<NodeJS.ErrnoException | null>((res) => lookup('x.example', {}, (e) => res(e)));
    expect(err?.code).toBe('EPRIVATE');
  });
  it('lookup passes public addresses', async () => {
    const lookup = guardedLookup(async () => [{ address: '8.8.8.8', family: 4 }]);
    const out = await new Promise<string>((res) => lookup('x.example', {}, (_e, a) => res(a as string)));
    expect(out).toBe('8.8.8.8');
  });
});

describe('safeFetch', () => {
  it('returns text, hash and size for a normal page', async () => {
    const { transport } = fake([{ body: '<h1>Hi</h1>' }]);
    const r = await safeFetch('https://www.tekun.gov.my/a/', opts(transport));
    expect(r.status).toBe(200);
    expect(r.text).toBe('<h1>Hi</h1>');
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('follows a redirect to an allowed host and re-validates each hop', async () => {
    const { transport, seen } = fake([{ status: 301, headers: { location: '/b/' } }, { body: 'ok' }]);
    const r = await safeFetch('https://www.tekun.gov.my/a/', opts(transport));
    expect(seen).toEqual(['https://www.tekun.gov.my/a/', 'https://www.tekun.gov.my/b/']);
    expect(r.finalUrl).toBe('https://www.tekun.gov.my/b/');
  });
  it('refuses a redirect to another host, to http, or to a private IP', async () => {
    for (const loc of ['https://evil.example/', 'http://www.tekun.gov.my/', 'https://169.254.169.254/latest']) {
      const { transport } = fake([{ status: 302, headers: { location: loc } }]);
      await expect(safeFetch('https://www.tekun.gov.my/a/', opts(transport))).rejects.toBeInstanceOf(FetchRefused);
    }
  });
  it('stops redirect loops', async () => {
    const { transport } = fake([{ status: 302, headers: { location: '/a/' } }]);
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(transport))).rejects.toMatchObject({ code: 'too_many_redirects' });
  });
  it('refuses unexpected content types (binary, json, pdf)', async () => {
    for (const ct of ['application/pdf', 'application/octet-stream', 'application/json', 'image/png']) {
      const { transport } = fake([{ headers: { 'content-type': ct }, body: 'x' }]);
      await expect(safeFetch('https://www.tekun.gov.my/a/', opts(transport))).rejects.toMatchObject({ code: 'bad_content_type' });
    }
  });
  it('refuses oversized bodies by header and while streaming', async () => {
    const a = fake([{ headers: { 'content-type': 'text/html', 'content-length': '999999999' }, body: 'x' }]);
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(a.transport, { maxBytes: 1000 }))).rejects.toMatchObject({ code: 'too_large' });
    const b = fake([{ body: Buffer.alloc(5000, 97) }]);
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(b.transport, { maxBytes: 1000 }))).rejects.toMatchObject({ code: 'too_large' });
  });
  it('refuses a gzip bomb', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(5_000_000, 97));
    const { transport } = fake([{ headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body: bomb }]);
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(transport, { maxBytes: 100_000 }))).rejects.toMatchObject({ code: 'too_large' });
  });
  it('accepts normal gzip, refuses brotli/unknown encodings, non-UTF-8 charsets and invalid UTF-8', async () => {
    const ok = fake([{ headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body: zlib.gzipSync('hello') }]);
    expect((await safeFetch('https://www.tekun.gov.my/a/', opts(ok.transport))).text).toBe('hello');
    const br = fake([{ headers: { 'content-type': 'text/html', 'content-encoding': 'br' }, body: 'x' }]);
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(br.transport))).rejects.toMatchObject({ code: 'unsupported_encoding' });
    const cs = fake([{ headers: { 'content-type': 'text/html; charset=iso-8859-1' }, body: 'x' }]);
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(cs.transport))).rejects.toMatchObject({ code: 'unsupported_charset' });
    const bad = fake([{ body: Buffer.from([0xff, 0xfe, 0xfd]) }]);
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(bad.transport))).rejects.toMatchObject({ code: 'unsupported_charset' });
  });
  it('reports 429/500 with Retry-After instead of throwing, so the worker can back off', async () => {
    const { transport } = fake([{ status: 429, headers: { 'retry-after': '120', 'content-type': 'text/html' } }]);
    const r = await safeFetch('https://www.tekun.gov.my/a/', opts(transport));
    expect(r.status).toBe(429);
    expect(r.retryAfterSeconds).toBe(120);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:26:00 GMT'))).toBe(120);
  });
  it('maps connection failures and private addresses to refusals', async () => {
    const t1: Transport = async () => { throw Object.assign(new Error('x'), { code: 'EPRIVATE' }); };
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(t1))).rejects.toMatchObject({ code: 'private_address' });
    const t2: Transport = async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); };
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(t2))).rejects.toMatchObject({ code: 'network' });
    const t3: Transport = async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); };
    await expect(safeFetch('https://www.tekun.gov.my/a/', opts(t3))).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('robots.txt', () => {
  const tekun = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nUser-agent: *\nDisallow: /imunify-bot-check\n';
  it('merges multiple * groups and applies longest match', () => {
    expect(robotsAllows(tekun, 'inok', '/skim-pembiayaan-tekun-niaga/')).toBe(true);
    expect(robotsAllows(tekun, 'inok', '/wp-admin/options.php')).toBe(false);
    expect(robotsAllows(tekun, 'inok', '/wp-admin/admin-ajax.php')).toBe(true);
    expect(robotsAllows(tekun, 'inok', '/imunify-bot-check')).toBe(false);
  });
  it('honours a group that names our token and wildcards', () => {
    const t = 'User-agent: inok-gov\nDisallow: /private*\nUser-agent: other\nDisallow: /\n';
    expect(robotsAllows(t, 'inok-govnavigator', '/private/x')).toBe(false);
    expect(robotsAllows(t, 'inok-govnavigator', '/public/')).toBe(true);
  });
  it('allows everything when nothing applies', () => expect(robotsAllows('', 'inok', '/x')).toBe(true));
});
