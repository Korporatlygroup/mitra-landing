import { expect, test, type Page } from '@playwright/test';
import { claimOf, createReviewer, docsOf, reviewerGoto, submittedBusiness } from './support/biz';
import { sql } from './support/db';
import { msg } from './support/i18n';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const detail = (id: string) => `/en/admin/verification/${id}`;
const alertWith = (page: Page, text: string) => page.locator('main [role=alert]').filter({ hasText: text });
const radio = { approve: '#d-approve', reject: '#d-reject', request_info: '#d-info' } as const;

async function save(page: Page, decision: keyof typeof radio, reason: string) {
  await page.locator(radio[decision]).check();
  await page.locator('#reason').fill(reason);
  await page.getByRole('button', { name: t('adminVer.saveDecision'), exact: true }).click();
}
async function startReview(page: Page) {
  await page.getByRole('button', { name: t('adminVer.startReview'), exact: true }).click();
  await expect(page.locator('main')).toContainText(t('claimStatus.in_review'));
}
/** Test setup: a clean document is flagged infected after submission (service_set_scan_result, as postgres). */
async function flagInfected(docId: string) {
  await sql(`select public.service_set_scan_result($1::uuid, 'infected'::public.scan_status, 'e2e-signature-update')`, [docId]);
}

// D: approving requires clean evidence. Reject and request-more-info stay possible.
test('E24 approve is refused when an attached document was flagged infected after submission; reject still works', async ({ page }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e24ev' });
  const doc = (await docsOf(sub.orgId, sub.ct))[0]!;
  const rv = await createReviewer('admin_review');

  await reviewerGoto(page, rv, detail(sub.claimId));
  await expect(page.locator('main')).not.toContainText(t('adminVer.evidenceWarning'));
  await startReview(page);

  await flagInfected(doc.id);
  await page.goto(detail(sub.claimId));
  await expect(alertWith(page, t('adminVer.evidenceWarning'))).toBeVisible();
  await expect(page.locator('main')).toContainText(t('documents.scanInfected'));
  await expect(page.getByRole('link', { name: t('adminVer.download') })).toHaveCount(0);
  expect((await page.request.get(`/api/v1/documents/${doc.id}`)).status()).toBe(404);

  await save(page, 'approve', 'Looks fine to me');
  await expect(alertWith(page, t('errors.evidence_not_clean'))).toBeVisible();
  expect(await claimOf(sub.orgId, sub.ct)).toMatchObject({ status: 'in_review' });

  // Rejecting is still possible, with a reason.
  await save(page, 'reject', 'The attached file is unsafe');
  await expect(page.locator('#reason')).toHaveCount(0);
  expect(await claimOf(sub.orgId, sub.ct)).toMatchObject({ status: 'rejected', decision_reason: 'The attached file is unsafe' });
});

test('E24 request-more-information still works when evidence is not clean', async ({ page }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e24ev2' });
  const doc = (await docsOf(sub.orgId, sub.ct))[0]!;
  const rv = await createReviewer('admin_review');
  await reviewerGoto(page, rv, detail(sub.claimId));
  await startReview(page);
  await flagInfected(doc.id);
  await page.goto(detail(sub.claimId));
  await expect(alertWith(page, t('adminVer.evidenceWarning'))).toBeVisible();
  await save(page, 'request_info', 'Please send a clean copy');
  await expect(page.locator('#reason')).toHaveCount(0);
  expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('needs_info');
});

test('E24 the RPC refuses approval with unclean evidence too (no UI)', async ({ page }) => {
  test.setTimeout(240_000);
  const { aal2Token } = await import('./support/biz');
  const { rpcFromPage } = await import('./support/db');
  const sub = await submittedBusiness(page, { prefix: 'e24ev3' });
  const doc = (await docsOf(sub.orgId, sub.ct))[0]!;
  const rv = await createReviewer('admin_review');
  await reviewerGoto(page, rv, detail(sub.claimId));
  await startReview(page);
  await flagInfected(doc.id);
  const token = await aal2Token(rv);
  const r = await rpcFromPage(page, token, 'decide_claim', { p_claim: sub.claimId, p_decision: 'approve', p_reason: 'approve anyway', p_expected_version: 1 });
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(r.body?.message).toBe('evidence_not_clean');
  expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('in_review');
});

test('E24 a suspended organisation cannot be reviewed (org_not_active)', async ({ page }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e24susp' });
  const rv = await createReviewer('admin_review');
  await reviewerGoto(page, rv, detail(sub.claimId));
  await startReview(page);

  // Test setup: the organisation is suspended while the review is open.
  await sql(`update public.organisations set status = 'suspended' where id = $1`, [sub.orgId]);
  try {
    await page.goto(detail(sub.claimId));
    await save(page, 'approve', 'Approving a suspended shop');
    await expect(alertWith(page, t('errors.org_not_active'))).toBeVisible();
    expect(await claimOf(sub.orgId, sub.ct)).toMatchObject({ status: 'in_review' });
  } finally {
    await sql(`update public.organisations set status = 'active' where id = $1`, [sub.orgId]);
  }

  // A second, never-started claim: starting a review of a suspended org is refused too.
  const other = await submittedBusiness(page, { prefix: 'e24susp2' });
  await sql(`update public.organisations set status = 'suspended' where id = $1`, [other.orgId]);
  try {
    await reviewerGoto(page, rv, detail(other.claimId));
    await page.getByRole('button', { name: t('adminVer.startReview'), exact: true }).click();
    await expect(alertWith(page, t('errors.org_not_active'))).toBeVisible();
    expect((await claimOf(other.orgId, other.ct))!.status).toBe('submitted');
  } finally {
    await sql(`update public.organisations set status = 'active' where id = $1`, [other.orgId]);
  }
});
