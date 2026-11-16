import crypto from 'node:crypto';
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

/**
 * Guarded HTTPS fetch for approved government sources only (Phase 7).
 * - exact host allowlist (from the source registry), HTTPS on port 443, no credentials in the URL;
 * - redirects are followed manually (max 3) and every hop is validated again;
 * - the address is checked AT CONNECT TIME (custom lookup), so DNS rebinding cannot reach a private address;
 * - bounded time and size; identity/gzip only; UTF-8 only; allowlisted content types only.
 * It never takes a URL from a user: callers pass URLs from the registry or from links found on a registry page
 * (which are then re-checked against the allowlist).
 */

export type RefusalCode =
  | 'bad_url' | 'host_not_allowed' | 'private_address' | 'too_many_redirects' | 'bad_content_type' | 'too_large'
  | 'unsupported_encoding' | 'unsupported_charset' | 'timeout' | 'network';

export class FetchRefused extends Error {
  constructor(public readonly code: RefusalCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FetchRefused';
  }
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  stream: Readable;
  destroy: () => void;
}
export type Transport = (url: URL, init: { headers: Record<string, string>; timeoutMs: number; lookup: LookupFn }) => Promise<RawResponse>;
export type LookupFn = (hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => void;

export interface SafeFetchOptions {
  allowedHosts: readonly string[];
  userAgent: string;
  maxBytes?: number;
  timeoutMs?: number;
  /** Hard limit for the whole request including the body (default 30 s), so a slow trickle cannot hold a job. */
  totalTimeoutMs?: number;
  maxRedirects?: number;
  accept?: readonly string[];
  /** Validators from the last good fetch of this URL; the server may answer 304 and send no body. */
  validators?: { etag?: string | null; lastModified?: string | null };
  transport?: Transport;
  resolver?: (hostname: string) => Promise<{ address: string; family: number }[]>;
}

export interface SafeFetchResult {
  status: number;
  finalUrl: string;
  contentType: string | null;
  text: string;
  bytes: number;
  sha256: string;
  retryAfterSeconds: number | null;
  etag: string | null;
  lastModified: string | null;
}

const DEFAULT_ACCEPT = ['text/html', 'text/plain', 'application/xml', 'text/xml', 'application/xhtml+xml'] as const;

export function isPublicAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (/^::ffff:/.test(v) || v.startsWith('64:ff9b')) return false;
    if (/^f[cd]/.test(v) || /^fe[89abcdef]/.test(v) || v.startsWith('ff')) return false;
    if (v.startsWith('::') || v.startsWith('2002:')) return false; // IPv4-compatible and 6to4 forms
    if (v.startsWith('2001:db8')) return false;
    return true;
  }
  return false;
}

/** Checks scheme, port, credentials and the exact host allowlist. Returns the parsed URL or throws. */
export function validateUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused('bad_url');
  }
  if (url.protocol !== 'https:') throw new FetchRefused('bad_url', 'https required');
  if (url.username || url.password) throw new FetchRefused('bad_url', 'credentials in url');
  if (url.port && url.port !== '443') throw new FetchRefused('bad_url', 'port');
  const host = url.hostname.toLowerCase();
  if (net.isIP(host) || !allowedHosts.map((h) => h.toLowerCase()).includes(host)) throw new FetchRefused('host_not_allowed', host);
  return url;
}

/** DNS lookup that refuses any non-public address. Used as the socket `lookup`, so it runs at connect time. */
export function guardedLookup(
  resolver: (hostname: string) => Promise<{ address: string; family: number }[]> = (h) => dns.promises.lookup(h, { all: true }),
): LookupFn {
  return (hostname, options, cb) => {
    resolver(hostname).then(
      (addrs) => {
        if (addrs.length === 0 || addrs.some((a) => !isPublicAddress(a.address))) {
          cb(Object.assign(new Error('private_address'), { code: 'EPRIVATE' }) as NodeJS.ErrnoException, '', 0);
          return;
        }
        if (options.all) cb(null, addrs.map((a) => ({ address: a.address, family: a.family })));
        else cb(null, addrs[0]!.address, addrs[0]!.family);
      },
      (err: NodeJS.ErrnoException) => cb(err, '', 0),
    );
  };
}

const httpsTransport: Transport = (url, init) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', headers: init.headers, lookup: init.lookup as never, timeout: init.timeoutMs, agent: false },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res, destroy: () => res.destroy() }),
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });

/** True inside a Cloudflare Worker (the documented check). The Node transport is used everywhere else. */
export function isCloudflareWorkers(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

/**
 * Transport for Cloudflare Workers, where node:https rejects the `lookup` option the Node transport relies on.
 * The address is resolved and checked with the same guard BEFORE the request (not pinned at connect time, which fetch cannot do;
 * Workers also cannot reach private networks). Redirects stay manual so safeFetch validates every hop. fetch has already
 * decoded the body, so the content-encoding header is dropped. A stalled body is cut after `timeoutMs` without data.
 */
export const workersFetchTransport: Transport = async (url, init) => {
  await new Promise<void>((resolve, reject) => {
    init.lookup(url.hostname, { all: true } as dns.LookupOptions, (err) => (err ? reject(err) : resolve()));
  });
  const ac = new AbortController();
  const timeout = () => Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  let timer = setTimeout(() => ac.abort(timeout()), init.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers: init.headers, redirect: 'manual', signal: ac.signal });
  } catch (err) {
    clearTimeout(timer);
    if (ac.signal.aborted) throw timeout();
    throw err;
  }
  const headers: Record<string, string | string[] | undefined> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  delete headers['content-encoding'];
  const body = res.body ? Readable.fromWeb(res.body as never) : Readable.from([]);
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ac.abort(timeout());
      body.destroy(timeout());
    }, init.timeoutMs);
  };
  arm();
  body.on('data', arm);
  body.on('end', () => clearTimeout(timer));
  body.on('close', () => clearTimeout(timer));
  return {
    status: res.status,
    headers,
    stream: body,
    destroy: () => {
      clearTimeout(timer);
      ac.abort();
      body.destroy();
    },
  };
};

