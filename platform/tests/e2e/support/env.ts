import fs from 'node:fs';
import path from 'node:path';

export const platformDir = path.resolve(import.meta.dirname, '..', '..', '..');
export const stateFile = path.join(platformDir, 'test-results', '.e2e-state', 'state.json');

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

const file = path.join(platformDir, '.env.local');
const f = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};

export const API_URL = process.env.TEST_API_URL ?? f.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54421';
export const PUBLISHABLE_KEY = process.env.TEST_PUBLISHABLE_KEY ?? f.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const SERVICE_KEY = process.env.TEST_SERVICE_KEY ?? f.SUPABASE_SECRET_KEY ?? '';
export const MAILPIT_URL = process.env.TEST_MAILPIT_URL ?? f.MAILPIT_URL ?? 'http://127.0.0.1:54424';
export const DB_URL = process.env.TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

// Safety: only ever run against a local stack and a local app, and never the unrelated stack on 54321-54329.
for (const u of [API_URL, MAILPIT_URL, DB_URL, BASE_URL]) {
  const url = new URL(u);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`E2E refuses to run against non-local host ${url.hostname}`);
  const port = Number(url.port);
  if (port >= 54321 && port <= 54329) throw new Error(`E2E refuses to use port ${port} (unrelated Supabase stack).`);
}
if (!PUBLISHABLE_KEY || !SERVICE_KEY) throw new Error('Missing keys: run `node scripts/write-local-env.mjs` (local Supabase stack must be running).');

/** The current consent text version, read from the app (the DB requires exactly this value). */
export const CONSENT_VERSION = (() => {
  const src = fs.readFileSync(path.join(platformDir, 'src', 'lib', 'consent.ts'), 'utf8');
  return src.match(/CONSENT_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '2026-07';
})();

export interface E2eState {
  admin: { email: string; password: string; secret: string | null } | null;
}
export function readState(): E2eState {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as E2eState;
  } catch {
    return { admin: null };
  }
}
export function writeState(s: E2eState): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(s), { mode: 0o600 });
}
