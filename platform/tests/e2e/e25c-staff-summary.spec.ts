import { expect, test, type Page } from '@playwright/test';
import { addMember, createReviewer, decideAs, freshReviewerContext, orgPath, submittedBusiness } from './support/biz';
import { createUser } from './support/db';
import { msg } from './support/i18n';
import { freshContext, loginUi } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);

// Staff and viewers get the real claim statuses (get_verification_summary), never a stale "Unverified profile".
test('E25 staff and viewers see real claim statuses and the right preview wording before and after approval', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const sub = await submittedBusiness(page, { prefix: 'e25sum' });
  const staff = await createUser('e25s-staff');
  const viewer = await createUser('e25s-viewer');
  await addMember(sub.orgId, staff.id, 'staff');
  await addMember(sub.orgId, viewer.id, 'viewer');

  const sessions: { who: string; page: Page; close: () => Promise<void> }[] = [];
  for (const [who, u] of [['staff', staff], ['viewer', viewer]] as const) {
    const ctx = await freshContext(browser, page);
    const p = await ctx.newPage();
    await loginUi(p, u);
    sessions.push({ who, page: p, close: () => ctx.close() });
  }
  const card = (p: Page) => p.locator('li.card', { hasText: t('claimTypes.business_registration') });

  // Before approval: waiting for review; the registered note carries the "not reviewed yet" sentence.
  for (const s of sessions) {
    await s.page.goto(orgPath('en', sub.orgId));
    await expect(card(s.page), `${s.who} overview`).toContainText(t('claimStatus.submitted'));
    await s.page.goto(orgPath('en', sub.orgId, '/preview'));
    await expect(s.page.locator('main'), `${s.who} preview`).toContainText(t('preview.registeredNote'));
    await expect(s.page.locator('main')).toContainText(t('preview.notReviewedYet'));
    await expect(s.page.locator('main')).toContainText(t('preview.unverified'));
  }

  // Approve as a reviewer.
  const rv = await createReviewer('admin_review');
  const rctx = await freshReviewerContext(browser, page);
  const rp = await rctx.newPage();
  await decideAs(rp, rv, sub.claimId, 'approve', 'Evidence checked and matches');
  await rctx.close();

  for (const s of sessions) {
    await s.page.goto(orgPath('en', sub.orgId));
    await expect(card(s.page), `${s.who} overview after approval`).toContainText(t('claimStatus.approved'));
    await expect(s.page.locator('main')).not.toContainText(t('biz.unverified'));
    await s.page.goto(orgPath('en', sub.orgId, '/preview'));
    await expect(s.page.locator('main'), `${s.who} preview after approval`).toContainText(t('preview.registeredNote'));
    await expect(s.page.locator('main')).not.toContainText(t('preview.notReviewedYet'));
    await expect(s.page.locator('main')).not.toContainText(t('preview.nothingReviewed'));
    await expect(s.page.locator('main')).toContainText(/Documents reviewed by INOK on .+ for: business registration details/);
    await s.close();
  }

  // The owner agrees.
  await page.goto(orgPath('en', sub.orgId, '/preview'));
  await expect(page.locator('main')).not.toContainText(t('preview.notReviewedYet'));
  await expect(page.locator('main')).toContainText(t('preview.registeredNote'));
});
