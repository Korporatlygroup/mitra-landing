// Creates the first MITRA administrator (admin_super) for an existing, email-confirmed user.
// Usage: node scripts/bootstrap-admin.mjs --email someone@example.com [--allow-remote]
// Reads SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
// from the environment or .env.local. Never prints keys.
//
// Safety: refuses unless the API host is 127.0.0.1/localhost, OR --allow-remote is given AND
// MITRA_BOOTSTRAP_CONFIRM equals the exact email.
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}
loadDotenv(join(root, '.env.local'));
loadDotenv(join(root, '.env'));

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const args = process.argv.slice(2);
const emailIdx = args.indexOf('--email');
const email = emailIdx >= 0 ? (args[emailIdx + 1] ?? '').trim().toLowerCase() : '';
const allowRemote = args.includes('--allow-remote');
if (!email || !email.includes('@')) die('Usage: node scripts/bootstrap-admin.mjs --email someone@example.com [--allow-remote]', 2);

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) die('SUPABASE_URL is not set.', 2);
if (!key) die('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set.', 2);

let host;
try {
  host = new URL(url).hostname;
} catch {
  die('SUPABASE_URL is not a valid URL.', 2);
}
const isLocal = host === '127.0.0.1' || host === 'localhost';
if (!isLocal) {
  if (!allowRemote) die(`Refusing to run against a non-local host (${host}). Pass --allow-remote and set MITRA_BOOTSTRAP_CONFIRM to the exact email.`, 3);
  if (process.env.MITRA_BOOTSTRAP_CONFIRM !== email) die('Refusing: MITRA_BOOTSTRAP_CONFIRM must equal the exact email being promoted.', 3);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.rpc('bootstrap_first_admin', { p_email: email });
if (error) {
  const reason = error.message === 'already_bootstrapped' || error.message === 'user_not_found_or_unconfirmed' ? error.message : `error (${error.code ?? 'unknown'})`;
  die(`Bootstrap failed: ${reason}`);
}
console.log(`First administrator created for ${email} (user ${data}). They must enrol an authenticator app at next sign-in.`);
