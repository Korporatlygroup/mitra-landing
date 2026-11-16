import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { freshCode } from '../e2e/support/totp';

// Hosted staging acceptance checks. Disposable accounts are created through the Supabase Auth admin API (already confirmed,
// staging only) and tagged hosted-<run>@example.test. Email delivery is NOT exercised: no mail provider is configured yet.
const STAGING_REF = 'udxzukodfqjzdukweygy';
const url = process.env.HOSTED_SUPABASE_URL ?? '';
const pub = process.env.HOSTED_SUPABASE_PUBLISHABLE_KEY ?? '';
const secret = process.env.HOSTED_SUPABASE_SECRET_KEY ?? '';
const run = randomBytes(3).toString('hex');
const strong = () => `Aa1-${randomBytes(9).toString('base64url')}`;

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => {
  if (url !== `https://${STAGING_REF}.supabase.co`) throw new Error('Refusing to run: HOSTED_SUPABASE_URL must be the mitra-staging project');
  if (!pub || !secret || !process.env.HOSTED_BASE_URL) throw new Error('HOSTED_* variables are not set');
});

const admin = () => createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });

interface Account {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
  secret?: string;
  orgId?: string;
}

async function account(tag: string, mfa = false): Promise<Account> {
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

function remoteSql(query: string): void {
  execFileSync('npx', ['supabase', 'db', 'query', `--remote=${STAGING_REF}`, '--yes', JSON.stringify(query)], { stdio: 'pipe', shell: true });
}

async function loginUi(page: Page, a: Account) {
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
async function gotoWithMfa(page: Page, a: Account, path: string) {
  const r = await page.goto(path);
  if (a.secret && /\/mfa\/verify/.test(page.url())) {
    await page.locator('#code').fill(freshCode(a.secret));
    await page.locator('form:has(#code) button[type=submit]').click();
    await expect(page).not.toHaveURL(/\/mfa\//);
    return page.goto(path);
  }
  return r;
}

const A: Record<string, Account> = {};

test('public pages answer on the deployed Worker', async ({ page, request }) => {
  const noKey = await fetch(`${process.env.HOSTED_BASE_URL}/en/login`);
  expect(noKey.status, 'the pre-launch gate refuses a request without the access key').toBe(401);
  const health = await request.get('/api/v1/health');
  expect(health.status()).toBe(200);
  for (const p of ['/en', '/ms', '/ta', '/en/signup', '/en/login', '/en/directory', '/en/business-help', '/en/catalogue']) {
    const r = await page.goto(p);
    expect(r?.status(), p).toBeLessThan(400);
  }
  const csp = (await page.goto('/en/login'))?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain(url);
});

test('accounts: buyer signs in through the real login form, keeps the session, and is sent to sign in after cookies are cleared', async ({ page }) => {
  A.buyer = await account('buyer');
  A.seller = await account('seller');
  await loginUi(page, A.buyer);
  await page.goto('/en');
  await expect(page.locator('main')).toBeVisible();
  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().clearCookies();
  await page.goto('/en/orgs/new');
  await expect(page).toHaveURL(/\/login/);
});

test('seller creates a business organisation through the UI and owns it', async ({ page }) => {
  await loginUi(page, A.seller!);
  await page.goto('/en/orgs/new');
  await page.locator('#type-business').check();
  await page.locator('#name').fill(`Hosted Kedai ${run}`);
  await page.locator('main form button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]{36}\/members$/);
  const orgId = /orgs\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const mine = await A.seller!.client.from('organisations').select('id,name,type').eq('id', orgId);
  expect(mine.data).toHaveLength(1);
  A.seller!.orgId = orgId;
  await page.context().clearCookies();
});

test('tenant isolation: the buyer cannot see the seller organisation, its members, or any audit rows', async () => {
  const orgId = A.seller!.orgId!;
  const org = await A.buyer!.client.from('organisations').select('id').eq('id', orgId);
  expect(org.data ?? []).toHaveLength(0);
  const mem = await A.buyer!.client.from('memberships').select('user_id').eq('org_id', orgId);
  expect(mem.data ?? []).toHaveLength(0);
  const prof = await A.buyer!.client.from('business_profiles').select('org_id').eq('org_id', orgId);
  expect(prof.data ?? []).toHaveLength(0);
  const audit = await A.buyer!.client.from('audit_log').select('id').limit(5);
  expect(audit.data ?? []).toHaveLength(0);
  const ins = await A.buyer!.client.from('memberships').insert({ org_id: orgId, user_id: A.buyer!.id, role: 'owner' });
  expect(ins.error).not.toBeNull();
});

test('anonymous and low-privilege callers are refused privileged operations and the admin console', async ({ page }) => {
  const create = await anon().rpc('create_org', { p_type: 'business', p_name: 'Anon org' });
  expect(create.error).not.toBeNull();
  const pri = await A.buyer!.client.rpc('admin_biz_product_decide', { p_id: '00000000-0000-0000-0000-000000000000', p_decision: 'approve', p_note: 'x', p_expected_version: 1 });
  expect(pri.error).not.toBeNull();
  const boot = await A.buyer!.client.rpc('bootstrap_first_admin', { p_email: A.buyer!.email });
  expect(boot.error).not.toBeNull();
  const r = await page.goto('/en/admin/business-help');
  expect(page.url()).toMatch(/login|404|not-found/);
  expect(r?.status()).not.toBe(500);
  await loginUi(page, A.buyer!);
  await page.goto('/en/admin/business-help');
  await expect(page.locator('main')).not.toContainText(/Source registry|Sources and programmes/i);
  await page.context().clearCookies();
});

test('private storage: no API role can list, read or write the verification bucket', async () => {
  for (const [name, c] of [['anon', anon()], ['buyer', A.buyer!.client], ['seller', A.seller!.client]] as const) {
    const list = await c.storage.from('verification-docs').list('');
    expect((list.data ?? []).length, `${name} list`).toBe(0);
    const up = await c.storage.from('verification-docs').upload(`probe-${run}.txt`, new Blob(['x'], { type: 'text/plain' }));
    expect(up.error, `${name} upload`).not.toBeNull();
    const dl = await c.storage.from('verification-docs').download('anything.pdf');
    expect(dl.error, `${name} download`).not.toBeNull();
  }
  const publicRead = await fetch(`${url}/storage/v1/object/public/verification-docs/anything.pdf`);
  expect([400, 404]).toContain(publicRead.status);
});

test('administrator: first admin, MFA sign-in in the browser, console access; a session without the second step is refused', async ({ page }) => {
  A.admin = await account('admin', true);
  A.reviewer = await account('reviewer2', true);
  const boot = await admin().rpc('bootstrap_first_admin', { p_email: A.admin.email });
  // The first administrator can only be bootstrapped once; on a later run the new test admin is added to the operator organisation directly.
  if (boot.error) {
    expect(boot.error.message).toBe('already_bootstrapped');
    remoteSql(`insert into public.memberships (org_id, user_id, role) select id, '${A.admin.id}', 'admin_super' from public.organisations where type = 'mitra' on conflict (org_id, user_id) do nothing`);
  }
  remoteSql(`insert into public.memberships (org_id, user_id, role) select id, '${A.reviewer.id}', 'admin_review' from public.organisations where type = 'mitra' on conflict (org_id, user_id) do nothing`);
  await loginUi(page, A.admin);
  const r = await gotoWithMfa(page, A.admin, '/en/admin/business-help');
  expect(r?.status()).toBe(200);
  await expect(page).not.toHaveURL(/login|mfa/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.context().clearCookies();
  await page.goto('/en/login');
  await page.locator('#email').fill(A.reviewer.email);
  await page.locator('#password').fill(A.reviewer.password);
  await page.locator('main form button[type=submit]').click();
  await page.goto('/en/admin/business-help');
  expect(page.url()).toMatch(/mfa|login/);
  await page.context().clearCookies();
});

test('sessions: refresh works while signed in and a global sign-out revokes the refresh token', async () => {
  const c = A.seller!.client;
  const before = await c.auth.refreshSession();
  expect(before.error).toBeNull();
  const refresh = before.data.session!.refresh_token;
  const out = await c.auth.signOut({ scope: 'global' });
  expect(out.error).toBeNull();
  const again = await anon().auth.refreshSession({ refresh_token: refresh });
  expect(again.error).not.toBeNull();
});
