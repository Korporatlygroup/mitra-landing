import { expect, test, type Page } from '@playwright/test';
import { createUser, sql } from './support/db';
import { shot } from './support/qa-evidence';

// E106 Turnstile on registration, sign-in and password reset. OPT-IN: runs only with E2E_TURNSTILE=1 against a stack where
//  - the app was BUILT with NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA (Cloudflare's always-passes test key), and
//  - local Supabase Auth has [auth.captcha] enabled with provider "turnstile" and secret 1x0000000000000000000000000000000AA (the test secret).
// It needs internet access to challenges.cloudflare.com. Normal CI leaves Turnstile off, which is the production default until approved.
test.skip(process.env.E2E_TURNSTILE !== '1', 'opt-in: E2E_TURNSTILE=1 with a Turnstile-enabled build and local Supabase captcha');

const token = async (page: Page) => {
  await expect.poll(async () => (await page.locator('input[name=captchaToken]').inputValue()).length, { timeout: 30_000 }).toBeGreaterThan(10);
};

test('E106 sign-up, sign-in and reset work with the security check; a missing token is refused in plain words', async ({ page }) => {
  test.setTimeout(240_000);
  // sign-up
  const email = `ts-${Date.now().toString(36)}@example.test`;
  await page.goto('/en/signup');
  await token(page);
  await shot(page, { role: 'visitor', journey: 'turnstile', step: '01-signup-widget', title: 'Sign-up with the security check', expected: 'Security check above the optional consent, form otherwise unchanged', observed: 'Widget shown', widths: [360, 1280] });
  await page.locator('#displayName').fill('Turnstile Test');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('Abcdefghijk1');
  await page.locator('#acceptTerms').check();
  await page.locator('#acceptPrivacy').check();
  await page.locator('main form button[type=submit]').click();
  await expect(page).toHaveURL(/signup\/check-email/);
  expect(Number((await sql<{ n: string }>(`select count(*) n from auth.users where email=$1`, [email]))[0]!.n)).toBe(1);

  // sign-up without a token is refused by the app before Supabase is called
  await page.goto('/en/signup');
  await token(page);
  await page.locator('#displayName').fill('No Token');
  await page.locator('#email').fill(`nt-${Date.now().toString(36)}@example.test`);
  await page.locator('#password').fill('Abcdefghijk1');
  await page.locator('#acceptTerms').check();
  await page.locator('#acceptPrivacy').check();
  await page.evaluate(() => { (document.querySelector('input[name=captchaToken]') as HTMLInputElement).value = ''; });
  await page.locator('main form button[type=submit]').click();
  await expect(page.locator('p.message-error')).toContainText('security check');

  // sign-in with a confirmed user
  const u = await createUser('ts-login');
  await page.goto('/en/login');
  await token(page);
  await page.locator('#email').fill(u.email);
  await page.locator('#password').fill(u.password);
  await page.locator('main form button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login/);

  // password reset keeps its neutral answer
  await page.context().clearCookies();
  await page.goto('/en/forgot-password');
  await token(page);
  await page.locator('#email').fill('nobody-here@example.test');
  await page.locator('main form button[type=submit]').click();
  await expect(page.locator('main')).toContainText(/sent|check your email|if an account/i);
});
