import { normalizePage } from './page-monitor';
import { robotsAllows } from './robots';
import { FetchRefused, type SafeFetchResult } from './safe-fetch';
import { ExtractionError, extractTekunScheme, findConditionsLink } from './tekun';
import crypto from 'node:crypto';

/**
 * Bounded monitoring run (Phase 7). One call: queue due sources, claim a few jobs, process each, report.
 * All state lives in the database (leases, attempts, results), so a crash or a second concurrent run is safe:
 * an unfinished job's lease expires and it is retried; the same content is never queued twice.
 * A failed fetch only ever updates job and source health. Published programmes are changed solely by a human
 * decision in gov_decide_proposal.
 */

export const WORKER_RPCS = [
  'gov_enqueue_due_jobs', 'gov_claim_jobs', 'gov_job_source', 'gov_complete_job', 'gov_fail_job', 'gov_submit_candidate', 'gov_mark_missing',
  'gov_enqueue_reminders', 'gov_dispatch_outbox', 'gov_mark_email',
  'gov_last_validators', 'gov_record_page', 'gov_mark_unchanged',
  'news_digest_candidates', 'news_digest_posts', 'news_digest_claim', 'news_digest_release',
] as const;
export type WorkerRpc = (typeof WORKER_RPCS)[number];

export type GovRpc = (name: WorkerRpc, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

export interface WorkerDeps {
  rpc: GovRpc;
  /** `validators` (ETag / Last-Modified of the last good answer) turn the request conditional; the server may answer 304. */
  fetchPage: (url: string, allowedHosts: string[], validators?: { etag?: string | null; lastModified?: string | null }) => Promise<SafeFetchResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  workerId: string;
  agentToken: string;
  /** Longest pause between two requests inside one job (default 3 s). The per-source rate limit is enforced between jobs by the database. */
  maxGapMs?: number;
}

export interface RunSummary {
  enqueued: number;
  claimed: number;
  succeeded: number;
  retried: number;
  rejected: number;
  submitted: Record<string, number>;
  /** Page monitors: pages that changed since the last look (each waits for a person) and pages the server said were not modified. */
  pageChanged: number;
  notModified: number;
  errors: string[];
}

interface Job { id: string; source_id: string; target_url: string; attempts: number }
interface JobSource { source_id: string; adapter: string; allowed_hosts: string[]; rate_per_minute: number; parser_version: string }

const must = async <T>(p: ReturnType<GovRpc>, what: string): Promise<T> => {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.code ?? ''} ${error.message}`.trim());
  return data as T;
};

export interface RunOptions { limit?: number; leaseSeconds?: number; budgetMs?: number }

export async function runWorkerOnce(deps: WorkerDeps, opts: RunOptions = {}): Promise<RunSummary> {
  const summary: RunSummary = { enqueued: 0, claimed: 0, succeeded: 0, retried: 0, rejected: 0, submitted: {}, pageChanged: 0, notModified: 0, errors: [] };
  const started = deps.now();
  const budget = opts.budgetMs ?? 40_000;
  summary.enqueued = await must<number>(deps.rpc('gov_enqueue_due_jobs'), 'enqueue');
  const jobs = await must<Job[]>(deps.rpc('gov_claim_jobs', { p_worker: deps.workerId, p_limit: opts.limit ?? 3, p_lease_seconds: opts.leaseSeconds ?? 120 }), 'claim');
  summary.claimed = jobs.length;
  const robots = new Map<string, string | 'unavailable'>();
  for (const job of jobs) {
    if (deps.now() - started > budget) {
      // Out of budget: leave the job leased; its lease expires and it is picked up again (attempt already counted).
      summary.errors.push(`budget_exhausted:${job.id}`);
      continue;
    }
    try {
      await processJob(deps, job, summary, robots);
    } catch (err) {
      // Anything unexpected: record a failed attempt (retry with backoff), never throw away the run.
      summary.errors.push(`job_error:${job.id}:${(err as Error).message.slice(0, 120)}`);
      await deps.rpc('gov_fail_job', { p_job: job.id, p_worker: deps.workerId, p_error: `unexpected:${(err as Error).name}` });
      summary.retried += 1;
    }
  }
  return summary;
}

async function complete(deps: WorkerDeps, job: Job, result: Record<string, unknown>): Promise<string> {
  return must<string>(deps.rpc('gov_complete_job', { p_job: job.id, p_worker: deps.workerId, p_result: result }), 'complete');
}

async function processJob(deps: WorkerDeps, job: Job, summary: RunSummary, robots: Map<string, string | 'unavailable'>): Promise<void> {
  const rows = await must<JobSource[]>(deps.rpc('gov_job_source', { p_job: job.id }), 'job_source');
  const src = rows[0];
  if (!src) throw new Error('source_missing');
  if (src.adapter === 'page_monitor') return processPageMonitor(deps, job, src, summary, robots);
  if (src.adapter !== 'tekun') {
    await deps.rpc('gov_fail_job', { p_job: job.id, p_worker: deps.workerId, p_error: 'unknown_adapter' });
    summary.rejected += 1;
    return;
  }
  const gapMs = Math.min(Math.ceil(60_000 / Math.max(1, src.rate_per_minute)), deps.maxGapMs ?? 3000);
  const target = new URL(job.target_url);
  const fail = async (error: string, retryAfter?: number | null) => {
    await deps.rpc('gov_fail_job', { p_job: job.id, p_worker: deps.workerId, p_error: error, p_retry_after_seconds: retryAfter ?? null });
    summary.retried += 1;
  };
  const reject = async (reason: string) => {
    await complete(deps, job, { outcome: 'rejected_content', evidence_excerpt: reason, parser_version: src.parser_version });
    summary.rejected += 1;
  };

  try {
    // robots.txt first: unreadable robots is treated as "do not fetch" (conservative), retried later.
    let robotsTxt = robots.get(target.host);
    if (robotsTxt === undefined) {
      const r = await deps.fetchPage(`https://${target.host}/robots.txt`, src.allowed_hosts);
      robotsTxt = r.status === 404 || r.status === 410 ? '' : r.status === 200 ? r.text : 'unavailable';
      robots.set(target.host, robotsTxt);
      await deps.sleep(gapMs);
    }
    if (robotsTxt === 'unavailable') return fail('robots_unavailable');
    if (!robotsAllows(robotsTxt, deps.agentToken, target.pathname)) return reject('robots_disallow');

    const page = await deps.fetchPage(job.target_url, src.allowed_hosts);
    if (page.status === 404 || page.status === 410) {
      const key = target.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
      await complete(deps, job, { outcome: 'gone', http_status: page.status, parser_version: src.parser_version });
      await deps.rpc('gov_mark_missing', { p_source: src.source_id, p_external_key: key });
      summary.rejected += 1;
      return;
    }
    if (page.status !== 200) return fail(`http_${page.status}`, page.retryAfterSeconds);

    let conditionsHtml: string | null = null;
    let conditionsSha = '';
    const link = findConditionsLink(page.text, page.finalUrl);
    if (link) {
      await deps.sleep(gapMs);
      const cond = await deps.fetchPage(link, src.allowed_hosts);
      // Without the conditions page the record would be incomplete and look like a spurious change: retry instead.
      if (cond.status !== 200) return fail(`conditions_http_${cond.status}`, cond.retryAfterSeconds);
      if (!robotsAllows(robotsTxt, deps.agentToken, new URL(cond.finalUrl).pathname)) return reject('robots_disallow_conditions');
      conditionsHtml = cond.text;
      conditionsSha = cond.sha256;
    }

    let extracted;
    try {
      extracted = extractTekunScheme({ schemeHtml: page.text, schemeUrl: page.finalUrl, conditionsHtml });
    } catch (err) {
      if (err instanceof ExtractionError) {
        await complete(deps, job, { outcome: 'parse_failed', http_status: 200, content_sha256: page.sha256, byte_length: page.bytes, content_type: page.contentType, parser_version: src.parser_version, evidence_excerpt: `layout_changed:${err.reason}` });
        summary.rejected += 1;
        return;
      }
      throw err;
    }
    const combined = crypto.createHash('sha256').update(page.sha256 + conditionsSha).digest('hex');
    const resultId = await complete(deps, job, {
      outcome: 'ok', http_status: 200, content_type: page.contentType, content_sha256: combined, byte_length: page.bytes,
      parser_version: src.parser_version, evidence_excerpt: extracted.evidence, etag: page.etag, last_modified: page.lastModified,
    });
    const status = await must<string>(
      deps.rpc('gov_submit_candidate', { p_source: src.source_id, p_result: resultId, p_external_key: extracted.externalKey, p_candidate: extracted.candidate }),
      'submit',
    );
    summary.submitted[status] = (summary.submitted[status] ?? 0) + 1;
    summary.succeeded += 1;
  } catch (err) {
    if (err instanceof FetchRefused) {
      if (err.code === 'timeout' || err.code === 'network') return fail(err.code);
      // Content or configuration problem (wrong type, too large, blocked host/address): not retried blindly.
      return reject(`refused:${err.code}`);
    }
    throw err;
  }
}

