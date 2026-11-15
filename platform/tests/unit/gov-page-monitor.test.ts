import { describe, expect, it } from 'vitest';
import { extractLinks, lineDiff, normalizePage } from '@/server/gov/page-monitor';
import { FetchRefused, type SafeFetchResult } from '@/server/gov/safe-fetch';
import { runWorkerOnce, type GovRpc, type WorkerDeps } from '@/server/gov/worker';

const URL1 = 'https://www.mitra.gov.my/ms/modal-insan';
const PAGE = `<html><head><title>x</title><script>var a = 1;</script><style>.a{}</style></head><body>
<nav><a href="/menu">Menu</a></nav>
<h1>Modal Insan</h1><p>Program   Uyarvu &amp; Thunai</p>
<ul><li>Tarikh Kemaskini: 22 Oktober 2026</li><li><a href="https://forms.gle/abc#top">Borang</a></li></ul>
<!-- comment --><footer>Hak cipta</footer></body></html>`;

describe('page normalisation', () => {
  it('keeps readable text and drops scripts, styles, menus, footers and comments', () => {
    const n = normalizePage(PAGE, URL1);
    expect(n.text).toContain('Modal Insan');
    expect(n.text).toContain('Program Uyarvu & Thunai');
    expect(n.text).toContain('Tarikh Kemaskini: 22 Oktober 2026');
    expect(n.text).not.toMatch(/var a|Hak cipta|comment|Menu/);
  });

  it('lists the sorted https links (menus included, fragments removed, other schemes ignored)', () => {
    const html = '<a href="/z">z</a><a href="https://forms.gle/abc#x">f</a><a href="http://insecure.example/">h</a><a href="javascript:alert(1)">j</a><a href="mailto:a@b.c">m</a><a href="#top">t</a>';
    expect(extractLinks(html, URL1)).toEqual(['https://forms.gle/abc', 'https://www.mitra.gov.my/z']);
  });

  it('a changed link changes the normalised text, a changed script does not', () => {
    const a = normalizePage(PAGE, URL1).normalized;
    expect(normalizePage(PAGE.replace('var a = 1;', 'var a = 2;'), URL1).normalized).toBe(a);
    expect(normalizePage(PAGE.replace('forms.gle/abc', 'forms.gle/xyz'), URL1).normalized).not.toBe(a);
    expect(normalizePage(PAGE.replace('22 Oktober', '23 Oktober'), URL1).normalized).not.toBe(a);
  });

  it('whitespace-only changes do not count as a change', () => {
    expect(normalizePage(PAGE.replace('Program   Uyarvu', 'Program Uyarvu').replace('<h1>', '\n\n  <h1>'), URL1).normalized).toBe(normalizePage(PAGE, URL1).normalized);
  });

  it('does not treat a tag that merely starts with a dropped name as that tag', () => {
    const n = normalizePage('<navigation-x>keep this text here</navigation-x><p>and more readable content</p>', URL1);
    expect(n.text).toContain('keep this text here');
  });

  it('a hostile page with many unterminated elements finishes quickly and executes nothing', () => {
    const hostile = '<script>'.repeat(20000) + '<p>x</p>';
    const t = Date.now();
    const n = normalizePage(hostile, URL1);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(typeof n.normalized).toBe('string');
  });

  it('never returns markup: tags and event handlers are gone from the text', () => {
    const n = normalizePage('<p onclick="x()">hello <b>there</b> <img src=x onerror=alert(1)> friend of the site</p>', URL1);
    expect(n.text).not.toMatch(/[<>]/);
  });

  it('line diff reports removed and added lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual({ removed: ['b'], added: ['d'] });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Worker behaviour with an in-memory rpc (no database): validators, 304, changed, unchanged, failures.
// ---------------------------------------------------------------------------------------------------------------

type Call = { name: string; args: Record<string, unknown> };
const ROBOTS = 'User-agent: *\nDisallow: /administrator/\n';

function harness(opts: { validators?: { etag: string | null; last_modified: string | null } | null; verdict?: string; pages: Record<string, Partial<SafeFetchResult> | Error> }) {
  const calls: Call[] = [];
  const fetched: { url: string; validators?: { etag?: string | null; lastModified?: string | null } }[] = [];
  const rpc: GovRpc = async (name, args = {}) => {
    calls.push({ name, args });
    switch (name) {
      case 'gov_enqueue_due_jobs': return { data: 0, error: null };
      case 'gov_claim_jobs': return { data: [{ id: 'job-1', source_id: 'src-1', target_url: URL1, attempts: 1 }], error: null };
      case 'gov_job_source': return { data: [{ source_id: 'src-1', adapter: 'page_monitor', allowed_hosts: ['www.mitra.gov.my'], rate_per_minute: 60, parser_version: '1' }], error: null };
      case 'gov_last_validators': return { data: opts.validators ? [opts.validators] : [], error: null };
      case 'gov_complete_job': return { data: 'result-1', error: null };
      case 'gov_record_page': return { data: opts.verdict ?? 'baseline', error: null };
      default: return { data: null, error: null };
    }
  };
  const deps: WorkerDeps = {
    rpc,
    workerId: 'w1',
    agentToken: 'inok-govnavigator',
    now: () => Date.now(),
    sleep: async () => {},
    fetchPage: async (url, _hosts, validators) => {
      fetched.push({ url, validators });
      const p = opts.pages[url];
      if (p instanceof Error) throw p;
      if (!p) return { status: 404, finalUrl: url, contentType: 'text/html', text: '', bytes: 0, sha256: '', retryAfterSeconds: null, etag: null, lastModified: null };
      return { status: 200, finalUrl: url, contentType: 'text/html', text: '', bytes: 0, sha256: 'x', retryAfterSeconds: null, etag: null, lastModified: null, ...p };
    },
  };
  const completed = () => calls.filter((c) => c.name === 'gov_complete_job').map((c) => c.args.p_result as Record<string, unknown>);
  return { deps, calls, fetched, completed };
}

const robotsPage = { 'https://www.mitra.gov.my/robots.txt': { text: ROBOTS } };

describe('page_monitor adapter', () => {
  it('first look stores a baseline and creates nothing else', async () => {
    const h = harness({ pages: { ...robotsPage, [URL1]: { text: PAGE, etag: '"v1"', lastModified: 'Thu, 22 Oct 2026 00:00:00 GMT' } } });
    const r = await runWorkerOnce(h.deps);
    expect(r).toMatchObject({ succeeded: 1, pageChanged: 0, notModified: 0, errors: [] });
    const c = h.completed()[0]!;
    expect(c).toMatchObject({ outcome: 'ok', http_status: 200, etag: '"v1"', last_modified: 'Thu, 22 Oct 2026 00:00:00 GMT' });
    expect(String(c.evidence_excerpt)).toContain('Modal Insan');
    expect(String(c.content_sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(h.calls.map((x) => x.name)).not.toContain('gov_submit_candidate');
    expect(h.calls.map((x) => x.name)).toContain('gov_record_page');
  });

  it('sends the stored validators and treats 304 as a successful, unchanged check', async () => {
    const h = harness({ validators: { etag: '"v1"', last_modified: 'Thu, 22 Oct 2026 00:00:00 GMT' }, pages: { ...robotsPage, [URL1]: { status: 304 } } });
    const r = await runWorkerOnce(h.deps);
    expect(r).toMatchObject({ succeeded: 1, notModified: 1, pageChanged: 0 });
    expect(h.fetched.find((f) => f.url === URL1)?.validators).toEqual({ etag: '"v1"', lastModified: 'Thu, 22 Oct 2026 00:00:00 GMT' });
    expect(h.completed()[0]).toMatchObject({ outcome: 'unchanged', http_status: 304, etag: '"v1"' });
    expect(h.calls.filter((c) => c.name === 'gov_mark_unchanged')).toHaveLength(1);
    expect(h.calls.map((c) => c.name)).not.toContain('gov_record_page');
  });

  it('counts a changed page when the database says it changed', async () => {
    const h = harness({ verdict: 'changed', pages: { ...robotsPage, [URL1]: { text: PAGE } } });
    expect((await runWorkerOnce(h.deps)).pageChanged).toBe(1);
  });

  it('does not send validators when none are known', async () => {
    const h = harness({ pages: { ...robotsPage, [URL1]: { text: PAGE } } });
    await runWorkerOnce(h.deps);
    expect(h.fetched.find((f) => f.url === URL1)?.validators).toBeUndefined();
  });

  it('identical content hashes identically (so the database sees "unchanged")', async () => {
    const a = harness({ pages: { ...robotsPage, [URL1]: { text: PAGE } } });
    const b = harness({ pages: { ...robotsPage, [URL1]: { text: PAGE.replace('<h1>', '\n   <h1>') } } });
    await runWorkerOnce(a.deps);
    await runWorkerOnce(b.deps);
    expect(a.completed()[0]!.content_sha256).toBe(b.completed()[0]!.content_sha256);
  });

  it('a network failure is retried with backoff and stores nothing', async () => {
    const h = harness({ pages: { ...robotsPage, [URL1]: new FetchRefused('network', 'ECONNRESET') } });
    const r = await runWorkerOnce(h.deps);
    expect(r.retried).toBe(1);
    expect(h.calls.filter((c) => c.name === 'gov_fail_job')[0]!.args).toMatchObject({ p_error: 'network' });
    expect(h.completed()).toHaveLength(0);
  });

  it('HTTP 429 honours Retry-After', async () => {
    const h = harness({ pages: { ...robotsPage, [URL1]: { status: 429, retryAfterSeconds: 900 } } });
    await runWorkerOnce(h.deps);
    expect(h.calls.filter((c) => c.name === 'gov_fail_job')[0]!.args).toMatchObject({ p_error: 'http_429', p_retry_after_seconds: 900 });
  });

  it('robots disallow: the page is never fetched', async () => {
    const h = harness({ pages: { 'https://www.mitra.gov.my/robots.txt': { text: 'User-agent: *\nDisallow: /ms/' }, [URL1]: { text: PAGE } } });
    const r = await runWorkerOnce(h.deps);
    expect(r.rejected).toBe(1);
    expect(h.fetched.map((f) => f.url)).toEqual(['https://www.mitra.gov.my/robots.txt']);
    expect(h.completed()[0]).toMatchObject({ outcome: 'rejected_content', evidence_excerpt: 'robots_disallow' });
  });

  it('a refused fetch (private address, wrong type) is rejected, not retried', async () => {
    const h = harness({ pages: { ...robotsPage, [URL1]: new FetchRefused('private_address') } });
    const r = await runWorkerOnce(h.deps);
    expect(r.rejected).toBe(1);
    expect(r.retried).toBe(0);
    expect(h.completed()[0]).toMatchObject({ outcome: 'rejected_content', evidence_excerpt: 'refused:private_address' });
  });

  it('a blank or maintenance page is not stored as a baseline', async () => {
    const h = harness({ pages: { ...robotsPage, [URL1]: { text: '<html><body><p>Maintenance</p></body></html>' } } });
    const r = await runWorkerOnce(h.deps);
    expect(r.rejected).toBe(1);
    expect(h.completed()[0]).toMatchObject({ outcome: 'parse_failed' });
    expect(h.calls.map((c) => c.name)).not.toContain('gov_record_page');
  });

  it('404 is recorded as gone and never closes anything', async () => {
    const h = harness({ pages: { ...robotsPage } });
    await runWorkerOnce(h.deps);
    expect(h.completed()[0]).toMatchObject({ outcome: 'gone', http_status: 404 });
    expect(h.calls.map((c) => c.name)).not.toContain('gov_mark_missing');
  });

  it('a failing comparison does not lose the stored check', async () => {
    const h = harness({ pages: { ...robotsPage, [URL1]: { text: PAGE } } });
    const rpc = h.deps.rpc;
    h.deps.rpc = async (name, args) => (name === 'gov_record_page' ? { data: null, error: { code: 'PT500', message: 'boom' } } : rpc(name, args));
    const r = await runWorkerOnce(h.deps);
    expect(r.succeeded).toBe(1);
    expect(r.errors[0]).toMatch(/^record_page:job-1/);
    expect(h.calls.map((c) => c.name)).not.toContain('gov_fail_job');
  });
});
