import { describe, expect, it } from 'vitest';
import { MAX_PLAIN_BODY_BYTES, isOversizedNonUpload } from '@/lib/body-guard';
import { CODE_KEYS, KNOWN_MESSAGE_KEYS, mapRpcError } from '@/lib/errors';
import { LIMITS, uploadOrgKey, uploadUserKey } from '@/lib/throttle';
import { MAX_CONCURRENT_SCANS, createLimiter } from '@/server/scanner';
import { RESCAN_BATCH, rescanPending, type RescanDeps } from '@/server/services/documents';
import en from '../../messages/en.json';
import ta from '../../messages/ta.json';
import { flatten, read } from './helpers';

describe('new error keys', () => {
  it.each(['evidence_not_clean', 'org_not_active'])('%s is mapped and translated in EN and TA', (key) => {
    expect(KNOWN_MESSAGE_KEYS).toContain(key);
    expect(mapRpcError({ code: 'PT409', message: key })).toBe(key);
    expect(flatten(en)[`errors.${key}`]).toBeTruthy();
    expect(flatten(ta)[`errors.${key}`]).toBeTruthy();
    expect(CODE_KEYS.PT409).toBe('conflict');
  });
  it('the admin evidence warning exists in both languages', () => {
    expect(flatten(en)['adminVer.evidenceWarning']).toBeTruthy();
    expect(flatten(ta)['adminVer.evidenceWarning']).toBeTruthy();
  });
});

describe('upload throttle', () => {
  it('uses the contracted keys and limits', () => {
    expect(uploadUserKey('u1')).toBe('upload:u:u1');
    expect(uploadOrgKey('o1')).toBe('upload:o:o1');
    expect(LIMITS.uploadUser).toEqual({ max: 30, windowSeconds: 3600 });
    expect(LIMITS.uploadOrg).toEqual({ max: 120, windowSeconds: 3600 });
  });
  it('authAttempt fails closed on any error', () => {
    const src = read('src/server/privileged.ts');
    const body = src.slice(src.indexOf('export async function authAttempt'), src.indexOf('// ----'));
    expect(body).toContain('return false');
    expect(body.match(/return false/g)!.length).toBeGreaterThanOrEqual(2);
    expect(body).toContain('data === true');
  });
});

describe('scanner concurrency cap', () => {
  it('never runs more than the limit at once and keeps FIFO order', async () => {
    const limit = createLimiter(MAX_CONCURRENT_SCANS);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limit(async () => {
          started.push(i);
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(MAX_CONCURRENT_SCANS).toBe(4);
    expect(peak).toBe(4);
    expect(started).toEqual([...started].sort((a, b) => a - b));
  });
  it('releases a slot when a task throws', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limit(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('rescan batching', () => {
  it('processes at most RESCAN_BATCH documents per call and reports what remains', async () => {
    const docs = Array.from({ length: 23 }, (_, i) => ({ id: `d${i}`, storage_path: `p/d${i}`, mime_type: 'application/pdf' }));
    const done: string[] = [];
    const deps: RescanDeps = {
      list: async () => docs,
      download: async () => new Uint8Array([1]),
      scan: async () => ({ status: 'clean', engine: 'clamd' }),
      setResult: async (id) => {
        done.push(id);
        return true;
      },
      remove: async () => true,
    };
    const s = await rescanPending(deps);
    expect(RESCAN_BATCH).toBe(10);
    expect(done).toHaveLength(10);
    expect(s).toEqual({ checked: 10, clean: 10, infected: 0, waiting: 0, remaining: 13 });
  });
  it('the route uses the batch constant and keeps strict auth', () => {
    const route = read('src/app/api/v1/jobs/rescan/route.ts');
    expect(route).toContain('RESCAN_BATCH');
    expect(route).toContain('status: 401');
    expect(route).toContain('status: 404');
  });
});

describe('body guard', () => {
  const upload = '/en/orgs/94391b75-b9c5-40ec-9cc4-cb8f2bfbac86/business/onboarding';
  const big = String(MAX_PLAIN_BODY_BYTES + 1);
  it('refuses big POSTs everywhere except the two upload pages', () => {
    expect(isOversizedNonUpload('POST', big, '/en/login')).toBe(true);
    expect(isOversizedNonUpload('POST', big, '/ta/signup')).toBe(true);
    expect(isOversizedNonUpload('POST', big, '/en/orgs/94391b75-b9c5-40ec-9cc4-cb8f2bfbac86/members')).toBe(true);
    expect(isOversizedNonUpload('POST', big, upload)).toBe(false);
    expect(isOversizedNonUpload('POST', big, upload.replace('onboarding', 'verification') + '/')).toBe(false);
    expect(isOversizedNonUpload('POST', big, '/en/orgs/not-an-id/business/onboarding')).toBe(true);
  });
  it('lets normal sizes, GETs and missing lengths through', () => {
    expect(isOversizedNonUpload('POST', String(MAX_PLAIN_BODY_BYTES), '/en/login')).toBe(false);
    expect(isOversizedNonUpload('POST', '1200', '/en/login')).toBe(false);
    expect(isOversizedNonUpload('GET', big, '/en/login')).toBe(false);
    expect(isOversizedNonUpload('POST', null, '/en/login')).toBe(false);
    expect(isOversizedNonUpload('POST', 'abc', '/en/login')).toBe(false);
  });
  it('is wired into the proxy and documented', () => {
    expect(read('src/proxy.ts')).toContain('isOversizedNonUpload(');
    expect(read('README.md')).toMatch(/residual risk/i);
    expect(read('next.config.ts')).toMatch(/RESIDUAL RISK/);
  });
});

describe('README operational requirements', () => {
  const readme = read('README.md');
  it('states the clamd, cron, advisory-PDF and retention points', () => {
    expect(readme).toMatch(/real ClamAV/);
    expect(readme).toMatch(/every 5 minutes/);
    expect(readme).toMatch(/advisory/i);
    expect(readme).toMatch(/Data retention/);
    expect(readme).toMatch(/indefinitely/);
  });
});
