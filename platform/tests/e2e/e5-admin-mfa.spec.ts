import { expect, test } from '@playwright/test';
import { createUser, mitraOrgId, roleOf, sql, uniqEmail } from './support/db';
import { readState, writeState } from './support/env';
import { inviteLink, waitForMail } from './support/mail';
import { msg } from './support/i18n';
import { freshCode, wrongCode } from './support/totp';
import { addMitraMember, freshContext, loginUi, logoutUi, startEnrolAndReadSecret, submitCode } from './support/ui';

const t = (k: string) => msg('en', k);

/**
 * E5 (F5/F6). The very first run of this spec in a database exercises the real bootstrap admin created in
 * global-setup (single use). Later runs (the other viewport) use a fresh super administrator added by test
 * setup, so every project covers the same forced-enrolment behaviour.
 */
test('E5 administrator: forced MFA enrolment, TOTP checks, re-login needs verification, invites another admin', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const st = readState();
  let admin: { email: string; password: string; secret: string | null; isBootstrap: boolean };
  if (st.admin && !st.admin.secret) {
    admin = { ...st.admin, isBootstrap: true };
  } else {
    const u = await createUser('e5-admin');
    await addMitraMember(u.id, 'admin_super');
    admin = { email: u.email, password: u.password, secret: null, isBootstrap: false };
  }
  const mitra = await mitraOrgId();

  await test.step('signed-out visitors are sent to login', async () => {
    await page.goto('/en/admin/users');
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fadmin%2Fusers/);
    await page.goto('/en/admin/audit');
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fadmin%2Faudit/);
  });

  await test.step('first sign-in: forced to enrol, no admin content before MFA', async () => {
    await loginUi(page, admin);
    await page.goto('/en/admin/users');
    await expect(page).toHaveURL(/\/en\/mfa\/enrol\?next=%2Fen%2Fadmin%2Fusers/);
    await expect(page.locator('main')).not.toContainText(t('admin.usersIntro'));
    await page.goto('/en/admin/audit');
    await expect(page).toHaveURL(/\/en\/mfa\/enrol/);
    await page.goto(`/en/orgs/${mitra}/members`);
    await expect(page).toHaveURL(/\/en\/mfa\/enrol/);
  });

  await test.step('wrong TOTP is rejected, correct TOTP is accepted', async () => {
    await page.goto('/en/mfa/enrol?next=%2Fen%2Fadmin%2Fusers');
    const secret = await startEnrolAndReadSecret(page);
    admin.secret = secret;
    await expect(page.getByRole('img', { name: t('mfa.qrAlt') })).toBeVisible();

    await submitCode(page, wrongCode(secret));
    await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.invalid_code') })).toBeVisible();
    await expect(page).toHaveURL(/\/mfa\/enrol/);
    expect(await sql(`select 1 from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = $1 and f.status = 'verified'`, [admin.email])).toHaveLength(0);

    await submitCode(page, freshCode(secret));
    await expect(page).toHaveURL(/\/en\/admin\/users$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('admin.usersTitle'));
    await expect(page.locator('table')).toBeVisible();
    if (admin.isBootstrap) {
      const s = readState();
      writeState({ admin: { email: s.admin!.email, password: s.admin!.password, secret } });
    }
  });

  await test.step('after logout and login: sent to /mfa/verify; admin pages stay blocked until verified', async () => {
    await logoutUi(page);
    await loginUi(page, admin);
    for (const path of ['/en/admin/users', '/en/admin/audit', `/en/orgs/${mitra}/members`]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/mfa\/verify/);
      await expect(page.locator('main table')).toHaveCount(0);
    }
    await page.goto('/en/admin/users');
    await submitCode(page, wrongCode(admin.secret!));
    await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.invalid_code') })).toBeVisible();
    await page.goto('/en/admin/audit');
    await expect(page).toHaveURL(/\/en\/mfa\/verify/);
    await submitCode(page, freshCode(admin.secret!));
    await expect(page).toHaveURL(/\/en\/admin\/audit$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('admin.auditTitle'));
    await page.goto('/en/admin/users');
    await expect(page.locator('table')).toBeVisible();
  });

  const invitee = await createUser('e5-invited-admin');
  await test.step('the admin invites another administrator role', async () => {
    await page.goto('/en/admin/users');
    await page.locator('#invite-email').fill(invitee.email);
    const roles = (await page.locator('#invite-role option').allInnerTexts()).map((s) => s.trim());
    expect(roles).toContain(t('roles.admin_support'));
    expect(roles).not.toContain(t('roles.owner')); // organisation roles cannot be granted here
    await page.locator('#invite-role').selectOption('admin_support');
    await page.getByRole('button', { name: t('members.inviteSubmit'), exact: true }).click();
    await expect(page.locator('main .card', { hasText: invitee.email })).toContainText(t('roles.admin_support'));

    const link = inviteLink(await waitForMail(invitee.email, { match: /\/invite\// }));
    const ctx = await freshContext(browser, page);
    const p = await ctx.newPage();
    await loginUi(p, invitee);
    await p.goto(link);
    await expect(p).toHaveURL(/\/en\/orgs$/);
    expect(await roleOf(mitra, invitee.id)).toBe('admin_support');

    // The new administrator is forced to enrol too, and cannot see the user list (no admin:users permission).
    await p.goto('/en/admin/users');
    await expect(p).toHaveURL(/\/en\/mfa\/enrol/);
    const secret = await startEnrolAndReadSecret(p);
    await submitCode(p, freshCode(secret));
    await expect(p).toHaveURL(/\/en\/admin\/users$/);
    await expect(p.locator('main')).toContainText(t('admin.noAccess'));
    await expect(p.locator('main table')).toHaveCount(0);
    await ctx.close();
  });
});

test('E5 a non-administrator never sees admin content', async ({ page }) => {
  const u = await createUser('e5-plain');
  await loginUi(page, u);

  const resUsers = await page.goto('/en/admin/users');
  expect(resUsers!.status()).toBeLessThan(500);
  await expect(page.locator('main')).toContainText(t('admin.noAccess'));
  await expect(page.locator('main table')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(t('admin.usersIntro'));
  await expect(page.locator('#invite-email')).toHaveCount(0);

  await page.goto('/en/admin/audit');
  await expect(page.locator('main')).toContainText(t('admin.noAccess'));
  await expect(page.locator('main table')).toHaveCount(0);
  await expect(page.locator('#action')).toHaveCount(0);

  // No admin links on their home page and no way into the MITRA org members page.
  await page.goto('/en');
  await expect(page.getByRole('link', { name: t('home.adminUsers') })).toHaveCount(0);
  await page.goto(`/en/orgs/${await mitraOrgId()}/members`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('notFound.title'));
});

test('E5 a plain organisation owner does not get administrator pages', async ({ page }) => {
  const u = await createUser('e5-owner');
  await loginUi(page, u);
  await page.goto('/en/admin/users');
  await expect(page.locator('main')).toContainText(t('admin.noAccess'));
  await expect(page.locator('main table')).toHaveCount(0);
  void uniqEmail;
});
