import { expect, test, type Page } from '@playwright/test';
import { createUser, sql, strongPassword, uniqEmail } from './support/db';
import { msg } from './support/i18n';
import { signUpUi, submitSignUp } from './support/ui';

const t = (k: string) => msg('en', k);

async function loginAttempt(page: Page, email: string, password: string) {
  await page.goto('/en/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('main form button[type=submit]').click();
  const alert = page.locator('main [role=alert]').filter({ hasText: t('errors.login_failed') });
  await expect(alert).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  return { text: (await alert.innerText()).trim(), email: await page.locator('#email').inputValue(), pw: await page.locator('#password').inputValue() };
}

// E10: no account enumeration.
test('E10 login errors are identical for a wrong password and an unknown email', async ({ page }) => {
  const u = await createUser('e10-login');
  const wrongPw = await loginAttempt(page, u.email, 'Definitely-Wrong-1');
  const unknown = await loginAttempt(page, uniqEmail('e10-nobody'), 'Definitely-Wrong-1');
  expect(wrongPw.text).toBe(unknown.text);
  expect(wrongPw.text).toContain(t('errors.login_failed'));
  // The email is kept for retyping; the password is never echoed back.
  expect(wrongPw.email).toBe(u.email);
  expect(wrongPw.pw).toBe('');
  expect(unknown.pw).toBe('');
  // Page markup differs only by what the user typed: same alert role, same structure.
  const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(body).not.toMatch(/not registered|no such user|unknown (user|email)|does not exist/i);
});

// GoTrue answers 422 user_already_exists for a confirmed account; the app must still show the same
// check-your-email page as for a fresh address, or sign-up enumerates accounts.
test('E10 sign-up with an already registered email looks identical to a fresh sign-up', async ({ page }) => {
  const existing = await createUser('e10-exists');
  const pw = strongPassword();

  await signUpUi(page, { locale: 'en', name: 'Fresh Person', email: uniqEmail('e10-fresh'), password: pw });
  const fresh = { url: new URL(page.url()).pathname, main: (await page.locator('main').innerText()).replace(/\s+/g, ' ') };

  await submitSignUp(page, { locale: 'en', name: 'Duplicate Person', email: existing.email, password: pw });
  await expect(page).toHaveURL(/\/signup\/check-email$/, { timeout: 8000 });
  const dup = { url: new URL(page.url()).pathname, main: (await page.locator('main').innerText()).replace(/\s+/g, ' ') };

  expect(dup).toEqual(fresh);
  expect(dup.main).not.toMatch(/already|exists|registered|in use/i);

  // The existing account was not touched (still the original name and password still works).
  const row = await sql<{ display_name: string }>(`select display_name from public.profiles where id = $1`, [existing.id]);
  expect(row[0]!.display_name).toBe(existing.name);
  // Different letter case of the same address is also treated as already registered, with the same outcome.
  await submitSignUp(page, { locale: 'en', name: 'Case Twin', email: existing.email.toUpperCase(), password: pw });
  await expect(page).toHaveURL(/\/signup\/check-email$/, { timeout: 8000 });
  expect((await page.locator('main').innerText()).replace(/\s+/g, ' ')).toBe(fresh.main);
});

test('E10 weak password shows an error and keeps the other fields', async ({ page }) => {
  const email = uniqEmail('e10-weak');
  await page.goto('/en/signup');
  await page.locator('#displayName').fill('Weak Pass');
  await page.locator('#email').fill(email);
  await page.locator('.signup-more > summary').click(); // the language choice sits in a collapsed row
  await page.locator('#language').selectOption('ta');
  await page.locator('#acceptTerms').check();
  await page.locator('#acceptPrivacy').check();

  // 10+ characters but no capital letter / number: the browser allows it, the server refuses it.
  await page.locator('#password').fill('alllowercaseletters');
  await page.locator('main form button[type=submit]').click();
  const alert = page.locator('main [role=alert]').filter({ hasText: t('errors.password_weak') });
  await expect(alert).toBeVisible();
  await expect(page).toHaveURL(/\/en\/signup$/);
  await expect(page.locator('#displayName')).toHaveValue('Weak Pass');
  await expect(page.locator('#email')).toHaveValue(email);
  await expect(page.locator('#language')).toHaveValue('ta');
  await expect(page.locator('#acceptTerms')).toBeChecked();
  await expect(page.locator('#acceptPrivacy')).toBeChecked();
  await expect(page.locator('#password')).toHaveValue(''); // secrets are never restored
  expect(await sql(`select 1 from auth.users where email = $1`, [email])).toHaveLength(0);

  // Too short: the browser itself stops the submit (minlength), nothing is sent.
  await page.locator('#password').fill('Ab1');
  expect(await page.locator('#password').evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true);

  // Bypassing the browser check, the server still refuses it with the same message.
  await page.evaluate(() => ((document.querySelector('main form') as HTMLFormElement).noValidate = true));
  await page.locator('main form button[type=submit]').click();
  await expect(alert).toBeVisible();
  await expect(page.locator('#password')).toHaveValue(''); // the second attempt has finished: the form was reset, so the next fill is not wiped
  await expect(page.locator('#email')).toHaveValue(email);
  expect(await sql(`select 1 from auth.users where email = $1`, [email])).toHaveLength(0);

  // And a strong password finally works, keeping the form values the user corrected.
  await page.locator('#password').fill(strongPassword());
  await page.locator('main form button[type=submit]').click();
  await expect(page).toHaveURL(/\/ta\/signup\/check-email$/); // language field chose Tamil
});

test('E10 sign-up requires both consents', async ({ page }) => {
  await page.goto('/en/signup');
  await page.locator('#displayName').fill('No Consent');
  await page.locator('#email').fill(uniqEmail('e10-consent'));
  await page.locator('#password').fill(strongPassword());
  await page.locator('#acceptTerms').check();
  await page.locator('main form button[type=submit]').click();
  // Native required validation on the unchecked privacy box: still on the sign-up page.
  await expect(page).toHaveURL(/\/en\/signup$/);
  expect(await page.locator('#acceptPrivacy').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
});
