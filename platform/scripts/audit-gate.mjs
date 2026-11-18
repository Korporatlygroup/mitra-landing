// Dependency audit gate. Fails (exit 1) on any high or critical advisory, EXCEPT the explicitly approved, dated exceptions below.
//
// Design rules (owner-approved 2026-11-18, see docs/security/picomatch-GHSA-fc5q-39xc-vjpf-risk-assessment.md):
//  - Exceptions are per advisory id (GHSA), never per package, so a different advisory on the same package still fails.
//  - Each exception has an expiry date. On the expiry date or later it stops applying and the gate fails again.
//  - The gate fails closed: if `npm audit --json` cannot be run, cannot be parsed or does not have the expected shape, it exits 1.
//  - The raw npm audit report is written to reports/npm-audit-raw.json first, so CI can keep it as an artifact.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXCEPTIONS = [
  {
    id: 'GHSA-fc5q-39xc-vjpf', // picomatch: ReDoS through single-branch repeated extglobs
    expires: '2027-01-15', // the exception is valid strictly BEFORE this date
    reason:
      'No patched picomatch exists (affected range <=4.0.7; 4.0.7 is the latest release). Reached only through build/dev tooling and next-intl\'s optional ' +
      'extractor watcher; neither the npm picomatch nor @parcel/watcher is in the Cloudflare Worker bundle; no request path accepts a glob pattern. ' +
      'Approved by the owner on 2026-11-18. Details: docs/security/picomatch-GHSA-fc5q-39xc-vjpf-risk-assessment.md',
  },
];

const BAD = new Set(['high', 'critical']);
const advisoryId = (url) => String(url ?? '').split('/').pop() || '';

/**
 * Pure evaluation of an `npm audit --json` report. Returns { ok, failures, excused, notes }.
 * Throws on anything it cannot validate (callers must treat a throw as a failure).
 */
export function evaluateAudit(report, today, exceptions = EXCEPTIONS) {
  if (!report || typeof report !== 'object' || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) throw new Error('audit report has no "vulnerabilities" object');
  if (report.auditReportVersion !== 2) throw new Error(`unsupported auditReportVersion ${JSON.stringify(report.auditReportVersion)} (expected 2)`);
  if (!report.metadata || typeof report.metadata !== 'object') throw new Error('audit report has no "metadata"');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('invalid date');

  const active = new Map(exceptions.filter((x) => x.expires > today).map((x) => [x.id, x]));
  const expired = exceptions.filter((x) => x.expires <= today);
  const vulns = report.vulnerabilities;

  // Collect the ROOT advisories behind each vulnerable package by following string "via" links to other vulnerable packages.
  const roots = new Map(); // advisory id -> { id, severity, url, title, packages:Set }
  const seen = new Set();
  const walk = (pkg, origin) => {
    const key = `${origin}>${pkg}`;
    if (seen.has(key)) return;
    seen.add(key);
    const v = vulns[pkg];
    if (!v) return;
    for (const via of v.via ?? []) {
      if (typeof via === 'string') walk(via, origin);
      else if (via && typeof via === 'object') {
        const id = advisoryId(via.url);
        if (!id) throw new Error(`advisory without an id on ${pkg}`);
        if (!roots.has(id)) roots.set(id, { id, severity: via.severity, url: via.url, title: via.title, packages: new Set() });
        roots.get(id).packages.add(origin);
      } else throw new Error(`unexpected "via" entry on ${pkg}`);
    }
  };
  for (const name of Object.keys(vulns)) walk(name, name);

  const failures = [];
  const excused = [];
  for (const r of roots.values()) {
    if (!BAD.has(r.severity)) continue;
    const ex = active.get(r.id);
    if (ex) excused.push(`${r.id} (${r.severity}) ${r.title ?? ''} - excepted until ${ex.expires} - packages: ${[...r.packages].join(', ')}`);
    else failures.push(`${r.id} (${r.severity}) ${r.title ?? ''} ${r.url ?? ''} - packages: ${[...r.packages].join(', ')}`);
  }
  // A package marked high/critical with no root advisory found is unexplained: fail closed.
  for (const [name, v] of Object.entries(vulns)) {
    if (!BAD.has(v.severity)) continue;
    const explained = [...roots.values()].some((r) => r.packages.has(name) && BAD.has(r.severity));
    if (!explained) failures.push(`${name} (${v.severity}): no advisory found behind this finding`);
  }
  const notes = expired.map((x) => `exception ${x.id} EXPIRED on ${x.expires}`);
  return { ok: failures.length === 0, failures, excused, notes };
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    raw = e && typeof e.stdout === 'string' ? e.stdout : ''; // npm audit exits non-zero when it finds anything
  }
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/npm-audit-raw.json', raw || '');
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    console.error('audit-gate: FAIL (closed): npm audit output could not be parsed as JSON. See reports/npm-audit-raw.json.');
    process.exit(1);
  }
  let result;
  try {
    result = evaluateAudit(report, today);
  } catch (e) {
    console.error(`audit-gate: FAIL (closed): ${e.message}`);
    process.exit(1);
  }
  for (const x of EXCEPTIONS) console.log(`audit-gate: exception ${x.id}, valid before ${x.expires}. ${x.reason}`);
  for (const n of result.notes) console.error(`audit-gate: ${n}`);
  for (const l of result.excused) console.log(`audit-gate: excused: ${l}`);
  if (!result.ok) {
    console.error('audit-gate: FAIL: unexcused high or critical advisories:\n' + result.failures.map((f) => ' - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('audit-gate: OK (no unexcused high or critical advisories).');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
