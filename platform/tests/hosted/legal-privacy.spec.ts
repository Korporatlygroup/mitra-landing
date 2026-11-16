import { expect, test } from '@playwright/test';
import { msg } from '../e2e/support/i18n';
import { account, anon, guardStaging, lit, loginUi, remoteRows, remoteSql, run } from './support';

// Hosted staging: legal pages (drafts behind the access gate), sign-up consent controls, data requests and marketing consent.
test.describe.configure({ mode: 'serial' });
test.beforeAll(guardStaging);

const SLUGS = ['privacy', 'terms', 'marketplace-policy', 'cookies', 'government-disclaimer', 'complaints'];

for (const locale of ['en', 'ms', 'ta']) {
  test(`legal pages on the Worker in ${locale}: open, draft banner, noindex`, async ({ page }) => {
    for (const slug of SLUGS) {
      const r = await page.goto(`/${locale}/${slug}`);
      expect(r?.status(), slug).toBe(200);
      await expect(page.getByTestId('legal-draft-banner'), slug).toBeVisible();
      await expect(page.locator('meta[name=robots]'), slug).toHaveAttribute('content', /noindex/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
}

test('sign-up page: policy links, required terms and privacy, optional unticked marketing', async ({ page }) => {
  await page.goto('/en/signup');
  await expect(page.locator('#acceptMarketing')).not.toBeChecked();
  await expect(page.locator('#acceptMarketing')).not.toHaveAttribute('required', '');
  await expect(page.locator('#acceptTerms')).toHaveAttribute('required', '');
  for (const href of ['/en/terms', '/en/privacy', '/en/cookies']) await expect(page.locator(`main a[href="${href}"]`), href).toBeVisible();
  await expect(page.locator('footer a[href="/en/complaints"]')).toBeVisible();
});

test('visitors get only the documented cookie', async ({ page, context }) => {
  await page.goto('/en');
  expect((await context.cookies()).map((c) => c.name)).toEqual(['NEXT_LOCALE']);
});

test('anonymous callers cannot use the new privacy functions or read requests', async () => {
  const c = anon();
  for (const [fn, args] of [
    ['submit_privacy_request', { p_type: 'access', p_details: 'x' }],
    ['set_marketing_consent', { p_on: true }],
    ['list_my_privacy_requests', {}],
    ['admin_list_privacy_requests', { p_status: 'all' }],
  ] as const) {
    const r = await c.rpc(fn, args as never);
    expect(r.error, fn).not.toBeNull();
  }
  const rows = await c.from('privacy_requests').select('id').limit(1);
  expect(rows.error).not.toBeNull();
});

test('data request and marketing consent through the real screens, isolation, and administrator handling', async ({ browser }) => {
  test.setTimeout(300_000);
  const user = await account('p-user');
  const other = await account('p-other');
  const adminAcc = await account('p-admin', true);
  remoteSql(
    `insert into public.memberships (org_id, user_id, role) select id, ${lit(adminAcc.id)}, 'admin_super' from public.organisations where type = 'mitra' on conflict (org_id, user_id) do update set role = excluded.role, status = 'active'`,
  );
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUi(page, user);
  await page.goto('/en/account');
  await page.locator('#request-type').selectOption('access');
  await page.locator('#request-details').fill(`Hosted request ${run}: please send me my data.`);
  await page.locator('form:has(#request-details) button[type=submit]').click();
  await expect(page.getByTestId('my-privacy-requests')).toContainText(msg('en', 'account.requestTypes.access'));
  const row = remoteRows<{ id: string; status: string }>(`select id, status from public.privacy_requests where user_id = ${lit(user.id)}`);
  expect(row).toHaveLength(1);
  expect(row[0]!.status).toBe('open');

  // Marketing consent: off by default, on, then withdrawn.
  expect(remoteRows(`select 1 from public.consents where user_id = ${lit(user.id)} and purpose = 'marketing'`)).toHaveLength(0);
  await page.locator('#marketing').check();
  await page.locator('form:has(#marketing) button[type=submit]').click();
  await expect.poll(() => remoteRows(`select 1 from public.consents where user_id = ${lit(user.id)} and purpose = 'marketing' and withdrawn_at is null`).length, { timeout: 40_000 }).toBe(1);
  await page.reload();
  await page.locator('#marketing').uncheck();
  await page.locator('form:has(#marketing) button[type=submit]').click();
  await expect.poll(() => remoteRows(`select 1 from public.consents where user_id = ${lit(user.id)} and purpose = 'marketing' and withdrawn_at is null`).length, { timeout: 40_000 }).toBe(0);

  // Another user sees none of it and cannot handle it.
  const mine = await other.client.from('privacy_requests').select('id');
  expect(mine.data ?? []).toHaveLength(0);
  expect((await other.client.rpc('admin_list_privacy_requests', { p_status: 'all' })).error).not.toBeNull();
  expect((await other.client.rpc('admin_update_privacy_request', { p_id: row[0]!.id, p_status: 'completed', p_note: 'x' })).error).not.toBeNull();

  // The administrator (second factor done) answers; a note is required.
  const list = await adminAcc.client.rpc('admin_list_privacy_requests', { p_status: 'open' });
  expect(list.error, list.error?.message).toBeNull();
  expect(JSON.stringify(list.data)).toContain(row[0]!.id);
  expect((await adminAcc.client.rpc('admin_update_privacy_request', { p_id: row[0]!.id, p_status: 'completed', p_note: '' })).error).not.toBeNull();
  const done = await adminAcc.client.rpc('admin_update_privacy_request', { p_id: row[0]!.id, p_status: 'completed', p_note: 'Copy sent to your account email.' });
  expect(done.error, done.error?.message).toBeNull();
  await page.reload();
  await expect(page.getByTestId('my-privacy-requests')).toContainText('Copy sent');
  const audit = remoteRows<{ action: string }>(`select action from public.audit_log where entity_id = ${lit(row[0]!.id)} order by id`).map((a) => a.action);
  expect(audit).toEqual(['privacy.request.submitted', 'privacy.request.completed']);
  await ctx.close();
});
