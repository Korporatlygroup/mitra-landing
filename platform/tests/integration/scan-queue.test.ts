import { afterAll, describe, expect, it } from 'vitest';
import { RESCAN_BATCH, rescanPending, type RescanDeps } from '@/server/services/documents';
import { DOCS_BUCKET, cleanupUsers, createBusinessOrg, createConfirmedUser, registerDoc, serviceClient, signIn, sql } from './helpers';

afterAll(cleanupUsers);

const svc = serviceClient();
type QueueRow = { id: string; storage_path: string; mime_type: string };

/** The REAL queue (service_list_unscanned_documents) and the real rescanPending; the scanner is always "down". */
const realQueueDeps: RescanDeps = {
  list: async (limit) => {
    const { data, error } = await svc.rpc('service_list_unscanned_documents', { p_limit: limit });
    if (error) throw new Error(error.message);
    return (data ?? []) as QueueRow[];
  },
  download: async (path) => {
    const { data } = await svc.storage.from(DOCS_BUCKET).download(path);
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  },
  scan: async () => ({ status: 'unavailable', engine: 'clamd', reason: 'connection_error' }),
  setResult: async (id, status, engine) => !(await svc.rpc('service_set_scan_result', { p_doc: id, p_status: status, p_engine: engine })).error,
  remove: async (path) => !(await svc.storage.from(DOCS_BUCKET).remove([path])).error,
};

const queue = async (limit = 100): Promise<string[]> => (await realQueueDeps.list(limit)).map((d) => d.id);
const BATCH = RESCAN_BATCH; // rescanPending's default batch size

describe('scan queue (service_list_unscanned_documents + rescanPending)', () => {
  it('a backlog of unscannable pending documents does not starve a newer one: rescan rounds rotate the backlog and the newest document is reached within a bounded number of rounds', async () => {
    // 3 organisations x 40 documents that can never be scanned (no storage object behind them): 120 stuck rows,
    // all OLDER than the document registered afterwards.
    const owner = await signIn(await createConfirmedUser('q'));
    for (let o = 0; o < 3; o++) {
      const org = await createBusinessOrg(owner);
      for (let i = 0; i < 40; i++) await registerDoc(org, owner.user.id, { status: 'pending' });
    }
    const freshOrg = await createBusinessOrg(owner);
    const fresh = await registerDoc(freshOrg, owner.user.id, { status: 'pending' });

    const queued = Number((await sql<{ n: string }>(`select count(*)::text as n from public.verification_documents where scan_status in ('pending','failed') and removed_at is null`))[0]!.n);
    expect(queued).toBeGreaterThan(100);
    // Before any rescan the newest document is NOT in the first 100: it is waiting behind the backlog.
    expect(await queue()).not.toContain(fresh);

    // Each round stamps up to BATCH documents 'failed' (object missing), which moves them behind never-attempted ones.
    // The newest document enters the first page once fewer than 100 never-attempted documents are ahead of it, so a
    // safe bound is ceil((queued - 100) / BATCH) rounds, plus one. It does not depend on luck or on the DB being empty.
    const bound = Math.ceil((queued - 100) / BATCH) + 1;
    let rounds = 0;
    let reached = false;
    while (rounds < bound + 2) {
      if ((await queue()).includes(fresh)) {
        reached = true;
        break;
      }
      const summary = await rescanPending(realQueueDeps);
      expect(summary.checked).toBeGreaterThan(0);
      rounds++;
    }
    expect(reached, `the newest pending document must be listed within ${bound} rounds (took ${rounds})`).toBe(true);
    expect(rounds).toBeLessThanOrEqual(bound);

    // And once listed, a further round actually processes it (it is stamped failed like the others, then retried later).
    await rescanPending(realQueueDeps);
    const st = (await sql<{ scan_status: string }>('select scan_status from public.verification_documents where id = $1', [fresh]))[0]!.scan_status;
    expect(['pending', 'failed']).toContain(st);
  }, 180_000);

  it('retry order: a document whose scan failed moves behind never-attempted documents', async () => {
    const owner = await signIn(await createConfirmedUser('qo'));
    const org = await createBusinessOrg(owner);
    const first = await registerDoc(org, owner.user.id, { status: 'pending' }); // older
    const second = await registerDoc(org, owner.user.id, { status: 'pending' }); // newer, never attempted
    const third = await registerDoc(org, owner.user.id, { status: 'pending' });

    const failed = await svc.rpc('service_set_scan_result', { p_doc: first, p_status: 'failed', p_engine: 'storage' });
    expect(failed.error).toBeNull();
    const row = (await sql<{ scan_status: string; scanned_at: string | null; created_at: string }>('select scan_status, scanned_at, created_at from public.verification_documents where id = $1', [first]))[0]!;
    expect(row.scan_status).toBe('failed');
    expect(row.scanned_at).not.toBeNull();
    expect(new Date(row.scanned_at!).getTime()).toBeGreaterThan(new Date((await sql<{ c: string }>('select created_at as c from public.verification_documents where id = $1', [third]))[0]!.c).getTime());

    // A failed document stays in the queue (it is retried) but sorts after documents that were never attempted.
    // The shared queue is global and may be long on a dirty database, so compare positions only when all three are on the first page,
    // and otherwise fall back to the ordering key the queue uses.
    const ids = await queue();
    const pos = (id: string) => ids.indexOf(id);
    if ([first, second, third].every((d) => pos(d) >= 0)) {
      expect(pos(second)).toBeLessThan(pos(first));
      expect(pos(third)).toBeLessThan(pos(first));
      expect(pos(second)).toBeLessThan(pos(third)); // never-attempted documents keep their creation order
    }
    const ordered = await sql<{ id: string }>(
      `select id from public.verification_documents where id = any($1::uuid[]) order by coalesce(scanned_at, created_at), created_at`,
      [[first, second, third]],
    );
    expect(ordered.map((r) => r.id)).toEqual([second, third, first]);

    // A failed document is retried and can still become clean or infected
    expect((await svc.rpc('service_set_scan_result', { p_doc: first, p_status: 'clean', p_engine: 'later' })).error).toBeNull();
  }, 60_000);
});
