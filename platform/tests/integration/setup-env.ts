// Loads the integration-test environment (local Supabase stack only).
// Order: platform/.env.local when present, otherwise `npx supabase status -o env`.
// Fails fast with a clear message when the stack is not running.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const platformDir = path.resolve(import.meta.dirname, '..', '..');

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const cfg: Record<string, string> = {};
const envFile = path.join(platformDir, '.env.local');
if (fs.existsSync(envFile)) {
  const f = parseEnv(fs.readFileSync(envFile, 'utf8'));
  if (f.NEXT_PUBLIC_SUPABASE_URL) cfg.TEST_API_URL = f.NEXT_PUBLIC_SUPABASE_URL;
  if (f.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) cfg.TEST_PUBLISHABLE_KEY = f.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (f.SUPABASE_SECRET_KEY) cfg.TEST_SERVICE_KEY = f.SUPABASE_SECRET_KEY;
  if (f.MAILPIT_URL) cfg.TEST_MAILPIT_URL = f.MAILPIT_URL;
}

const needStatus = !cfg.TEST_API_URL || !cfg.TEST_PUBLISHABLE_KEY || !cfg.TEST_SERVICE_KEY;
let status: Record<string, string> = {};
if (needStatus || !process.env.TEST_DB_URL) {
  try {
    status = parseEnv(
      execSync('npx supabase status -o env', { cwd: platformDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
    );
  } catch {
    if (needStatus) {
      throw new Error(
        'Integration tests need the local Supabase stack. Run `npx supabase start` in platform/ ' +
          '(and `npx supabase db reset`), or provide platform/.env.local. `supabase status` failed.',
      );
    }
  }
}
cfg.TEST_API_URL ||= status.API_URL;
cfg.TEST_PUBLISHABLE_KEY ||= status.PUBLISHABLE_KEY || status.ANON_KEY;
cfg.TEST_SERVICE_KEY ||= status.SECRET_KEY || status.SERVICE_ROLE_KEY;
cfg.TEST_MAILPIT_URL ||= status.MAILPIT_URL || 'http://127.0.0.1:54424';
cfg.TEST_DB_URL = process.env.TEST_DB_URL || status.DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';

for (const [k, v] of Object.entries(cfg)) {
  if (!v) throw new Error(`Integration test environment is missing ${k}. Is the local Supabase stack running (npx supabase start)?`);
  process.env[k] ??= v;
}

// Safety: never run against anything but a local stack.
for (const u of [process.env.TEST_API_URL!, process.env.TEST_DB_URL!, process.env.TEST_MAILPIT_URL!]) {
  const host = new URL(u).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    throw new Error(`Refusing to run integration tests against non-local host ${host}.`);
  }
}

try {
  await fetch(`${process.env.TEST_API_URL}/auth/v1/health`, {
    headers: { apikey: process.env.TEST_PUBLISHABLE_KEY! },
    signal: AbortSignal.timeout(5000),
  });
} catch {
  throw new Error(
    `Local Supabase API is not reachable at ${process.env.TEST_API_URL}. Start it with \`npx supabase start\` in platform/.`,
  );
}
