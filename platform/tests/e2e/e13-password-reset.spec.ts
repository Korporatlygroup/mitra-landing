import { expect, test, type Page } from '@playwright/test';
import { createUser, strongPassword, uniqEmail } from './support/db';
import { MAILPIT_URL } from './support/env';
import { msg } from './support/i18n';
import { confirmLink, waitForMail } from './support/mail';
import { freshContext, loginUi, logoutUi } from './support/ui';

const t = (k: string) => msg('en', k);

async function requestLink(page: Page, email: string) {
  await page.goto('/en/forgot-password');
  await page.locator('#email').fill(email);
  await page.getByRole('button', { name: t('forgot.submit'), exact: true }).click();
  const ok = page.locator('main [role=status]').filter({ hasText: t('forgot.sent') });
  await expect(ok).toBeVisible();
  return { main: (await page.locator('main').innerText()).replace(/\s+/g, ' '), message: (await ok.innerText()).replace(/\s+/g, ' ') };
}

async function mailCount(to: string) {
  const r = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await r.json()) as { messages: unknown[] }).messages.length;
}

test('E13 forgot password: identical answer for a known and an unknown email; mail only for the real one', async ({ page }) => {
  const u = await createUser('e13-known');
  const unknown = uniqEmail('e13-unknown');

  await page.goto('/en/login');
  await page.getByRole('link', { name: t('forgot.link') }).click();
  await expect(page).toHaveURL(/\/en\/forgot-password$/);
  await expect(page).toHaveTitle(`${t('forgot.title')} | ${t('common.appName')}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('forgot.title'));

  const known = await requestLink(page, u.email);
  const miss = await requestLink(page, unknown);
  expect(miss.message).toBe(known.message);
  expect(miss.main).toBe(known.main);

  const mail = await waitForMail(u.email, { match: /type=recovery/ });
  expect(mail.html + mail.text).toContain('/auth/callback?token_hash=');
  await new Promise((r) => setTimeout(r, 2500));
  expect(await mailCount(unknown)).toBe(0);
});

test('E13 recovery link leads to the reset form; the new password works and the old one does not', async ({ page, browser }) => {
  const u = await createUser('e13-reset');
  await requestLink(page, u.email);
  const link = confirmLink(await waitForMail(u.email, { match: /type=recovery/ }));

  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/en\/reset-password$/);
  await expect(page).toHaveTitle(`${t('reset.title')} | ${t('common.appName')}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('reset.title'));

  // A weak password is refused and the form stays.
  await page.getByLabel(t('reset.password')).fill('alllowercaseletters');
  await page.getByRole('button', { name: t('reset.submit'), exact: true }).click();
  await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.password_weak') })).toBeVisible();

  const fresh = strongPassword();
  await page.getByLabel(t('reset.password')).fill(fresh);
  await page.getByRole('button', { name: t('reset.submit'), exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account\?saved=1$/);

  await logoutUi(page);
  // Old password fails with the generic error; the new one signs in.
  await page.goto('/en/login');
  await page.locator('#email').fill(u.email);
  await page.locator('#password').fill(u.password);
  await page.locator('main form button[type=submit]').click();
  await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.login_failed') })).toBeVisible();
  await loginUi(page, { email: u.email, password: fresh });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(u.name);

  // The link was single use: following it again fails with the invalid-link message.
  const ctx = await freshContext(browser, page);
  const p = await ctx.newPage();
  await p.goto(link);
  await expect(p).toHaveURL(/\/en\/login\?error=link_invalid$/);
  await expect(p.locator('main [role=alert]')).toContainText(t('login.linkInvalid'));
  await ctx.close();
});

test('E13 the reset page without a valid recovery session shows the invalid-link message and a way to ask again', async ({ page }) => {
  await page.goto('/en/reset-password');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('reset.title'));
  await expect(page.locator('main [role=alert]')).toContainText(t('reset.noSession'));
  await expect(page.getByLabel(t('reset.password'))).toHaveCount(0);
  await page.getByRole('link', { name: t('reset.askAgain') }).click();
  await expect(page).toHaveURL(/\/en\/forgot-password$/);

  // A made-up recovery token is rejected and stays on this origin.
  const res = await page.request.get('/auth/callback?token_hash=notarealtoken123&type=recovery', { maxRedirects: 0 });
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.headers()['location']).toContain('link_invalid');
});

test('E13 forgot-password in Tamil keeps the neutral message in Tamil', async ({ page }) => {
  await page.goto('/ta/forgot-password');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
  await page.locator('#email').fill(uniqEmail('e13-ta'));
  await page.getByRole('button', { name: msg('ta', 'forgot.submit'), exact: true }).click();
  await expect(page.locator('main [role=status]').filter({ hasText: msg('ta', 'forgot.sent') })).toBeVisible();
});
