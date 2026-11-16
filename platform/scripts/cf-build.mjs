// Builds the application for Cloudflare Workers (OpenNext) with a safety check on the build-time Supabase settings.
// NEXT_PUBLIC_* values are inlined into the bundle, so a build made with the local development stack's URL or the wrong
// project would ship to the Worker. Process environment variables win over .env files, so set them in the shell
// (see docs/cloudflare-deployment-runbook.md). Usage: node scripts/cf-build.mjs staging
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const STAGING_REF = 'udxzukodfqjzdukweygy'; // Supabase project mitra-staging
const TARGETS = {
  staging: { ref: STAGING_REF },
  // The production build needs the new project's reference in INOK_PRODUCTION_REF and can never point at the staging project.
  production: { ref: process.env.INOK_PRODUCTION_REF ?? '' },
};
const target = process.argv[2];
const cfg = TARGETS[target];
if (!cfg) {
  console.error(`Usage: node scripts/cf-build.mjs <${Object.keys(TARGETS).join('|')}>`);
  process.exit(2);
}
if (target === 'production' && (!cfg.ref || cfg.ref === STAGING_REF)) {
  console.error('cf-build: set INOK_PRODUCTION_REF to the inok-production project reference (it must not be the staging project)');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const expected = `https://${cfg.ref}.supabase.co`;
const problems = [];
if (url !== expected) problems.push(`NEXT_PUBLIC_SUPABASE_URL must be ${expected} for ${target} (got ${url ? JSON.stringify(url) : 'nothing'})`);
if (!key) problems.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set');
if (key.length > 0 && /service_role|sb_secret_/i.test(key)) problems.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY looks like a secret key: refusing to build');
// The adapter bakes every value from Next's .env files into .open-next/cloudflare/next-env.mjs. A developer's .env.local holds the
// local stack's secret key, SMTP address and job secrets, which must never become defaults inside a deployed Worker.
for (const f of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  if (existsSync(f)) problems.push(`${f} exists and would be baked into the bundle: move it out of platform/ for the build (secrets belong in \`wrangler secret put\`)`);
}
if (problems.length) {
  for (const p of problems) console.error(`cf-build: ${p}`);
  process.exit(1);
}
console.log(`cf-build: building for ${target} against ${expected}`);
const r = spawnSync('npx opennextjs-cloudflare build', { stdio: 'inherit', shell: true, env: process.env });
if (r.status !== 0) process.exit(r.status ?? 1);

// After the build: the baked environment may contain NEXT_PUBLIC_* values only.
const baked = readFileSync('.open-next/cloudflare/next-env.mjs', 'utf8');
const keys = [...baked.matchAll(/"([A-Z][A-Z0-9_]+)":/g)].map((m) => m[1]).filter((k) => !k.startsWith('NEXT_PUBLIC_'));
if (keys.length) {
  console.error(`cf-build: the bundle contains non-public environment values (${[...new Set(keys)].join(', ')}). Refusing: do not deploy this build.`);
  process.exit(1);
}
console.log('cf-build: bundle check passed (only NEXT_PUBLIC_* values are baked in).');
