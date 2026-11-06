import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { sql, strongPassword, uniqEmail, type TestUser } from './db';
import { BASE_URL, readState, writeState } from './env';
import { confirmLink, waitForMail } from './mail';
import { msg } from './i18n';
import { freshCode } from './totp';

export type Locale = 'en' | 'ta';

/** Fails if the page scrolls horizontally (checked at the project viewport). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `horizontal scroll: scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
}

/** Real UI sign-up. Returns after the "check your email" page is shown. */
export async function signUpUi(
  page: Page,
  o: { locale: Locale; name: string; email: string; password: string; language?: Locale },
): Promise<void> {
  await submitSignUp(page, o);
  await expect(page).toHaveURL(/\/signup\/check-email$/);
}

/** Fills and submits the sign-up form without asserting the outcome. */
export async function submitSignUp(
  page: Page,
  o: { locale: Locale; name: string; email: string; password: string; language?: Locale },
): Promise<void> {
  await page.goto(`/${o.locale}/signup`);
  await page.locator('#displayName').fill(o.name);
  await page.locator('#email').fill(o.email);
  await page.locator('#password').fill(o.password);
  if (o.language) await page.locator('#language').selectOption(o.language);
  await page.locator('#acceptTerms').check();
  await page.locator('#acceptPrivacy').check();
  await page.locator('main form button[type=submit]').click();
}

/** Opens the confirmation link from Mailpit in this page (the callback signs the user in). */
export async function confirmEmailUi(page: Page, email: string): Promise<void> {
  const mail = await waitForMail(email, { match: /\/auth\/callback\?/ });
  await page.goto(confirmLink(mail));
  await expect(page).not.toHaveURL(/auth\/callback/);
}

/** Real UI login. Resolves when the browser has left the login page. */
export async function loginUi(page: Page, u: { email: string; password: string }, locale: Locale = 'en', next?: string): Promise<void> {
  await page.goto(`/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.locator('#email').fill(u.email);
  await page.locator('#password').fill(u.password);
  await page.locator('main form button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

export async function logoutUi(page: Page, locale: Locale = 'en'): Promise<void> {
  await page.goto(`/${locale}`);
  await page.getByRole('button', { name: msg(locale, 'nav.signOut'), exact: true }).first().click();
  await expect(page.getByRole('link', { name: msg(locale, 'nav.signIn'), exact: true }).first()).toBeVisible();
}

/** Creates an org through the UI form and returns its id (from the redirect to its members page). */
export async function createOrgUi(page: Page, type: 'business' | 'buyer' | 'partner', name: string, locale: Locale = 'en'): Promise<string> {
  await page.goto(`/${locale}/orgs/new`);
  await page.locator(`#type-${type}`).check();
  await page.locator('#name').fill(name);
  await page.locator('main form button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]{36}\/members$/);
  return page.url().match(/orgs\/([0-9a-f-]{36})\/members/)![1]!;
}

export const errorText = (locale: Locale, key: string) => msg(locale, `errors.${key}`);

/** Submits a TOTP code on /mfa/enrol (after the secret is shown) or /mfa/verify. */
export async function submitCode(page: Page, code: string): Promise<void> {
  await page.locator('#code').fill(code);
  await page.locator('form:has(#code) button[type=submit]').click();
}

/** Enrols an authenticator on /mfa/enrol and returns the shown secret (the code step is left to the caller). */
export async function startEnrolAndReadSecret(page: Page, locale: Locale = 'en'): Promise<string> {
  await page.getByRole('button', { name: msg(locale, 'mfa.start'), exact: true }).click();
  const secret = (await page.locator('code').first().innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  return secret;
}

// ---------------------------------------------------------------------------------------------
// The first admin (created once in global-setup) and fresh admins for the other project.
// ---------------------------------------------------------------------------------------------

/** Signs the first administrator in and gets through MFA (enrolling on first use). Returns the TOTP secret. */
export async function adminLogin(page: Page, nextPath = '/en/admin/audit'): Promise<void> {
  const st = readState();
  if (!st.admin) throw new Error('No bootstrap admin in e2e state (global setup could not create one).');
  await loginUi(page, st.admin, 'en');
  await page.goto(nextPath);
  if (/\/mfa\/enrol/.test(page.url())) {
    const secret = await startEnrolAndReadSecret(page);
    await submitCode(page, freshCode(secret));
    st.admin.secret = secret;
    writeState(st);
    await expect(page).toHaveURL(new RegExp(nextPath.replace(/\//g, '\\/')));
  } else if (/\/mfa\/verify/.test(page.url())) {
    if (!st.admin.secret) throw new Error('Admin has a factor but no secret was stored.');
    await submitCode(page, freshCode(st.admin.secret));
    await expect(page).toHaveURL(new RegExp(nextPath.replace(/\//g, '\\/')));
  }
}

/** Test setup only: a fresh super administrator (service API user + membership in the MITRA org as postgres). */
export async function addMitraMember(userId: string, role: string): Promise<void> {
  const org = (await sql(`select id from public.organisations where type = 'mitra'`))[0]!.id as string;
  await sql(`insert into public.memberships (org_id, user_id, role) values ($1, $2, $3::public.member_role)
             on conflict (org_id, user_id) do update set role = excluded.role, status = 'active', removed_at = null`, [org, userId, role]);
}

/** Global-setup helper: sign up through the UI, confirm through Mailpit and return the account. */
export async function signUpAndConfirm(page: Page, context: BrowserContext, prefix: string): Promise<TestUser> {
  void context;
  const u = { id: '', email: uniqEmail(prefix), password: strongPassword(), name: `E2E ${prefix}` };
  await signUpUi(page, { locale: 'en', name: u.name, email: u.email, password: u.password });
  await confirmEmailUi(page, u.email);
  return u;
}

export { BASE_URL };

/** A second, independent browser session (cookies) at the same viewport as `like`. */
export async function freshContext(browser: Browser, like: Page): Promise<BrowserContext> {
  const mobile = (like.viewportSize()?.width ?? 1280) < 500;
  return browser.newContext({ baseURL: BASE_URL, viewport: like.viewportSize() ?? undefined, isMobile: mobile, hasTouch: mobile });
}
