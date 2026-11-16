import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';
import { freshCode } from '../e2e/support/totp';

// Hosted staging acceptance checks. Disposable accounts are created through the Supabase Auth admin API (already confirmed,
// staging only) and tagged hosted-<run>@example.test. Email delivery is NOT exercised: no mail provider is configured yet.
export const STAGING_REF = 'udxzukodfqjzdukweygy';
export const url = process.env.HOSTED_SUPABASE_URL ?? '';
export const pub = process.env.HOSTED_SUPABASE_PUBLISHABLE_KEY ?? '';
export const secret = process.env.HOSTED_SUPABASE_SECRET_KEY ?? '';
export const run = randomBytes(3).toString('hex');
export const strong = () => `Aa1-${randomBytes(9).toString('base64url')}`;

export function guardStaging() {
  if (url !== `https://${STAGING_REF}.supabase.co`) throw new Error('Refusing to run: HOSTED_SUPABASE_URL must be the mitra-staging project');
  if (!pub || !secret || !process.env.HOSTED_BASE_URL) throw new Error('HOSTED_* variables are not set');
}

export const admin = () => createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
export const anon = () => createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });

export interface Account {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
  secret?: string;
  orgId?: string;
}

export async function account(tag: string, mfa = false): Promise<Account> {
  const email = `hosted-${run}-${tag}@example.test`;
  const password = strong();
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `Hosted ${tag}`, language: 'en', consents: { terms: '2026-07', privacy: '2026-07' } },
  });
  if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message}`);
  const client = anon();
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`sign-in ${tag}: ${s.error.message}`);
  const acc: Account = { id: data.user.id, email, password, client };
  if (mfa) {
    const enr = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `t-${run}` });
    if (enr.error || !enr.data) throw new Error(`mfa enrol ${tag}: ${enr.error?.message}`);
    const ch = await client.auth.mfa.challenge({ factorId: enr.data.id });
    const v = await client.auth.mfa.verify({ factorId: enr.data.id, challengeId: ch.data!.id, code: freshCode(enr.data.totp.secret) });
    if (v.error) throw new Error(`mfa verify ${tag}: ${v.error.message}`);
    acc.secret = enr.data.totp.secret;
  }
  return acc;
}

export function remoteSql(query: string): void {
  execFileSync('npx', ['supabase', 'db', 'query', `--remote=${STAGING_REF}`, '--yes', JSON.stringify(query)], { stdio: 'pipe', shell: true });
}

export async function loginUi(page: Page, a: Account) {
  await page.goto('/en/login');
  await page.locator('#email').fill(a.email);
  await page.locator('#password').fill(a.password);
  await page.locator('main form button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
  if (a.secret && /\/mfa\/verify/.test(page.url())) {
    await page.locator('#code').fill(freshCode(a.secret));
    await page.locator('form:has(#code) button[type=submit]').click();
    await expect(page).not.toHaveURL(/\/mfa\//);
  }
}

/** Opens a protected page; a signed-in privileged user at aal1 is sent to the second step, which is completed here. */
export async function gotoWithMfa(page: Page, a: Account, path: string) {
  const r = await page.goto(path);
  if (a.secret && /\/mfa\/verify/.test(page.url())) {
    await page.locator('#code').fill(freshCode(a.secret));
    await page.locator('form:has(#code) button[type=submit]').click();
    await expect(page).not.toHaveURL(/\/mfa\//);
    return page.goto(path);
  }
  return r;
}


/** Reads rows from the staging database through the signed-in Supabase CLI (the e2e helpers need a direct connection, which hosted projects do not give us). */
export function remoteRows<T = Record<string, unknown>>(query: string): T[] {
  const out = execFileSync('npx', ['supabase', 'db', 'query', `--remote=${STAGING_REF}`, '--yes', '--output-format', 'json', JSON.stringify(query)], { stdio: 'pipe', shell: true, maxBuffer: 20_000_000 }).toString();
  const start = out.indexOf('{');
  const parsed = JSON.parse(out.slice(start, out.lastIndexOf('}') + 1)) as { rows?: T[] };
  return parsed.rows ?? [];
}

export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
