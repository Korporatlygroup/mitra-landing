import { expect, test, type Page } from '@playwright/test';
import { aal2Token, addMember, claimOf, createReviewer, docsOf, freshReviewerContext, onboardUi, orgPath, reviewerGoto, submitClaimUi, submittedBusiness } from './support/biz';
import { createOrgAs, createUser, rpcFromPage, sql } from './support/db';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const detail = (id: string) => `/en/admin/verification/${id}`;
const alertWith = (page: Page, text: string) => page.locator('main [role=alert]').filter({ hasText: text });

/** Test setup: the person leaves the business (membership removed), as pg would after a leave or removal. */
async function leave(orgId: string, userId: string) {
  await sql(`update public.memberships set status = 'removed', removed_at = now() where org_id = $1 and user_id = $2`, [orgId, userId]);
}

async function expectBlocked(page: Page, rv: Awaited<ReturnType<typeof createReviewer>>, sub: { claimId: string; orgId: string; ct: 'business_registration' }, docId: string) {
  await page.goto(detail(sub.claimId));
  await page.getByRole('button', { name: t('adminVer.startReview'), exact: true }).click();
  await expect(alertWith(page, t('errors.conflict_of_interest'))).toBeVisible();
  expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('submitted');
  expect((await page.request.get(`/api/v1/documents/${docId}`)).status()).toBe(404);
  const token = await aal2Token(rv);
  const start = await rpcFromPage(page, token, 'start_review', { p_claim: sub.claimId });
  expect(start.status).toBeGreaterThanOrEqual(400);
  expect(start.body?.message).toBe('conflict_of_interest');
  const dec = await rpcFromPage(page, token, 'decide_claim', { p_claim: sub.claimId, p_decision: 'approve', p_reason: 'approving my old shop', p_expected_version: 1 });
  expect(dec.status).toBeGreaterThanOrEqual(400);
  expect(dec.body?.message).toBe('conflict_of_interest');
  expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('submitted');
}

// A: owner, submit, add a second owner, leave, then try to approve.
test('E25 a reviewer who created and submitted the business stays conflicted after adding a second owner and leaving', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const rv = await createReviewer('admin_review', 'owner-reviewer');
  const orgId = await createOrgAs(rv, 'business', `Own Shop ${Math.random().toString(36).slice(2, 8)}`);

  // As the owner (they are also a reviewer, so every page needs their second step).
  await reviewerGoto(page, rv, orgPath('en', orgId));
  await onboardUi(page, 'en', orgId);
  await submitClaimUi(page, 'en', orgId, 'business_registration');
  const claim = (await claimOf(orgId, 'business_registration'))!;
  const doc = (await docsOf(orgId, 'business_registration'))[0]!;

  // A second owner joins, then the first owner leaves.
  const second = await createUser('e25-second-owner');
  await addMember(orgId, second.id, 'owner');
  await leave(orgId, rv.id);

  await reviewerGoto(page, rv, detail(claim.id), { login: false });
  await expectBlocked(page, rv, { claimId: claim.id, orgId, ct: 'business_registration' }, doc.id);

  // Another reviewer starts the review; the conflicted one still cannot decide.
  const other = await createReviewer('admin_review', 'clean');
  const ctx = await freshReviewerContext(browser, page);
  const op = await ctx.newPage();
  await reviewerGoto(op, other, detail(claim.id));
  await op.getByRole('button', { name: t('adminVer.startReview'), exact: true }).click();
  await expect(op.locator('main')).toContainText(t('claimStatus.in_review'));
  await ctx.close();

  await page.goto(detail(claim.id));
  await page.locator('#d-approve').check();
  await page.locator('#reason').fill('I used to own this business');
  await page.getByRole('button', { name: t('adminVer.saveDecision'), exact: true }).click();
  await expect(alertWith(page, t('errors.conflict_of_interest'))).toBeVisible();
  expect((await claimOf(orgId, 'business_registration'))!.status).toBe('in_review');
});

// B: a removed membership alone is enough.
test('E25 a reviewer who was once a member (membership removed) is permanently conflicted', async ({ page }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e25rm' });
  const doc = (await docsOf(sub.orgId, sub.ct))[0]!;
  const rv = await createReviewer('admin_review', 'former-member');
  await addMember(sub.orgId, rv.id, 'viewer');
  await leave(sub.orgId, rv.id);
  await reviewerGoto(page, rv, detail(sub.claimId));
  await expectBlocked(page, rv, sub, doc.id);
});

// C: having edited the profile is enough, even as a staff member who then left.
test('E25 a reviewer who edited the profile (as staff) and then left is permanently conflicted', async ({ page }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e25ed' });
  const doc = (await docsOf(sub.orgId, sub.ct))[0]!;
  const rv = await createReviewer('admin_review', 'editor');
  await addMember(sub.orgId, rv.id, 'staff');

  await reviewerGoto(page, rv, `${orgPath('en', sub.orgId, '/onboarding')}?step=1`);
  await page.locator('#business_name').fill(`${sub.orgName} edited`);
  await page.getByRole('button', { name: t('ob.later'), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${sub.orgId}/business$`));
  await leave(sub.orgId, rv.id);

  // The edit may have made the claim stale; resubmit it so there is something to review.
  const claim = await claimOf(sub.orgId, sub.ct);
  if (claim!.status === 'stale') {
    const ownerCtx = await page.context().browser()!.newContext({ baseURL: page.url().split('/').slice(0, 3).join('/') });
    const op = await ownerCtx.newPage();
    await loginUi(op, sub.owner);
    await submitClaimUi(op, 'en', sub.orgId, sub.ct, { file: null, resubmit: true });
    await ownerCtx.close();
  }
  await expectBlocked(page, rv, sub, doc.id);
});

// Control: an uninvolved reviewer is not affected.
test('E25 an uninvolved reviewer can still start a review', async ({ page }) => {
  const sub = await submittedBusiness(page, { prefix: 'e25ok' });
  const rv = await createReviewer('admin_review', 'uninvolved');
  await reviewerGoto(page, rv, detail(sub.claimId));
  await page.getByRole('button', { name: t('adminVer.startReview'), exact: true }).click();
  await expect(page.locator('main')).toContainText(t('claimStatus.in_review'));
});
