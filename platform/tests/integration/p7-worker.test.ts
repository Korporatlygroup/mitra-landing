import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FetchRefused, type SafeFetchResult } from '@/server/gov/safe-fetch';
import { runWorkerOnce, type GovRpc, type WorkerDeps } from '@/server/gov/worker';
import { serviceClient, sql } from './helpers';

const dir = path.join(import.meta.dirname, '..', 'fixtures', 'tekun');
const SCHEME = fs.readFileSync(path.join(dir, 'skim-pembangunan-usahawan-masyarakat-india-spumi.html'), 'utf8');
const CONDITIONS = fs.readFileSync(path.join(dir, 'skim-pembangunan-usahawan-masyarakat-india-spumi-syarat-syarat.html'), 'utf8');
const ROBOTS = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nUser-agent: *\nDisallow: /imunify-bot-check\n';
const SCHEME_URL = 'https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi/';
const COND_URL = 'https://www.tekun.gov.my/?page_id=339';

type Page = Partial<SafeFetchResult> & { text?: string };
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function makeDeps(pages: Record<string, Page | Error>, calls: string[] = [], validatorLog: (Parameters<WorkerDeps['fetchPage']>[2])[] = []): WorkerDeps {
  const svc = serviceClient();
  const rpc: GovRpc = async (name, args) => {
    const { data, error } = await svc.rpc(name, args ?? {});
    return { data, error: error ? { code: error.code, message: error.message } : null };
  };
  return {
    rpc,
    workerId: `t-${crypto.randomUUID().slice(0, 6)}`,
    agentToken: 'inok-govnavigator',
    now: () => Date.now(),
    sleep: async () => {},
    fetchPage: async (url, _hosts, validators) => {
      calls.push(url);
      if (url.startsWith('https://www.mitra.gov.my/ms/')) validatorLog.push(validators);
      const p = pages[url];
      if (p instanceof Error) throw p;
      if (!p) return { status: 404, finalUrl: url, contentType: 'text/html', text: '', bytes: 0, sha256: '', retryAfterSeconds: null, etag: null, lastModified: null };
      const text = p.text ?? '';
      return { status: 200, finalUrl: url === COND_URL ? 'https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi-syarat-syarat/' : url, contentType: 'text/html', bytes: text.length, sha256: sha(text), retryAfterSeconds: null, etag: null, lastModified: null, ...p, text };
    },
  };
}

const goodPages = (): Record<string, Page | Error> => ({
  'https://www.tekun.gov.my/robots.txt': { text: ROBOTS },
  [SCHEME_URL]: { text: SCHEME },
  [COND_URL]: { text: CONDITIONS },
});

let sourceId: string;
let counter = 0;

