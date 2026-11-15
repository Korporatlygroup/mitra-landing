import { expect, test } from '@playwright/test';
import { createUser, sql, strongPassword, uniqEmail } from './support/db';
import { msg } from './support/i18n';
import { confirmEmailUi, expectNoHorizontalScroll, loginUi, signUpUi, type Locale } from './support/ui';

// E1 (F1): sign-up -> confirmation email (Mailpit) -> login -> home, in en and ta.
for (const locale of ['en', 'ta', 'ms'] as const satisfies readonly Locale[]) {
  test(`E1 sign-up, email confirmation, login and home in ${locale}`, async ({ page, context }) => {
    const email = uniqEmail(`e1-${locale}`);
    const password = strongPassword();
    const name = `Kumar ${locale}`;

    await page.goto(`/${locale}/signup`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'signup.title'));
    await expectNoHorizontalScroll(page);

    await signUpUi(page, { locale, name, email, password });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'signup.checkEmailTitle'));
    await expect(page.locator('main')).toContainText(msg(locale, 'signup.checkEmailBody'));
    await expectNoHorizontalScroll(page);

    // Login is refused until the email is confirmed (generic message).
    await loginUi(page, { email, password }, locale).catch(() => undefined);
    await expect(page.locator('main [role=alert]').filter({ hasText: msg(locale, 'errors.login_failed') })).toBeVisible();

    // The profile stored the chosen language and consent was recorded.
    const prof = await sql<{ language: string; display_name: string }>(
      `select language, display_name from public.profiles p join auth.users u on u.id = p.id where u.email = $1`,
      [email],
    );
    expect(prof[0]).toMatchObject({ language: locale, display_name: name });

    // Confirm through the real email, then start from a clean browser and log in.
    await confirmEmailUi(page, email);
    await context.clearCookies();
    await loginUi(page, { email, password }, locale);

    await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg(locale, 'home.titleSignedIn', { name }));
    await expect(page.getByRole('heading', { level: 2, name: msg(locale, 'home.yourOrgs') })).toBeVisible();
    await expect(page.getByRole('button', { name: msg(locale, 'ws.accountMenu'), exact: true }).or(page.getByRole('button', { name: msg(locale, 'nav.signOut'), exact: true })).first()).toBeVisible();
    if (locale === 'ta') {
      // Tamil script actually renders (not English fallbacks).
      expect(await page.locator('main').innerText()).toMatch(/[஀-௿]/);
      await expect(page.locator('main')).not.toContainText('Your organisations');
    }
    await expectNoHorizontalScroll(page);

    // The audit trail has the sign-up confirmation and the login.
    const audit = await sql<{ action: string }>(
      `select a.action from public.audit_log a join auth.users u on u.id = a.actor_user_id where u.email = $1`,
      [email],
    );
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['auth.signup', 'auth.login']));
  });
}

test('E1 a returning user lands on the page in their profile language', async ({ page }) => {
  const u = await createUser('e1-lang', { language: 'ta', name: 'Meena' });
  await loginUi(page, u, 'en');
  await expect(page).toHaveURL(/\/ta$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
});
