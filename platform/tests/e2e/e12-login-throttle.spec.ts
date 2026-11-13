import { expect, test } from '@playwright/test';
import { createUser, sql, uniqEmail } from './support/db';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

const t = (k: string) => msg('en', k);

// E12: 10 login attempts per 15 minutes per email; the 11th is refused before the password is checked.
test('E12 the 11th wrong login for one email is throttled; other emails are unaffected', async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const victim = await createUser('e12-victim');
  const other = await createUser('e12-other');

  await page.goto('/en/login');
  const attempt = async (email: string, password: string) => {
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const resp = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/en/login');
    await page.locator('main form button[type=submit]').click();
    await resp;
  };
  const alertWith = (text: string) => page.locator('main [role=alert]').filter({ hasText: text });

  for (let i = 1; i <= 10; i++) {
    await attempt(victim.email, `Wrong-Password-${i}-x`);
    await expect(alertWith(t('errors.login_failed')), `attempt ${i} shows the generic error`).toBeVisible();
    await expect(alertWith(t('errors.rate_limited'))).toHaveCount(0);
  }

  await attempt(victim.email, 'Wrong-Password-11-x');
  await expect(alertWith(t('errors.rate_limited'))).toBeVisible();

  // Throttled before the password is checked: even the correct password is refused now, and no session starts.
  await attempt(victim.email, victim.password);
  await expect(alertWith(t('errors.rate_limited'))).toBeVisible();
  await expect(page).toHaveURL(/\/en\/login/);
  expect((await context.cookies()).filter((c) => c.name.startsWith('sb-'))).toHaveLength(0);

  // The key is the email (case-insensitive), not the browser: a fresh session is throttled too.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('/en/login');
  await p2.locator('#email').fill(victim.email.toUpperCase());
  await p2.locator('#password').fill(victim.password);
  await p2.locator('main form button[type=submit]').click();
  await expect(p2.locator('main [role=alert]').filter({ hasText: t('errors.rate_limited') })).toBeVisible();
  await ctx2.close();

  // Another account and an unknown address are unaffected.
  await attempt(uniqEmail('e12-unknown'), 'Wrong-Password-1-x');
  await expect(alertWith(t('errors.login_failed'))).toBeVisible();
  await loginUi(page, other);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(other.name);

  // The throttle table holds a hash of the email, never the address.
  const keys = await sql<{ key: string }>(`select distinct key from public.rate_limit_events where key like 'login:%'`);
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.some((k) => k.key.includes(victim.email))).toBe(false);
});
