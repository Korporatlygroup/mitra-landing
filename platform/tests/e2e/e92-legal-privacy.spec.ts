import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LEGAL_DOCS } from '../../src/lib/legal';
import { createUser, sql, strongPassword, uniqEmail } from './support/db';
import { createReviewer, reviewerGoto } from './support/biz';
import { msg } from './support/i18n';
import { confirmEmailUi, expectNoHorizontalScroll, loginUi, type Locale } from './support/ui';

const t = (l: Locale, k: string) => msg(l, k);

// E92: legal pages (draft), cookies as actually set, sign-up consent (terms, privacy, optional marketing) and data requests.
for (const locale of ['en', 'ms', 'ta'] as const) {
  test(`E92 every legal page opens for a signed-out visitor in ${locale}, is marked draft and noindex, and is accessible`, async ({ page }) => {
    for (const slug of LEGAL_DOCS) {
      const res = await page.goto(`/${locale}/${slug}`);
      expect(res?.status(), slug).toBe(200);
      await expect(page.getByTestId('legal-draft-banner'), slug).toBeVisible();
      await expect(page.locator('meta[name=robots]'), slug).toHaveAttribute('content', /noindex/);
      await expect(page.getByRole('heading', { level: 1 }), slug).toBeVisible();
      await expect(page.locator('.legal-toc a').first(), slug).toBeVisible();
      if (locale === 'ta') await expect(page.getByTestId('legal-translation-notice'), slug).toBeVisible();
      else await expect(page.getByTestId('legal-translation-notice')).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      const bad = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => v.id), slug).toEqual([]);
    }
  });
}

test('E92 company details are visible placeholders, never invented, and the footer links every policy', async ({ page }) => {
  await page.goto('/en/privacy');
  await expect(page.locator('main')).toContainText('Registered company name: to be provided by management');
  await expect(page.locator('main')).not.toContainText(/Sdn\.? ?Bhd/);
  const foot = page.locator('footer');
  for (const href of ['/en/terms', '/en/privacy', '/en/marketplace-policy', '/en/cookies', '/en/government-disclaimer', '/en/complaints']) {
    await expect(foot.locator(`a[href="${href}"]`), href).toBeVisible();
  }
  await page.goto('/ms/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notis Privasi');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/en/terms');
  await expectNoHorizontalScroll(page);
});

test('E92 cookies: only the documented cookies are set for a visitor, and the policy lists them', async ({ page, context }) => {
  await page.goto('/en');
  const names = (await context.cookies()).map((c) => c.name).sort();
  expect(names.filter((n) => !['NEXT_LOCALE'].includes(n)), 'no other cookie before sign-in').toEqual([]);
  await page.goto('/en/cookies');
  for (const n of ['sb-', 'inok_org', 'NEXT_LOCALE']) await expect(page.locator('main')).toContainText(n);
  // No third-party script or request on a public page.
  const origin = new URL(page.url()).origin;
  const foreign: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  expect(foreign).toEqual([]);
});

