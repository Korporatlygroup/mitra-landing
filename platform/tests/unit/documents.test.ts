import { describe, expect, it } from 'vitest';
import type { ScanOutcome } from '@/server/scanner';
import { ingestDocument, rescanPending, type IngestDeps, type RescanDeps } from '@/server/services/documents';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const pdfBytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj <</Type /Catalog>> endobj\n%%EOF');

function makeDeps(opts: { scan: ScanOutcome | (() => Promise<ScanOutcome>); uploadOk?: boolean; register?: IngestDeps['register'] }) {
  const calls: string[] = [];
  const stored = new Map<string, Uint8Array>();
  const registered: Parameters<IngestDeps['register']>[0][] = [];
  const rejected: { reason: string; sha: string | null }[] = [];
  const deps: IngestDeps = {
    async scan() {
      calls.push('scan');
      return typeof opts.scan === 'function' ? opts.scan() : opts.scan;
    },
    async upload(path, bytes) {
      calls.push('upload');
      if (opts.uploadOk === false) return false;
      stored.set(path, bytes);
      return true;
    },
    async remove(path) {
      calls.push('remove');
      return stored.delete(path);
    },
    async register(input) {
      calls.push('register');
      registered.push(input);
      return opts.register ? opts.register(input) : { ok: true, id: 'doc-1' };
    },
    async recordRejected(_o, _u, _c, reason, sha) {
      calls.push('rejected');
      rejected.push({ reason, sha });
    },
    newId: () => 'fixed-id',
  };
  return { deps, calls, stored, registered, rejected };
}

const input = (over: Partial<Parameters<typeof ingestDocument>[1]> = {}) => ({
  orgId: ORG,
  userId: USER,
  claimType: 'business_registration',
  docType: 'ssm_certificate',
  fileName: 'cert.pdf',
  declaredMime: 'application/pdf',
  bytes: pdfBytes,
  ...over,
});