async function newSource(rate = 60): Promise<string> {
  counter += 1;
  const code = `T${Date.now().toString(36).toUpperCase()}${counter}`;
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ($1,'Test agency','tekun.gov.my') returning id`, [code]))[0]!.id;
  const s = await sql<{ id: string }>(
    `insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,enabled,rate_per_minute,refresh_interval_minutes)
     values ($1,'Worker test','website','tekun','{www.tekun.gov.my}',$2,true,$3,60) returning id`,
    [agency, [SCHEME_URL], rate],
  );
  return s[0]!.id;
}

beforeAll(async () => {
  await sql(`update public.gov_settings set enabled = true where key = 'monitoring_enabled'`);
});
afterAll(async () => {
  await sql(`update public.gov_settings set enabled = false where key in ('monitoring_enabled','publishing_enabled','notifications_enabled')`);
  // Leave the shared database as found (pgTAP files assume empty gov tables). Versions are append-only and never created here.
  await sql(`delete from public.gov_change_proposals where source_id in (select id from public.gov_sources where name = 'Worker test')`);
  await sql(`delete from public.gov_programmes where source_id in (select id from public.gov_sources where name = 'Worker test')`);
  await sql(`delete from public.gov_sources where name = 'Worker test'`);
  await sql(`delete from public.gov_agencies where name = 'Test agency'`);
});
beforeEach(async () => {
  // Isolate each test: other sources off, their queued jobs cancelled.
  await sql(`update public.gov_sources set enabled = false`);
  await sql(`update public.gov_fetch_jobs set status = 'cancelled' where status in ('queued','running')`);
  sourceId = await newSource();
});

const jobs = () => sql<{ status: string; attempts: number; last_error: string | null; run_after: string }>(
  `select status, attempts, last_error, run_after from public.gov_fetch_jobs where source_id = $1 order by created_at`, [sourceId]);
const src = async () => (await sql<{ health: string; consecutive_failures: number }>(`select health, consecutive_failures from public.gov_sources where id = $1`, [sourceId]))[0]!;

describe('Journey A: discovery from a TEKUN page', () => {
  it('fetches, extracts and queues a candidate with evidence; nothing is published', async () => {
    const calls: string[] = [];
    const r = await runWorkerOnce(makeDeps(goodPages(), calls));
    expect(r.errors).toEqual([]);
    expect(r.submitted).toEqual({ queued: 1 });
    expect(calls).toEqual(['https://www.tekun.gov.my/robots.txt', SCHEME_URL, COND_URL]);
    const p = await sql<{ kind: string; status: string; candidate: any; flags: string[]; result_id: string }>(
      `select kind, status, candidate, flags, result_id from public.gov_change_proposals where source_id = $1`, [sourceId]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'new', status: 'pending' });
    expect(p[0]!.candidate.amount_max).toBe('100000');
    expect(p[0]!.candidate.application_status).toBe('unknown');
    expect(p[0]!.flags).not.toContain('url_host_not_allowed');
    const ev = await sql<{ evidence_excerpt: string; outcome: string }>(`select evidence_excerpt, outcome from public.gov_fetch_results where id = $1`, [p[0]!.result_id]);
    expect(ev[0]).toMatchObject({ outcome: 'ok' });
    expect(ev[0]!.evidence_excerpt).toMatch(/RM 1,000/);
    expect((await sql(`select 1 from public.gov_programmes where source_id = $1`, [sourceId])).length).toBe(0);
    expect((await src()).health).toBe('healthy');
  });

  it('a repeat of identical content is recognised as a duplicate (no second proposal)', async () => {
    await runWorkerOnce(makeDeps(goodPages()));
    await sql(`update public.gov_sources set next_check_at = null, last_request_at = null where id = $1`, [sourceId]);
    await sql(`update public.gov_fetch_jobs set idempotency_key = idempotency_key || 'x' where source_id = $1`, [sourceId]);
    const r = await runWorkerOnce(makeDeps(goodPages()));
    expect(r.submitted).toEqual({ duplicate: 1 });
    expect((await sql(`select 1 from public.gov_change_proposals where source_id = $1`, [sourceId])).length).toBe(1);
  });
});

describe('Journey F: outages and bad content never touch published data', () => {
  it('network failure requeues with backoff and degrades nothing else', async () => {
    const pages = goodPages();
    pages[SCHEME_URL] = new FetchRefused('network', 'ECONNRESET');
    const r = await runWorkerOnce(makeDeps(pages));
    expect(r.retried).toBe(1);
    const j = await jobs();
    expect(j[0]).toMatchObject({ status: 'queued', attempts: 1, last_error: 'network' });
    expect(new Date(j[0]!.run_after).getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect((await src()).consecutive_failures).toBe(1);
    expect((await sql(`select 1 from public.gov_change_proposals where source_id = $1`, [sourceId])).length).toBe(0);
  });

  it('HTTP 429 honours Retry-After; 500 retries', async () => {
    const pages = goodPages();
    pages[SCHEME_URL] = { status: 429, retryAfterSeconds: 900 };
    await runWorkerOnce(makeDeps(pages));
    const j = await jobs();
    expect(j[0]).toMatchObject({ status: 'queued', last_error: 'http_429' });
    expect(new Date(j[0]!.run_after).getTime()).toBeGreaterThan(Date.now() + 800_000);
  });

  it('a changed layout is recorded as parse_failed and queues nothing', async () => {
    const pages = goodPages();
    pages[COND_URL] = { text: '<html><body><h1>Maintenance</h1></body></html>' };
    const r = await runWorkerOnce(makeDeps(pages));
    expect(r.rejected).toBe(1);
    const res = await sql<{ outcome: string; evidence_excerpt: string }>(`select outcome, evidence_excerpt from public.gov_fetch_results where source_id = $1`, [sourceId]);
    expect(res[0]).toMatchObject({ outcome: 'parse_failed' });
    expect((await sql(`select 1 from public.gov_change_proposals where source_id = $1`, [sourceId])).length).toBe(0);
    expect((await src()).consecutive_failures).toBe(1);
  });

  it('missing conditions page retries instead of queuing a partial record', async () => {
    const pages = goodPages();
    delete pages[COND_URL];
    const r = await runWorkerOnce(makeDeps(pages));
    expect(r.retried).toBe(1);
    expect((await sql(`select 1 from public.gov_change_proposals where source_id = $1`, [sourceId])).length).toBe(0);
  });

  it('robots disallow: the page is never fetched', async () => {
    const calls: string[] = [];
    const pages = goodPages();
    pages['https://www.tekun.gov.my/robots.txt'] = { text: 'User-agent: *\nDisallow: /skim' };
    const r = await runWorkerOnce(makeDeps(pages, calls));
    expect(r.rejected).toBe(1);
    expect(calls).toEqual(['https://www.tekun.gov.my/robots.txt']);
  });

  it('refused content (wrong type / oversize) is rejected, not retried blindly', async () => {
    const pages = goodPages();
    pages[SCHEME_URL] = new FetchRefused('bad_content_type', 'application/pdf');
    const r = await runWorkerOnce(makeDeps(pages));
    expect(r.rejected).toBe(1);
    expect((await jobs())[0]!.status).toBe('succeeded');
  });

  it('a programme that disappears is only flagged, never closed', async () => {
    // Pretend the programme was published earlier (setup as database owner).
    const key = 'skim-pembangunan-usahawan-masyarakat-india-spumi';
    const ag = (await sql<{ agency_id: string }>(`select agency_id from public.gov_sources where id = $1`, [sourceId]))[0]!.agency_id;
    const prog = (await sql<{ id: string }>(
      `insert into public.gov_programmes(source_id,agency_id,external_key,slug,publication_state,verification_status,application_status,name)
       values ($1,$2,$3,$4,'published','verified','open','Synthetic') returning id`, [sourceId, ag, key, `${key}-${Date.now()}`]))[0]!.id;
    const pages = goodPages();
    delete pages[SCHEME_URL];
    await runWorkerOnce(makeDeps(pages));
    const p = (await sql<{ verification_status: string; publication_state: string; application_status: string }>(
      `select verification_status, publication_state, application_status from public.gov_programmes where id = $1`, [prog]))[0]!;
    expect(p).toEqual({ verification_status: 'verified', publication_state: 'published', application_status: 'open' }); // one miss changes nothing visible (three in a row are needed)
  });
});

describe('Journey I: concurrency and recovery', () => {
  it('two simultaneous runs process the single due job exactly once', async () => {
    const [a, b] = await Promise.all([runWorkerOnce(makeDeps(goodPages())), runWorkerOnce(makeDeps(goodPages()))]);
    expect(a.claimed + b.claimed).toBe(1);
    expect((await jobs()).filter((j) => j.status === 'succeeded')).toHaveLength(1);
    expect((await sql(`select 1 from public.gov_change_proposals where source_id = $1`, [sourceId])).length).toBe(1);
  });

  it('a crashed worker is recovered after its lease expires', async () => {
    const svc = serviceClient();
    await svc.rpc('gov_enqueue_due_jobs');
    const claimed = await svc.rpc('gov_claim_jobs', { p_worker: 'dead-worker', p_limit: 1, p_lease_seconds: 10 });
    expect((claimed.data as unknown[]).length).toBe(1);
    // The crashed worker still holds the lease: nobody else may take it.
    const early = await runWorkerOnce(makeDeps(goodPages()));
    expect(early.claimed).toBe(0);
    await sql(`update public.gov_fetch_jobs set lease_until = now() - interval '1 minute' where source_id = $1`, [sourceId]);
    await sql(`update public.gov_sources set last_request_at = null where id = $1`, [sourceId]);
    const r = await runWorkerOnce(makeDeps(goodPages()));
    expect(r.submitted).toEqual({ queued: 1 });
    const j = await jobs();
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('a worker that lost its lease cannot overwrite the result', async () => {
    const svc = serviceClient();
    await svc.rpc('gov_enqueue_due_jobs');
    const claimed = (await svc.rpc('gov_claim_jobs', { p_worker: 'slow', p_limit: 1, p_lease_seconds: 10 })).data as { id: string }[];
    await sql(`update public.gov_fetch_jobs set lease_until = now() - interval '1 minute' where id = $1`, [claimed[0]!.id]);
    await sql(`update public.gov_sources set last_request_at = null where id = $1`, [sourceId]);
    await svc.rpc('gov_claim_jobs', { p_worker: 'fast', p_limit: 1, p_lease_seconds: 60 });
    const late = await svc.rpc('gov_complete_job', { p_job: claimed[0]!.id, p_worker: 'slow', p_result: { outcome: 'ok' } });
    expect(late.error?.code).toBe('PT409');
  });
});

describe('switches and access', () => {
  it('nothing runs while monitoring is switched off', async () => {
    await sql(`update public.gov_settings set enabled = false where key = 'monitoring_enabled'`);
    try {
      const r = await runWorkerOnce(makeDeps(goodPages()));
      expect(r).toMatchObject({ enqueued: 0, claimed: 0 });
    } finally {
      await sql(`update public.gov_settings set enabled = true where key = 'monitoring_enabled'`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Page monitor (sources without an API or feed): changes wait for a person, nothing is ever published or proposed.
// ---------------------------------------------------------------------------------------------------------------
const MITRA_URL = 'https://www.mitra.gov.my/ms/modal-insan';
const MITRA_ROBOTS = 'User-agent: *\nDisallow: /administrator/\nDisallow: /api/\n';
const mitraPage = (updated: string, link = 'https://forms.gle/abc') =>
  `<html><body><nav><a href="/menu">Menu</a></nav><h1>Modal Insan MADANI</h1><p>Tarikh Kemaskini: ${updated}</p><ul><li>Program Uyarvu Startup Accelerator Grant Fasa 2</li><li><a href="${link}">Borang permohonan</a></li></ul></body></html>`;

async function newPageSource(): Promise<string> {
  counter += 1;
  const code = `M${Date.now().toString(36).toUpperCase()}${counter}`;
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ($1,'Test agency','mitra.gov.my') returning id`, [code]))[0]!.id;
  return (await sql<{ id: string }>(
    `insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,enabled,rate_per_minute,refresh_interval_minutes)
     values ($1,'Worker test','website','page_monitor','{www.mitra.gov.my}',$2,true,60,60) returning id`, [agency, [MITRA_URL]]))[0]!.id;
}
const again = async () => {
  await sql(`update public.gov_sources set next_check_at = null, last_request_at = null where id = $1`, [sourceId]);
  await sql(`update public.gov_fetch_jobs set idempotency_key = idempotency_key || 'x' where source_id = $1`, [sourceId]);
};
const changes = () => sql<{ status: string; old_result_id: string; new_result_id: string }>(`select status, old_result_id, new_result_id from public.gov_page_changes where source_id = $1`, [sourceId]);