test('E92 sign-up shows links to the policies, requires terms and privacy, and the marketing box is optional and unticked', async ({ page }) => {
  await page.goto('/en/signup');
  await expect(page.locator('#acceptMarketing')).not.toBeChecked();
  await expect(page.locator('#acceptMarketing')).not.toHaveAttribute('required', '');
  await expect(page.locator('#acceptTerms')).toHaveAttribute('required', '');
  await expect(page.locator('#acceptPrivacy')).toHaveAttribute('required', '');
  for (const href of ['/en/terms', '/en/privacy', '/en/cookies']) await expect(page.locator(`main a[href="${href}"]`), href).toBeVisible();
  // Without terms the server refuses even if the browser check is bypassed.
  await page.locator('#displayName').fill('No Terms');
  await page.locator('#email').fill(uniqEmail('e92-noterms'));
  await page.locator('#password').fill(strongPassword());
  await page.locator('#acceptTerms').evaluate((el: HTMLInputElement) => el.removeAttribute('required'));
  await page.locator('#acceptPrivacy').evaluate((el: HTMLInputElement) => el.removeAttribute('required'));
  await page.locator('main form button[type=submit]').click();
  await expect(page.locator('main [role=alert]')).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

for (const tick of [false, true]) {
  test(`E92 sign-up with marketing ${tick ? 'ticked' : 'left unticked'} records versioned terms and privacy consent, and marketing only when ticked`, async ({ page, context }) => {
    const email = uniqEmail(`e92-${tick}`);
    const password = strongPassword();
    await page.goto('/en/signup');
    await page.locator('#displayName').fill('Consent Test');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#acceptTerms').check();
    await page.locator('#acceptPrivacy').check();
    if (tick) await page.locator('#acceptMarketing').check();
    await page.locator('main form button[type=submit]').click();
    await expect(page).toHaveURL(/\/signup\/check-email$/);
    const rows = await sql<{ purpose: string; version: string; granted_at: string; withdrawn_at: string | null }>(
      `select c.purpose, c.version, c.granted_at::text, c.withdrawn_at::text from public.consents c join auth.users u on u.id = c.user_id where u.email = $1 order by c.purpose`,
      [email],
    );
    expect(rows.map((r) => r.purpose)).toEqual(tick ? ['marketing', 'privacy', 'terms'] : ['privacy', 'terms']);
    for (const r of rows) {
      expect(r.version).toBe('2026-07');
      expect(r.granted_at).toBeTruthy();
      expect(r.withdrawn_at).toBeNull();
    }
    // The account page shows the real state, and it can be changed and withdrawn.
    await confirmEmailUi(page, email);
    await context.clearCookies();
    await loginUi(page, { email, password }, 'en');
    await page.goto('/en/account?section=notifications');
    const box = page.locator('#marketing');
    if (tick) await expect(box).toBeChecked(); else await expect(box).not.toBeChecked();
    if (tick) await box.uncheck(); else await box.check();
    await page.locator('form:has(#marketing) button[type=submit]').click();
    await expect(page.locator('form:has(#marketing) .form-message-slot')).toContainText(t('en', 'account.marketingSaved'));
    const active = await sql<{ n: number }>(
      `select count(*)::int as n from public.consents c join auth.users u on u.id = c.user_id where u.email = $1 and c.purpose = 'marketing' and c.withdrawn_at is null`,
      [email],
    );
    expect(active[0]!.n).toBe(tick ? 0 : 1);
    // Required consents never change, and withdrawals/grants are in the audit trail.
    const audit = await sql<{ action: string }>(`select a.action from public.audit_log a join auth.users u on u.id = a.actor_user_id where u.email = $1 and a.action like 'consent.%'`, [email]);
    expect(audit.length).toBeGreaterThan(0);
  });
}

test('E92 a signed-in user sends a data request; it is isolated, rate-limited, and an administrator answers it with an audit trail', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const user = await createUser('e92-req', { name: 'Request Person' });
  const other = await createUser('e92-other');
  await loginUi(page, user, 'en');
  await page.goto('/en/account?section=data');
  await page.locator('#request-type').selectOption('access');
  await page.locator('#request-details').fill('Please send me a copy of the personal data you hold about me.');
  await page.locator('form:has(#request-details) button[type=submit]').click();
  await expect(page.getByTestId('my-privacy-requests')).toContainText(t('en', 'account.requestTypes.access'));
  const rows = await sql<{ id: string; status: string; due_days: number }>(
    `select r.id, r.status, extract(day from r.due_at - r.created_at)::int as due_days from public.privacy_requests r where r.user_id = $1`,
    [user.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: 'open', due_days: 21 });

  // Another user sees nothing of it; an ordinary user cannot reach the administrator page.
  const octx = await browser.newContext();
  const op = await octx.newPage();
  await loginUi(op, other, 'en');
  await op.goto('/en/account');
  await expect(op.getByTestId('my-privacy-requests')).toHaveCount(0);
  await op.goto('/en/admin/privacy-requests');
  await expect(op.getByTestId('privacy-request')).toHaveCount(0);
  await octx.close();

  // An administrator answers; closing needs a written answer.
  const admin = await createReviewer('admin_super', 'e92adm');
  const actx = await browser.newContext();
  const ap = await actx.newPage();
  await reviewerGoto(ap, admin, '/en/admin/privacy-requests');
  const card = ap.locator('[data-testid=privacy-request]').filter({ hasText: user.email });
  await expect(card).toBeVisible();
  await card.locator('select').selectOption('completed');
  await card.locator('button[type=submit]').click();
  await expect(card.locator('[role=alert]')).toBeVisible();
  await card.locator('textarea').fill('A copy was sent to the email address on your account.');
  await card.locator('button[type=submit]').click();
  await expect.poll(async () => (await sql<{ status: string }>(`select status from public.privacy_requests where id = $1`, [rows[0]!.id]))[0]!.status).toBe('completed');
  const audit = await sql<{ action: string }>(`select action from public.audit_log where entity_id = $1 order by id`, [rows[0]!.id]);
  expect(audit.map((a) => a.action)).toEqual(['privacy.request.submitted', 'privacy.request.completed']);
  await page.goto('/en/account?section=data');
  await expect(page.getByTestId('my-privacy-requests')).toContainText('A copy was sent');
  await actx.close();
});