describe('ingestDocument', () => {
  it('clean: scans, stores, registers as clean with a server-chosen path', async () => {
    const t = makeDeps({ scan: { status: 'clean', engine: 'clamd' } });
    const r = await ingestDocument(t.deps, input());
    expect(r).toEqual({ ok: true, documentId: 'doc-1', scanStatus: 'clean' });
    expect(t.calls).toEqual(['scan', 'upload', 'register']);
    expect(t.registered[0]).toMatchObject({
      scanStatus: 'clean',
      scanEngine: 'clamd',
      storagePath: `${ORG}/business_registration/fixed-id.pdf`,
      mime: 'application/pdf',
      size: pdfBytes.length,
    });
    expect(t.registered[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('infected: stores nothing, registers nothing, records the rejection', async () => {
    const t = makeDeps({ scan: { status: 'infected', engine: 'clamd', signature: 'Eicar' } });
    const r = await ingestDocument(t.deps, input());
    expect(r).toEqual({ ok: false, errorKey: 'file_infected' });
    expect(t.calls).toEqual(['scan', 'rejected']);
    expect(t.stored.size).toBe(0);
    expect(t.rejected[0].reason).toBe('infected');
    expect(t.rejected[0].sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each<[string, ScanOutcome]>([
    ['unavailable', { status: 'unavailable', engine: 'clamd', reason: 'timeout' }],
    ['not configured', { status: 'unavailable', engine: 'clamd', reason: 'not_configured' }],
  ])('scanner %s: quarantines (stored privately, registered pending, no scan engine claimed)', async (_n, outcome) => {
    const t = makeDeps({ scan: outcome });
    const r = await ingestDocument(t.deps, input());
    expect(r).toEqual({ ok: true, documentId: 'doc-1', scanStatus: 'pending' });
    expect(t.registered[0]).toMatchObject({ scanStatus: 'pending', scanEngine: null });
    expect(t.stored.size).toBe(1);
  });

  it('a scanner that throws is not trusted blindly: the error propagates before anything is written', async () => {
    const t = makeDeps({ scan: async () => Promise.reject(new Error('boom')) });
    await expect(ingestDocument(t.deps, input())).rejects.toThrow('boom');
    expect(t.stored.size).toBe(0);
    expect(t.calls).toEqual(['scan']);
  });

  it('always scans BEFORE writing and registers AFTER writing', async () => {
    for (const scan of [
      { status: 'clean', engine: 'clamd' } as ScanOutcome,
      { status: 'unavailable', engine: 'clamd', reason: 'x' } as ScanOutcome,
    ]) {
      const t = makeDeps({ scan });
      await ingestDocument(t.deps, input());
      expect(t.calls.indexOf('scan')).toBeLessThan(t.calls.indexOf('upload'));
      expect(t.calls.indexOf('upload')).toBeLessThan(t.calls.indexOf('register'));
    }
  });

  it('rolls the stored object back when registration fails', async () => {
    const t = makeDeps({
      scan: { status: 'clean', engine: 'clamd' },
      register: async () => ({ ok: false, error: { code: 'PT409', message: 'document_limit_reached' } }),
    });
    const r = await ingestDocument(t.deps, input());
    expect(r).toEqual({ ok: false, errorKey: 'document_limit_reached' });
    expect(t.calls).toEqual(['scan', 'upload', 'register', 'remove']);
    expect(t.stored.size).toBe(0);
  });

  it('fails without registering when the upload itself fails', async () => {
    const t = makeDeps({ scan: { status: 'clean', engine: 'clamd' }, uploadOk: false });
    expect(await ingestDocument(t.deps, input())).toEqual({ ok: false, errorKey: 'upload_failed' });
    expect(t.calls).toEqual(['scan', 'upload']);
  });

  it('validation failures never reach the scanner or storage and are recorded', async () => {
    const t = makeDeps({ scan: { status: 'clean', engine: 'clamd' } });
    const spoof = await ingestDocument(t.deps, input({ fileName: 'x.pdf', bytes: new TextEncoder().encode('MZ....') }));
    expect(spoof).toEqual({ ok: false, errorKey: 'file_type_not_allowed' });
    const empty = await ingestDocument(t.deps, input({ bytes: new Uint8Array() }));
    expect(empty).toEqual({ ok: false, errorKey: 'file_empty' });
    const risky = await ingestDocument(
      t.deps,
      input({ bytes: new TextEncoder().encode('%PDF-1.7\n<</S /JavaScript /JS (x)>>') }),
    );
    expect(risky).toEqual({ ok: false, errorKey: 'file_unsafe_content' });
    expect(t.calls.filter((c) => c === 'scan' || c === 'upload' || c === 'register')).toEqual([]);
    expect(t.rejected.map((r) => r.reason)).toEqual(['bad_type', 'empty', 'unsafe_content']);
  });

  it('uses the validated extension for the path, not the file name', async () => {
    const t = makeDeps({ scan: { status: 'clean', engine: 'clamd' } });
    await ingestDocument(t.deps, input({ fileName: '../../evil.pdf' }));
    expect(t.registered[0].storagePath).toBe(`${ORG}/business_registration/fixed-id.pdf`);
    expect(t.registered[0].displayName).toBe('evil.pdf');
  });
});

describe('rescanPending', () => {
  function rescanDeps(map: Record<string, ScanOutcome | 'missing'>) {
    const results: Record<string, string> = {};
    const removed: string[] = [];
    const deps: RescanDeps = {
      list: async () => Object.keys(map).map((id) => ({ id, storage_path: `p/${id}`, mime_type: 'application/pdf' })),
      download: async (path) => (map[path.slice(2)] === 'missing' ? null : new Uint8Array([1, 2, 3])),
      scan: async () => map[Object.keys(map).find((k) => !(k in results) && !removed.includes(`p/${k}`)) ?? ''] as ScanOutcome,
      setResult: async (id, status) => {
        results[id] = status;
        return true;
      },
      remove: async (path) => {
        removed.push(path);
        return true;
      },
    };
    return { deps, results, removed };
  }

  it('marks clean, marks infected then deletes the object, and stamps unavailable ones failed (waiting)', async () => {
    const outcomes: ScanOutcome[] = [
      { status: 'clean', engine: 'clamd' },
      { status: 'infected', engine: 'clamd', signature: 'X' },
      { status: 'unavailable', engine: 'clamd', reason: 'timeout' },
    ];
    let i = 0;
    const results: Record<string, string> = {};
    const removed: string[] = [];
    const order: string[] = [];
    const deps: RescanDeps = {
      list: async () => ['a', 'b', 'c'].map((id) => ({ id, storage_path: `p/${id}`, mime_type: 'application/pdf' })),
      download: async () => new Uint8Array([1]),
      scan: async () => outcomes[i++],
      setResult: async (id, status) => {
        results[id] = status;
        order.push(`set:${id}`);
        return true;
      },
      remove: async (p) => {
        removed.push(p);
        order.push(`remove:${p}`);
        return true;
      },
    };
    const s = await rescanPending(deps);
    expect(s).toEqual({ checked: 3, clean: 1, infected: 1, waiting: 1, remaining: 1 });
    expect(results).toEqual({ a: 'clean', b: 'infected', c: 'failed' });
    expect(removed).toEqual(['p/b']);
    expect(order.indexOf('set:b')).toBeLessThan(order.indexOf('remove:p/b'));
  });

  it('keeps the object if the infected status could not be recorded', async () => {
    const removed: string[] = [];
    const deps: RescanDeps = {
      list: async () => [{ id: 'a', storage_path: 'p/a', mime_type: 'application/pdf' }],
      download: async () => new Uint8Array([1]),
      scan: async () => ({ status: 'infected', engine: 'clamd', signature: 'X' }),
      setResult: async () => false,
      remove: async (p) => {
        removed.push(p);
        return true;
      },
    };
    expect(await rescanPending(deps)).toMatchObject({ infected: 0, waiting: 1 });
    expect(removed).toEqual([]);
  });

  it('counts missing objects as waiting and does not scan them', async () => {
    const t = rescanDeps({ a: 'missing' });
    const s = await rescanPending(t.deps);
    expect(s).toEqual({ checked: 1, clean: 0, infected: 0, waiting: 1, remaining: 1 });
  });

  it('stamps a document failed when it cannot be downloaded and carries on with the next one (no queue starvation)', async () => {
    const marks: [string, string, string][] = [];
    const scanned: string[] = [];
    const deps: RescanDeps = {
      list: async () => ['a', 'b', 'c'].map((id) => ({ id, storage_path: `p/${id}`, mime_type: 'application/pdf' })),
      download: async (path) => (path === 'p/a' ? null : new Uint8Array([1])),
      scan: async () => {
        scanned.push('x');
        return { status: 'clean', engine: 'clamd' };
      },
      setResult: async (id, status, engine) => {
        marks.push([id, status, engine]);
        return true;
      },
      remove: async () => true,
    };
    const s = await rescanPending(deps);
    expect(marks).toEqual([
      ['a', 'failed', 'storage'],
      ['b', 'clean', 'clamd'],
      ['c', 'clean', 'clamd'],
    ]);
    expect(scanned).toHaveLength(2);
    expect(s).toMatchObject({ checked: 3, clean: 2, infected: 0, waiting: 1 });
  });

  it('stamps failed when the scanner is down or errors, and keeps going', async () => {
    const marks: [string, string][] = [];
    const outcomes: ScanOutcome[] = [
      { status: 'unavailable', engine: 'clamd', reason: 'timeout' },
      { status: 'clean', engine: 'clamd' },
    ];
    let i = 0;
    const deps: RescanDeps = {
      list: async () => ['a', 'b'].map((id) => ({ id, storage_path: `p/${id}`, mime_type: 'application/pdf' })),
      download: async () => new Uint8Array([1]),
      scan: async () => outcomes[i++],
      setResult: async (id, status) => {
        marks.push([id, status]);
        return true;
      },
      remove: async () => true,
    };
    const s = await rescanPending(deps);
    expect(marks).toEqual([['a', 'failed'], ['b', 'clean']]);
    expect(s).toMatchObject({ clean: 1, waiting: 1 });
  });

  it('does nothing at all when the scanner is not configured (no failed stamps, run stops)', async () => {
    const marks: string[] = [];
    let scans = 0;
    const deps: RescanDeps = {
      list: async () => ['a', 'b', 'c'].map((id) => ({ id, storage_path: `p/${id}`, mime_type: 'application/pdf' })),
      download: async () => new Uint8Array([1]),
      scan: async () => {
        scans++;
        return { status: 'unavailable', engine: 'clamd', reason: 'not_configured' };
      },
      setResult: async (id) => {
        marks.push(id);
        return true;
      },
      remove: async () => true,
    };
    const s = await rescanPending(deps);
    expect(marks).toEqual([]);
    expect(scans).toBe(1);
    expect(s).toMatchObject({ clean: 0, infected: 0, remaining: 3 });
  });
});
