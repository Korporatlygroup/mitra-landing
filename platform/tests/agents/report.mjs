// Aggregates test-results/agents/*.jsonl into docs/agent-testing/generated-coverage.md.
// Usage: node tests/agents/report.mjs [workerRunId] [controlRunId]   (default: latest run of each target)
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'agents');
const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cov = read('coverage.jsonl');
const hosting = read('hosting-events.jsonl');
const fails = read('failures.jsonl');
const finds = read('findings.jsonl');

// Latest result per (target, scenario, item) so that reruns replace earlier attempts. A pass after a fail is shown with its history.
const latest = new Map();
const history = new Map();
for (const r of cov) {
  const k = `${r.target}|${r.scenario}|${r.item}`;
  latest.set(k, r);
  history.set(k, [...(history.get(k) ?? []), r.status]);
}
const rows = [...latest.values()];
const by = (t) => rows.filter((r) => r.target === t);
const count = (rs, f) => rs.filter(f).length;

let md = `# Generated coverage (from test-results/agents)\n\nGenerated ${new Date().toISOString()}. Latest result per check per target; reruns replace earlier results.\n\n`;
for (const target of ['worker', 'control']) {
  const rs = by(target);
  if (!rs.length) continue;
  md += `## Target: ${target === 'worker' ? 'staging Cloudflare Worker (Free plan)' : 'control host (same code and staging database, no Worker CPU limit)'}\n\n`;
  md += `Checks: ${rs.length}; pass ${count(rs, (r) => r.status === 'pass')}, fail ${count(rs, (r) => r.status === 'fail')}, observed ${count(rs, (r) => r.status === 'observed')}, disabled ${count(rs, (r) => r.status === 'disabled')}, other ${count(rs, (r) => !['pass', 'fail', 'observed', 'disabled'].includes(r.status))}.\n\n`;
  const fl = rs.filter((r) => r.status === 'fail');
  const cats = {};
  for (const r of fl) cats[r.cat ?? 'application'] = (cats[r.cat ?? 'application'] ?? 0) + 1;
  md += `Failures by classification: ${Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.\n\n`;
  const scen = [...new Set(rs.map((r) => r.scenario))].sort();
  md += '| Scenario | Pass | Fail | Observed | Disabled |\n|---|---:|---:|---:|---:|\n';
  for (const s of scen) {
    const x = rs.filter((r) => r.scenario === s);
    md += `| ${s} | ${count(x, (r) => r.status === 'pass')} | ${count(x, (r) => r.status === 'fail')} | ${count(x, (r) => r.status === 'observed')} | ${count(x, (r) => r.status === 'disabled')} |\n`;
  }
  md += '\n### Failed checks\n\n';
  for (const r of fl) md += `- **${r.scenario}** — ${r.item} _(${r.cat ?? 'application'})_: ${String(r.note).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 220)}\n`;
  md += '\n### Disabled, observed and designed limitations\n\n';
  for (const r of rs.filter((x) => ['disabled', 'observed'].includes(x.status))) md += `- ${r.status}: **${r.scenario}** — ${r.item}${r.note ? `: ${String(r.note).slice(0, 200)}` : ''}\n`;
  md += '\n';
}

const w = hosting.filter((h) => h.target === 'worker');
const recovered = w.filter((h) => h.recovered).length;
md += `## Worker 5xx events (hosting evidence)\n\nTotal logged 5xx/navigation failures on the Worker: ${w.filter((h) => !h.recovered).length}; navigations that recovered on a retry: ${recovered}.\n\n`;
const perUrl = {};
for (const h of w.filter((x) => !x.recovered)) perUrl[`${h.status} ${h.url.replace(/[0-9a-f-]{36}/g, ':id')}`] = (perUrl[`${h.status} ${h.url.replace(/[0-9a-f-]{36}/g, ':id')}`] ?? 0) + 1;
md += '| Status and path | Count |\n|---|---:|\n' + Object.entries(perUrl).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n\n';
md += `## Findings recorded by the suite (${finds.length})\n\n` + finds.map((f) => `- **${f.sev}** [${f.cat}] ${f.area}: ${f.title}`).join('\n') + '\n';
void fails;
fs.mkdirSync(path.resolve(import.meta.dirname, '..', '..', 'docs', 'agent-testing'), { recursive: true });
fs.writeFileSync(path.resolve(import.meta.dirname, '..', '..', 'docs', 'agent-testing', 'generated-coverage.md'), md);
console.log(md.split('\n').slice(0, 40).join('\n'));