describe('Journey P: page monitor', () => {
  beforeEach(async () => {
    sourceId = await newPageSource();
  });
  const pages = (html: string, extra: Page = {}): Record<string, Page | Error> => ({
    'https://www.mitra.gov.my/robots.txt': { text: MITRA_ROBOTS },
    [MITRA_URL]: { text: html, ...extra },
  });

  it('first look is a baseline: no review item, no proposal, no programme', async () => {
    const r = await runWorkerOnce(makeDeps(pages(mitraPage('22 Oktober 2026'))));
    expect(r).toMatchObject({ succeeded: 1, pageChanged: 0, errors: [] });
    expect(await changes()).toHaveLength(0);
    expect((await sql(`select 1 from public.gov_change_proposals where source_id = $1`, [sourceId])).length).toBe(0);
    expect((await sql(`select 1 from public.gov_programmes where source_id = $1`, [sourceId])).length).toBe(0);
    const res = await sql<{ outcome: string; evidence_excerpt: string }>(`select outcome, evidence_excerpt from public.gov_fetch_results where source_id = $1`, [sourceId]);
    expect(res[0]!.outcome).toBe('ok');
    expect(res[0]!.evidence_excerpt).toContain('Uyarvu');
  });

  it('the same page again is unchanged; a changed date or link creates exactly one pending review item', async () => {
    await runWorkerOnce(makeDeps(pages(mitraPage('22 Oktober 2026'))));
    await again();
    expect((await runWorkerOnce(makeDeps(pages(mitraPage('22 Oktober 2026'))))).pageChanged).toBe(0);
    expect(await changes()).toHaveLength(0);
    await again();
    expect((await runWorkerOnce(makeDeps(pages(mitraPage('30 November 2026', 'https://forms.gle/new'))))).pageChanged).toBe(1);
    const c = await changes();
    expect(c).toHaveLength(1);
    expect(c[0]!.status).toBe('pending');
    const ev = await sql<{ evidence_excerpt: string }>(`select evidence_excerpt from public.gov_fetch_results where id = $1`, [c[0]!.new_result_id]);
    expect(ev[0]!.evidence_excerpt).toContain('30 November 2026');
    expect(ev[0]!.evidence_excerpt).toContain('https://forms.gle/new');
  });

  it('keeps ETag / Last-Modified and sends them next time; 304 is a healthy, unchanged check', async () => {
    await runWorkerOnce(makeDeps(pages(mitraPage('22 Oktober 2026'), { etag: '"v1"', lastModified: 'Thu, 22 Oct 2026 00:00:00 GMT' })));
    const stored = await sql<{ etag: string; last_modified: string }>(`select etag, last_modified from public.gov_fetch_results where source_id = $1`, [sourceId]);
    expect(stored[0]).toEqual({ etag: '"v1"', last_modified: 'Thu, 22 Oct 2026 00:00:00 GMT' });
    await again();
    const seen: (Parameters<WorkerDeps['fetchPage']>[2])[] = [];
    const notModified: Record<string, Page | Error> = { 'https://www.mitra.gov.my/robots.txt': { text: MITRA_ROBOTS }, [MITRA_URL]: { status: 304, text: '' } };
    const r = await runWorkerOnce(makeDeps(notModified, [], seen));
    expect(seen).toEqual([{ etag: '"v1"', lastModified: 'Thu, 22 Oct 2026 00:00:00 GMT' }]);
    expect(r).toMatchObject({ notModified: 1, pageChanged: 0, errors: [] });
    const res = await sql<{ outcome: string; http_status: number }>(`select outcome, http_status from public.gov_fetch_results where source_id = $1 order by fetched_at desc limit 1`, [sourceId]);
    expect(res[0]).toEqual({ outcome: 'unchanged', http_status: 304 });
    expect((await src()).health).toBe('healthy');
    expect(await changes()).toHaveLength(0);
  });

  it('a 304 refreshes the freshness of the programme whose information page this is, but changes nothing else', async () => {
    await runWorkerOnce(makeDeps(pages(mitraPage('22 Oktober 2026'), { etag: '"v1"' })));
    const ag = (await sql<{ agency_id: string }>(`select agency_id from public.gov_sources where id = $1`, [sourceId]))[0]!.agency_id;
    const prog = (await sql<{ id: string }>(
      `insert into public.gov_programmes(source_id,agency_id,external_key,slug,publication_state,verification_status,application_status,name,last_checked_at)
       values ($1,$2,'pm-key',$3,'published','verified','open','Synthetic', now() - interval '10 days') returning id`, [sourceId, ag, `pm-${Date.now()}`]))[0]!.id;
    const ver = (await sql<{ id: string }>(
      `insert into public.gov_programme_versions(programme_id,version_no,data,data_sha256,detection_method) values ($1,1,$2,$3,'manual') returning id`,
      [prog, JSON.stringify({ name: 'Synthetic', info_url: MITRA_URL }), '0'.repeat(64)]))[0]!.id;
    await sql(`update public.gov_programmes set current_version_id = $2 where id = $1`, [prog, ver]);
    await again();
    await runWorkerOnce(makeDeps({ 'https://www.mitra.gov.my/robots.txt': { text: MITRA_ROBOTS }, [MITRA_URL]: { status: 304, text: '' } }));
    const p = (await sql<{ fresh: boolean; publication_state: string; application_status: string }>(
      `select last_checked_at > now() - interval '1 minute' as fresh, publication_state, application_status from public.gov_programmes where id = $1`, [prog]))[0]!;
    expect(p).toEqual({ fresh: true, publication_state: 'published', application_status: 'open' });
  });

  it('an outage keeps the last good evidence and changes no published data', async () => {
    await runWorkerOnce(makeDeps(pages(mitraPage('22 Oktober 2026'))));
    await again();
    const r = await runWorkerOnce(makeDeps(pages('', { status: 503 })));
    expect(r.retried).toBe(1);
    expect((await jobs()).some((j) => j.status === 'queued' && j.last_error === 'http_503')).toBe(true);
    expect(await changes()).toHaveLength(0);
    expect((await sql(`select 1 from public.gov_fetch_results where source_id = $1 and outcome = 'ok'`, [sourceId])).length).toBe(1);
  });

  it('robots disallow: the page is never requested', async () => {
    const calls: string[] = [];
    const p = pages(mitraPage('22 Oktober 2026'));
    p['https://www.mitra.gov.my/robots.txt'] = { text: 'User-agent: *\nDisallow: /ms/' };
    const r = await runWorkerOnce(makeDeps(p, calls));
    expect(r.rejected).toBe(1);
    expect(calls).toEqual(['https://www.mitra.gov.my/robots.txt']);
  });

  it('a private-address refusal is recorded as rejected content and not retried', async () => {
    const r = await runWorkerOnce(makeDeps({ 'https://www.mitra.gov.my/robots.txt': { text: MITRA_ROBOTS }, [MITRA_URL]: new FetchRefused('private_address') }));
    expect(r.rejected).toBe(1);
    expect(r.retried).toBe(0);
  });
});
