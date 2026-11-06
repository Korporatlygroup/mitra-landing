import { execSync } from 'node:child_process';
import { chromium, type FullConfig } from '@playwright/test';
import { sql } from './support/db';
import { API_URL, BASE_URL, platformDir, PUBLISHABLE_KEY, readState, stateFile, writeState } from './support/env';
import fs from 'node:fs';
import { clearMailbox } from './support/mail';
import { signUpAndConfirm } from './support/ui';

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${API_URL}/auth/v1/health`, { headers: { apikey: PUBLISHABLE_KEY } });
      await sql('select 1');
      const p = await fetch(`${API_URL}/rest/v1/`, { headers: { apikey: PUBLISHABLE_KEY } });
      if (r.ok && p.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('Local Supabase API did not become ready after reset.');
}

/**
 * Makes the database deterministic (db reset unless E2E_NO_RESET=1) and creates the first administrator
 * (single-use bootstrap): the account signs up and confirms through the real UI + Mailpit, then
 * scripts/bootstrap-admin.mjs promotes it. MFA enrolment is left to the E5 spec.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (process.env.E2E_NO_RESET !== '1') {
    fs.rmSync(stateFile, { force: true });
    execSync('npx supabase db reset', { cwd: platformDir, stdio: 'inherit' });
  }
  await waitForApi();
  await clearMailbox();

  const bootstrapped = Number((await sql(`select count(*)::int as n from public.memberships where role = 'admin_super'`))[0]!.n) > 0;
  const st = readState();
  if (bootstrapped) {
    if (!st.admin) console.warn('[e2e] DB already bootstrapped and no admin state file: admin specs will fail. Run without E2E_NO_RESET.');
    return;
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    const admin = await signUpAndConfirm(page, context, 'first-admin');
    execSync(`node scripts/bootstrap-admin.mjs --email ${admin.email}`, { cwd: platformDir, stdio: 'inherit' });
    writeState({ admin: { email: admin.email, password: admin.password, secret: null } });
  } finally {
    await browser.close();
  }
}
