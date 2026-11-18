// Bounded load test for LOCAL or STAGING only. Refuses to run against production hosts.
// Usage: node scripts/qa-load-test.mjs http://127.0.0.1:3613 [seconds-per-level]
// Each virtual session loops over a fixed list of public pages, one request at a time (closed-loop), for the given duration.
// Reports measured latency percentiles, throughput and error counts per concurrency level. Nothing is estimated.
import fs from 'node:fs';

const base = process.argv[2];
const seconds = Number(process.argv[3] ?? 30);
if (!base) throw new Error('base url required');
const host = new URL(base).hostname;
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) && !/(staging|dev|test|qa)\./.test(host)) throw new Error(`refusing to load-test ${host}: local or staging only`);

const paths = ['/en', '/en/directory', '/en/directory?q=packaging', '/en/catalogue', '/en/business-help', '/en/news', '/ms', '/ta/directory', '/en/signup'];
const levels = [5, 10, 20];
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : null);

async function session(deadline, out) {
  let i = Math.floor(Math.random() * paths.length);
  while (Date.now() < deadline) {
    const p = paths[i++ % paths.length];
    const t0 = performance.now();
    try {
      const r = await fetch(base + p, { redirect: 'follow' });
      await r.arrayBuffer();
      out.push({ p, ms: performance.now() - t0, status: r.status });
    } catch (e) {
      out.push({ p, ms: performance.now() - t0, status: 0, err: String(e.cause?.code ?? e.message) });
    }
  }
}

const results = [];
// warm-up (not counted)
for (const p of paths) await fetch(base + p).then((r) => r.arrayBuffer()).catch(() => undefined);
for (const n of levels) {
  const out = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: n }, () => session(t0 + seconds * 1000, out)));
  const wall = (Date.now() - t0) / 1000;
  const ok = out.filter((r) => r.status >= 200 && r.status < 400);
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const byPath = {};
  for (const r of out) (byPath[r.p] ??= []).push(r);
  const perPath = Object.fromEntries(Object.entries(byPath).map(([k, v]) => {
    const l = v.filter((r) => r.status >= 200 && r.status < 400).map((r) => r.ms).sort((a, b) => a - b);
    return [k, { n: v.length, p50: Math.round(pct(l, 50) ?? -1), p95: Math.round(pct(l, 95) ?? -1), errors: v.length - l.length }];
  }));
  const row = {
    concurrency: n, durationSeconds: Math.round(wall), requests: out.length, errors: out.length - ok.length,
    errorRatePct: +(((out.length - ok.length) / Math.max(1, out.length)) * 100).toFixed(2), requestsPerSecond: +(out.length / wall).toFixed(1),
    p50ms: Math.round(pct(lat, 50) ?? -1), p95ms: Math.round(pct(lat, 95) ?? -1), p99ms: Math.round(pct(lat, 99) ?? -1), maxMs: Math.round(lat.at(-1) ?? -1), perPath,
  };
  results.push(row);
  console.log(JSON.stringify({ ...row, perPath: undefined }));
}
fs.mkdirSync('docs/qa-evidence', { recursive: true });
fs.writeFileSync('docs/qa-evidence/load-test-http.json', JSON.stringify({ base, when: new Date().toISOString(), paths, secondsPerLevel: seconds, results }, null, 2));