/**
 * Generic page monitor: no programme is ever created from it. It notices that a page (or the set of links on it) changed and
 * leaves a review item for a person (gov_record_page). Conditional requests save the source's bandwidth: a 304 is a successful
 * check that also refreshes the freshness of programmes whose information page this is.
 */
async function processPageMonitor(deps: WorkerDeps, job: Job, src: JobSource, summary: RunSummary, robots: Map<string, string | 'unavailable'>): Promise<void> {
  const gapMs = Math.min(Math.ceil(60_000 / Math.max(1, src.rate_per_minute)), deps.maxGapMs ?? 3000);
  const target = new URL(job.target_url);
  const fail = async (error: string, retryAfter?: number | null) => {
    await deps.rpc('gov_fail_job', { p_job: job.id, p_worker: deps.workerId, p_error: error, p_retry_after_seconds: retryAfter ?? null });
    summary.retried += 1;
  };
  const reject = async (reason: string) => {
    await complete(deps, job, { outcome: 'rejected_content', evidence_excerpt: reason, parser_version: src.parser_version });
    summary.rejected += 1;
  };
  try {
    let robotsTxt = robots.get(target.host);
    if (robotsTxt === undefined) {
      const r = await deps.fetchPage(`https://${target.host}/robots.txt`, src.allowed_hosts);
      robotsTxt = r.status === 404 || r.status === 410 ? '' : r.status === 200 ? r.text : 'unavailable';
      robots.set(target.host, robotsTxt);
      await deps.sleep(gapMs);
    }
    if (robotsTxt === 'unavailable') return fail('robots_unavailable');
    if (!robotsAllows(robotsTxt, deps.agentToken, target.pathname)) return reject('robots_disallow');

    const known = (await must<{ etag: string | null; last_modified: string | null }[] | null>(
      deps.rpc('gov_last_validators', { p_source: src.source_id, p_url: job.target_url }), 'validators',
    ))?.[0];
    const page = await deps.fetchPage(job.target_url, src.allowed_hosts, known ? { etag: known.etag, lastModified: known.last_modified } : undefined);

    if (page.status === 304) {
      await complete(deps, job, { outcome: 'unchanged', http_status: 304, parser_version: src.parser_version, etag: page.etag ?? known?.etag ?? null, last_modified: page.lastModified ?? known?.last_modified ?? null });
      await deps.rpc('gov_mark_unchanged', { p_source: src.source_id, p_url: job.target_url });
      summary.notModified += 1;
      summary.succeeded += 1;
      return;
    }
    if (page.status === 404 || page.status === 410) {
      await complete(deps, job, { outcome: 'gone', http_status: page.status, parser_version: src.parser_version });
      summary.rejected += 1;
      return;
    }
    if (page.status !== 200) return fail(`http_${page.status}`, page.retryAfterSeconds);

    const n = normalizePage(page.text, page.finalUrl);
    // A blank or maintenance page must not become the comparison baseline.
    if (n.text.length < 40) {
      await complete(deps, job, { outcome: 'parse_failed', http_status: 200, content_sha256: page.sha256, byte_length: page.bytes, content_type: page.contentType, parser_version: src.parser_version, evidence_excerpt: 'layout_changed:empty_page', etag: page.etag, last_modified: page.lastModified });
      summary.rejected += 1;
      return;
    }
    const resultId = await complete(deps, job, {
      outcome: 'ok', http_status: 200, content_type: page.contentType, content_sha256: crypto.createHash('sha256').update(n.normalized).digest('hex'),
      byte_length: page.bytes, parser_version: src.parser_version, evidence_excerpt: n.normalized, etag: page.etag, last_modified: page.lastModified,
    });
    summary.succeeded += 1;
    try {
      const verdict = await must<string>(deps.rpc('gov_record_page', { p_result: resultId }), 'record_page');
      if (verdict === 'changed') summary.pageChanged += 1;
    } catch (err) {
      // The check itself succeeded and is stored; only the comparison failed. It is repeated on the next look.
      summary.errors.push(`record_page:${job.id}:${(err as Error).message.slice(0, 120)}`);
    }
  } catch (err) {
    if (err instanceof FetchRefused) {
      if (err.code === 'timeout' || err.code === 'network') return fail(err.code);
      return reject(`refused:${err.code}`);
    }
    throw err;
  }
}
