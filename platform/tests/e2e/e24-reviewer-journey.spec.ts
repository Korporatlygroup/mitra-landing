import { expect, test, type Page } from '@playwright/test';
import { claimOf, createReviewer, eventsOf, orgPath, reviewerGoto, smallPdf, submittedBusiness, submitClaimUi } from './support/biz';
import { sql } from './support/db';
import { msg } from './support/i18n';
import { waitForMail } from './support/mail';
import { freshContext, loginUi, logoutUi, type Locale } from './support/ui';

const adminPath = (l: Locale, tail = '') => `/${l}/admin/verification${tail}`;

async function startReview(page: Page, l: Locale) {
  await page.getByRole('button', { name: msg(l, 'adminVer.startReview'), exact: true }).click();
  // The form disappears once the item is in review, so its message cannot be observed; the status chip is the evidence.
  await expect(page.locator('main')).toContainText(msg(l, 'claimStatus.in_review'));
  await expect(page.getByRole('button', { name: msg(l, 'adminVer.startReview'), exact: true })).toHaveCount(0);
}
async function decide(page: Page, l: Locale, decision: 'approve' | 'reject' | 'request_info', reason: string, opts: { expectDone?: boolean } = {}) {
  const radio = { approve: '#d-approve', reject: '#d-reject', request_info: '#d-info' }[decision];
  await page.locator(radio).check();
  await page.locator('#reason').fill(reason);
  await page.getByRole('button', { name: msg(l, 'adminVer.saveDecision'), exact: true }).click();
  if (opts.expectDone === false) return;
  // The decision form disappears once the item is closed, so the new status is the evidence.
  const status = { approve: 'approved', reject: 'rejected', request_info: 'needs_info' }[decision];
  await expect(page.locator('main p').filter({ hasText: msg(l, `claimStatus.${status}`) }).first()).toBeVisible();
  await expect(page.locator('#reason')).toHaveCount(0);
}

test('E24 queue: aal1 is sent to MFA, aal2 sees the queue and its counts', async ({ page }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e24q' });
  const rv = await createReviewer('admin_review');

  // Not signed in with a second step yet: first enrol, later verify.
  await loginUi(page, rv, 'en');
  await page.goto(adminPath('en'));
  await expect(page).toHaveURL(/\/en\/mfa\/enrol\?next=%2Fen%2Fadmin%2Fverification/);
  await expect(page.locator('main')).not.toContainText(msg('en', 'adminVer.intro'));
  await reviewerGoto(page, rv, adminPath('en'), { login: false });

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'adminVer.title'));
  await expect(page).toHaveTitle(`${msg('en', 'adminVer.title')} | ${msg('en', 'common.appName')}`);
  await expect(page.getByLabel(msg('en', 'adminVer.filterLabel'))).toBeVisible();
  const row = page.locator('tbody tr').filter({ hasText: sub.orgName });
  await expect(row).toContainText(msg('en', 'claimTypes.business_registration'));
  await expect(row).toContainText(msg('en', 'claimStatus.submitted'));

  // Counts agree with the database.
  const counts = await sql<{ status: string; n: number }>(`select status::text, count(*)::int as n from public.verification_claims where submitted_at is not null group by status`);
  const nSubmitted = counts.find((c) => c.status === 'submitted')?.n ?? 0;
  await expect(page.locator('a.tile', { hasText: msg('en', 'claimStatus.submitted') }).first()).toContainText(String(nSubmitted));

  // Filter works.
  await page.goto(adminPath('en', '?status=approved'));
  await expect(page.locator('tbody tr').filter({ hasText: sub.orgName })).toHaveCount(0);
  await page.goto(adminPath('en', '?status=all'));
  await expect(page.locator('tbody tr').filter({ hasText: sub.orgName })).toHaveCount(1);

  // Back to the sign-in: aal1 again needs the code (verify, not enrol).
  await logoutUi(page);
  await loginUi(page, rv, 'en');
  await page.goto(adminPath('en'));
  await expect(page).toHaveURL(/\/en\/mfa\/verify\?next=%2Fen%2Fadmin%2Fverification/);
  await page.goto(adminPath('en', `/${sub.claimId}`));
  await expect(page).toHaveURL(/\/en\/mfa\/verify/);
  await expect(page.locator('main')).not.toContainText(sub.orgName);
});

