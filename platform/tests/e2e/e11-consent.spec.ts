import { expect, test } from '@playwright/test';
import { createOrgAs, createUser, hasConsents, roleOf, signedClient, sql, uniq } from './support/db';
import { msg } from './support/i18n';
import { freshContext, loginUi } from './support/ui';

const t = (k: string) => msg('en', k);

// E11: create_org and accept_invitation require the current terms + privacy consent.
test('E11 a user without consent is sent to /account to accept, then lands back on create-org and can create', async ({ page }) => {
  const u = await createUser('e11-org', { consent: false });
  expect(await hasConsents(u.id)).toBe(false);
  await loginUi(page, u);

  await page.goto('/en/orgs/new');
  await page.locator('#type-business').check();
  const name = `Consent Co ${uniq('c')}`;
  await page.locator('#name').fill(name);
  await page.locator('main form button[type=submit]').click();

  // Redirected to the account page with next=/en/orgs/new and the consent prompt.
  await expect(page).toHaveURL(/\/en\/account\?next=%2Fen%2Forgs%2Fnew$/);
  await expect(page.getByRole('heading', { level: 2, name: t('consent.title') })).toBeVisible();
  expect(await sql(`select 1 from public.organisations where created_by = $1`, [u.id])).toHaveLength(0);

  // Both boxes are required; the button is "Accept and continue".
  const accept = page.getByRole('button', { name: t('consent.submit'), exact: true });
  await accept.click();
  await expect(page).toHaveURL(/\/en\/account\?next=/); // native required validation kept us here
  await page.locator('#consent-terms').check();
  await page.locator('#consent-privacy').check();
  await accept.click();

  await expect(page).toHaveURL(/\/en\/orgs\/new$/);
  expect(await hasConsents(u.id)).toBe(true);
  await expect(page.getByRole('heading', { level: 2, name: t('consent.title') })).toHaveCount(0);

  await page.locator('#type-business').check();
  await page.locator('#name').fill(name);
  await page.locator('main form button[type=submit]').click();
  await expect(page).toHaveURL(/\/en\/orgs\/[0-9a-f-]{36}\/members$/);
  expect(await sql(`select 1 from public.organisations where created_by = $1 and name = $2`, [u.id, name])).toHaveLength(1);

  // The account page no longer shows the consent prompt.
  await page.goto('/en/account');
  await expect(page.getByRole('heading', { level: 2, name: t('consent.title') })).toHaveCount(0);
});

test('E11 the RPC itself refuses create_org without consent (no UI)', async () => {
  const u = await createUser('e11-rpc', { consent: false });
  const s = await signedClient(u);
  const { error } = await s.client.rpc('create_org', { p_type: 'business', p_name: `NoConsent ${uniq('n')}` });
  expect(error).not.toBeNull();
  expect(error!.message).toBe('consent_required');
  expect(await sql(`select 1 from public.organisations where created_by = $1`, [u.id])).toHaveLength(0);
});

test('E11 accepting an invitation without consent goes through /account and then joins the organisation', async ({ page, browser }) => {
  const owner = await createUser('e11-owner');
  const orgId = await createOrgAs(owner, 'business', `Invite Consent ${uniq('i')}`);
  const invitee = await createUser('e11-invitee', { consent: false });
  const o = await signedClient(owner);
  const { data, error } = await o.client.rpc('create_invitation', { p_org: orgId, p_email: invitee.email, p_role: 'staff' });
  expect(error).toBeNull();
  const invitePath = `/en/invite/${(data as { token: string }).token}`;

  await loginUi(page, invitee);
  await page.goto(invitePath);
  await expect(page).toHaveURL(/\/en\/account\?next=%2Fen%2Finvite%2F[0-9a-f]{64}$/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next')!)).toBe(invitePath);
  await expect(page.getByRole('heading', { level: 2, name: t('consent.title') })).toBeVisible();
  expect(await roleOf(orgId, invitee.id)).toBeNull();

  await page.locator('#consent-terms').check();
  await page.locator('#consent-privacy').check();
  await page.getByRole('button', { name: t('consent.submit'), exact: true }).click();

  // Back on the same invitation link, which is now accepted (the refused attempt did not burn the token).
  await expect(page).toHaveURL(/\/en\/orgs$/);
  expect(await roleOf(orgId, invitee.id)).toBe('staff');

  // And it is spent now.
  const ctx = await freshContext(browser, page);
  const p = await ctx.newPage();
  await loginUi(p, invitee);
  await p.goto(invitePath);
  await expect(p.locator('main [role=alert]')).toContainText(t('errors.invalid_invitation'));
  await ctx.close();
});

test('E11 users created with the sign-up consent metadata already hold consent', async () => {
  const u = await createUser('e11-default');
  expect(await hasConsents(u.id)).toBe(true);
});