async function readLimited(res: RawResponse, maxBytes: number, deadline: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.stream) {
    if (Date.now() > deadline) {
      res.destroy();
      throw new FetchRefused('timeout', 'total deadline');
    }
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) {
      res.destroy();
      throw new FetchRefused('too_large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function header(h: RawResponse['headers'], name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

export function parseRetryAfter(value: string | undefined, now = Date.now()): number | null {
  if (!value) return null;
  if (/^\d{1,7}$/.test(value.trim())) return Number(value.trim());
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now) / 1000));
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const deadline = Date.now() + (opts.totalTimeoutMs ?? 30_000);
  const accept = opts.accept ?? DEFAULT_ACCEPT;
  const transport = opts.transport ?? (isCloudflareWorkers() ? workersFetchTransport : httpsTransport);
  const lookup = guardedLookup(opts.resolver);
  let url = validateUrl(rawUrl, opts.allowedHosts);
  const conditional: Record<string, string> = {};
  // Header values come from our own database, but are still restricted to printable ASCII before they go on the wire.
  if (opts.validators?.etag && /^[\x20-\x7e]{1,200}$/.test(opts.validators.etag)) conditional['If-None-Match'] = opts.validators.etag;
  if (opts.validators?.lastModified && /^[\x20-\x7e]{1,100}$/.test(opts.validators.lastModified)) conditional['If-Modified-Since'] = opts.validators.lastModified;

  for (let hop = 0; ; hop += 1) {
    let res: RawResponse;
    try {
      res = await transport(url, {
        timeoutMs,
        lookup,
        headers: { 'User-Agent': opts.userAgent, Accept: accept.join(', '), 'Accept-Encoding': 'gzip, identity', 'Accept-Language': 'ms,en;q=0.8', ...conditional },
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPRIVATE') throw new FetchRefused('private_address');
      if (code === 'ETIMEDOUT' || (err as Error).message === 'timeout') throw new FetchRefused('timeout');
      throw new FetchRefused('network', code);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      res.destroy();
      if (hop >= maxRedirects) throw new FetchRefused('too_many_redirects');
      const loc = header(res.headers, 'location');
      if (!loc) throw new FetchRefused('bad_url', 'redirect without location');
      url = validateUrl(new URL(loc, url).toString(), opts.allowedHosts); // every hop is re-validated
      continue;
    }
    const retryAfter = parseRetryAfter(header(res.headers, 'retry-after'));
    const contentType = header(res.headers, 'content-type')?.toLowerCase() ?? null;
    const etag = header(res.headers, 'etag')?.slice(0, 200) ?? null;
    const lastModified = header(res.headers, 'last-modified')?.slice(0, 100) ?? null;
    if (res.status >= 400 || res.status < 200 || res.status === 304) {
      res.destroy();
      return { status: res.status, finalUrl: url.toString(), contentType, text: '', bytes: 0, sha256: '', retryAfterSeconds: retryAfter, etag, lastModified };
    }
    const mime = contentType?.split(';')[0]?.trim() ?? '';
    if (!accept.includes(mime)) {
      res.destroy();
      throw new FetchRefused('bad_content_type', mime || 'none');
    }
    const charset = /charset=([^;\s]+)/.exec(contentType ?? '')?.[1]?.replace(/"/g, '');
    if (charset && !/^utf-?8$/i.test(charset)) {
      res.destroy();
      throw new FetchRefused('unsupported_charset', charset);
    }
    const declared = Number(header(res.headers, 'content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      throw new FetchRefused('too_large');
    }
    let body: Buffer;
    try {
      body = await readLimited(res, maxBytes, deadline);
    } catch (err) {
      if (err instanceof FetchRefused) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      throw new FetchRefused(code === 'ETIMEDOUT' ? 'timeout' : 'network', code);
    }
    const encoding = (header(res.headers, 'content-encoding') ?? 'identity').toLowerCase();
    if (encoding === 'gzip') {
      try {
        body = zlib.gunzipSync(body, { maxOutputLength: maxBytes });
      } catch {
        throw new FetchRefused('too_large', 'gzip');
      }
    } else if (encoding !== 'identity') {
      throw new FetchRefused('unsupported_encoding', encoding);
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      throw new FetchRefused('unsupported_charset', 'invalid utf-8');
    }
    return {
      status: res.status,
      finalUrl: url.toString(),
      contentType,
      text,
      bytes: body.length,
      sha256: crypto.createHash('sha256').update(body).digest('hex'),
      retryAfterSeconds: retryAfter,
      etag,
      lastModified,
    };
  }
}