for (const locale of ['en', 'ta'] as const satisfies readonly Locale[]) {
  test(`E24 review flow in ${locale}: start review, approve with a reason, owner is told (page, message, email)`, async ({ page, browser }) => {
    test.setTimeout(240_000);
    const t = (k: string, v?: Record<string, string>) => msg(locale, k, v);
    const sub = await submittedBusiness(page, { prefix: `e24a-${locale}`, locale });
    const rv = await createReviewer('admin_review');
    const reason = `Number matches the certificate ${locale}`;

    await reviewerGoto(page, rv, adminPath(locale));
    await expect(page.locator('tbody tr').filter({ hasText: sub.orgName })).toContainText(t('claimStatus.submitted'));
    await page.goto(adminPath(locale, `/${sub.claimId}`));
    await expect(page).toHaveURL(new RegExp(`/${locale}/admin/verification/${sub.claimId}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(sub.orgName);
    await expect(page.getByRole('heading', { level: 2, name: t('adminVer.snapshotTitle') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t('adminVer.ownerNote') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t('adminVer.docsTitle') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t('adminVer.historyTitle') })).toBeVisible();
    await expect(page.locator('main')).toContainText(t('adminVer.version', { n: '1' }));
    await expect(page.locator('main')).toContainText(t('documents.scanClean'));

    // The decision form only appears once the review is started? Either way, start it.
    await startReview(page, locale);
    await expect(page.locator('main')).toContainText(t('claimStatus.in_review'));
    expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('in_review');

    // A reason is required.
    await page.locator('#d-approve').check();
    await page.evaluate(() => ((document.querySelectorAll('main form')[document.querySelectorAll('main form').length - 1] as HTMLFormElement).noValidate = true));
    await page.locator('#reason').fill('no');
    await page.getByRole('button', { name: t('adminVer.saveDecision'), exact: true }).click();
    await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.reason_required') })).toBeVisible();
    await expect(page.locator('#reason')).toHaveValue('no');
    expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('in_review');

    await decide(page, locale, 'approve', reason);
    expect(await claimOf(sub.orgId, sub.ct)).toMatchObject({ status: 'approved', decision_reason: reason });
    expect((await eventsOf(sub.claimId)).map((e) => e.event)).toEqual(expect.arrayContaining(['submitted', 'review_started', 'approved']));

    // Owner: status chip, notification, preview.
    const ctx = await freshContext(browser, page);
    const op = await ctx.newPage();
    await loginUi(op, sub.owner, locale);
    await op.goto(`/${locale}/orgs/${sub.orgId}/business/verification`);
    await expect(op.getByRole('heading', { level: 2, name: new RegExp(t('claimTypes.business_registration')) })).toContainText(t('claimStatus.approved'));
    await op.goto(`/${locale}/notifications`);
    await expect(op.getByRole('heading', { level: 1 })).toHaveText(t('notifications.title'));
    const item = op.locator('li.card').filter({ hasText: t('notifications.kinds.verification_approved') });
    await expect(item).toContainText(t('notifications.new'));
    await expect(item.getByRole('link', { name: t('notifications.open') })).toBeVisible();
    await item.getByRole('button', { name: t('notifications.markRead'), exact: true }).click();
    await expect(op.locator('li.card').filter({ hasText: t('notifications.kinds.verification_approved') })).not.toContainText(t('notifications.new'));
    await op.goto(`/${locale}/orgs/${sub.orgId}/business/preview`);
    await expect(op.locator('main')).toContainText(locale === 'en' ? /Documents reviewed by MITRA on .+ for: business registration details/ : t('claimScope.business_registration'));
    await ctx.close();

    // Email: fixed EN + TA + MS subject (no reason in it), the reason only quoted in the body, in every language.
    const mail = await waitForMail(sub.owner.email, { match: /auth|verification/ });
    expect(mail.subject).toBe(`${msg('en', 'email.decision.subject')} / ${msg('ta', 'email.decision.subject')} / ${msg('ms', 'email.decision.subject')}`);
    expect(mail.subject).not.toContain(reason);
    for (const l of ['en', 'ta', 'ms'] as const) {
      expect(mail.text).toContain(msg(l, 'email.decision.reason', { reason: `“${reason}”` }));
      expect(mail.text).toContain(msg(l, 'email.decision.approve'));
    }
    expect(mail.text).toContain(`/en/orgs/${sub.orgId}/business/verification`);
    expect(mail.text.split(reason).length - 1).toBe(3); // once per language, always quoted
  });
}

test('E24 reject with a reason, owner fixes and resubmits; the history shows both versions', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
  const sub = await submittedBusiness(page, { prefix: 'e24r' });
  const rv = await createReviewer('admin_review');
  const reason = 'The certificate is unreadable';

  await reviewerGoto(page, rv, adminPath('en', `/${sub.claimId}`));
  await startReview(page, 'en');
  await decide(page, 'en', 'reject', reason);

  const ctx = await freshContext(browser, page);
  const op = await ctx.newPage();
  await loginUi(op, sub.owner);
  await op.goto(orgPath('en', sub.orgId, '/verification'));
  const article = op.locator('article').filter({ has: op.getByRole('heading', { level: 2, name: new RegExp(t('claimTypes.business_registration')) }) });
  await expect(article).toContainText(t('claimStatus.rejected'));
  await expect(article.locator('[role=note]')).toContainText(`${t('ver.reasonTitle')}: ${reason}`);
  await op.goto('/en/notifications');
  await expect(op.locator('li.card').filter({ hasText: t('notifications.kinds.verification_rejected') })).toBeVisible();

  // Fix and send again with a new document.
  await submitClaimUi(op, 'en', sub.orgId, sub.ct, { file: smallPdf('fixed'), resubmit: true, note: 'Clearer scan attached' });
  expect(await claimOf(sub.orgId, sub.ct)).toMatchObject({ status: 'submitted', version: 2 });
  await op.goto(orgPath('en', sub.orgId, '/verification'));
  const history = op.locator('article').filter({ has: op.getByRole('heading', { level: 2, name: new RegExp(t('claimTypes.business_registration')) }) }).locator('ol.timeline');
  await expect(history).toContainText(t('events.submitted'));
  await expect(history).toContainText(t('events.rejected'));
  await expect(history).toContainText(t('events.resubmitted'));
  await ctx.close();

  // Reviewer sees version 2 and the full history.
  await page.goto(adminPath('en', `/${sub.claimId}`));
  await expect(page.locator('main')).toContainText(t('adminVer.version', { n: '2' }));
  await expect(page.locator('main')).toContainText('Clearer scan attached');
  const timeline = page.locator('ol.timeline');
  for (const ev of ['submitted', 'review_started', 'rejected', 'resubmitted']) await expect(timeline).toContainText(t(`events.${ev}`));
  const evs = (await eventsOf(sub.claimId)).map((e) => e.event);
  expect(evs.filter((e) => e === 'submitted' || e === 'resubmitted')).toEqual(['submitted', 'resubmitted']);
});

test('E24 request more information, owner resubmits, the item returns to the queue', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
  const sub = await submittedBusiness(page, { prefix: 'e24i' });
  const rv = await createReviewer('admin_review');
  const reason = 'Please add the second page';

  await reviewerGoto(page, rv, adminPath('en', `/${sub.claimId}`));
  await startReview(page, 'en');
  await decide(page, 'en', 'request_info', reason);
  expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('needs_info');

  const ctx = await freshContext(browser, page);
  const op = await ctx.newPage();
  await loginUi(op, sub.owner);
  await op.goto(orgPath('en', sub.orgId, '/verification'));
  const article = op.locator('article').filter({ has: op.getByRole('heading', { level: 2, name: new RegExp(t('claimTypes.business_registration')) }) });
  await expect(article).toContainText(t('claimStatus.needs_info'));
  await expect(article.locator('[role=note]')).toContainText(reason);
  await op.goto('/en/notifications');
  await expect(op.locator('li.card').filter({ hasText: t('notifications.kinds.verification_info_requested') })).toBeVisible();
  await op.goto(orgPath('en', sub.orgId));
  await expect(op.locator('main')).toContainText(t('biz.next.fix'));
  await submitClaimUi(op, 'en', sub.orgId, sub.ct, { file: smallPdf('page2'), resubmit: true });
  await ctx.close();

  await page.goto(adminPath('en'));
  await expect(page.locator('tbody tr').filter({ hasText: sub.orgName })).toContainText(t('claimStatus.submitted'));
  expect(await claimOf(sub.orgId, sub.ct)).toMatchObject({ status: 'submitted', version: 2 });
});

test('E24 a decision made on an outdated page is refused (stale_version)', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
  const sub = await submittedBusiness(page, { prefix: 'e24s' });
  const rv = await createReviewer('admin_review');

  await reviewerGoto(page, rv, adminPath('en', `/${sub.claimId}`));
  await startReview(page, 'en');
  // This page now holds a decision form for version 1. A second tab decides first (request info), the owner
  // resubmits (version 2) and the review starts again.
  const second = await page.context().newPage();
  await second.goto(adminPath('en', `/${sub.claimId}`));
  await decide(second, 'en', 'request_info', 'Add the second page please');

  const ctx = await freshContext(browser, page);
  const op = await ctx.newPage();
  await loginUi(op, sub.owner);
  await submitClaimUi(op, 'en', sub.orgId, sub.ct, { file: smallPdf('v2'), resubmit: true });
  await ctx.close();
  await second.goto(adminPath('en', `/${sub.claimId}`));
  await startReview(second, 'en');
  await second.close();

  await decide(page, 'en', 'approve', 'Looks fine from the old page', { expectDone: false });
  await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.stale_version') })).toBeVisible();
  expect(await claimOf(sub.orgId, sub.ct)).toMatchObject({ status: 'in_review', version: 2 });
});
