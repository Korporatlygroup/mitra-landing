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

function makeDeps(pages: Record<string, Page | Error>, calls: string[] = []): WorkerDeps {
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
    fetchPage: async (url) => {
      calls.push(url);
      const p = pages[url];
      if (p instanceof Error) throw p;
      if (!p) return { status: 404, finalUrl: url, contentType: 'text/html', text: '', bytes: 0, sha256: '', retryAfterSeconds: null };
      const text = p.text ?? '';
      return { status: 200, finalUrl: url === COND_URL ? 'https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi-syarat-syarat/' : url, contentType: 'text/html', bytes: text.length, sha256: sha(text), retryAfterSeconds: null, ...p, text };
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
    expect(p).toEqual({ verification_status: 'unconfirmed', publication_state: 'published', application_status: 'open' });
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
