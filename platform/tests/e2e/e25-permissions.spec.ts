import { expect, test, type Page } from '@playwright/test';
import { aal2Token, claimOf, createReviewer, docsOf, onboardUi, orgPath, reviewerGoto, submittedBusiness } from './support/biz';
import { addMember, createOrgAs, createUser, roleOf, rpcFromPage, signedClient, sql, uniq } from './support/db';
import { msg } from './support/i18n';
import { freshContext, loginUi } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const alertWith = (page: Page, text: string) => page.locator('main [role=alert]').filter({ hasText: text });

// E25: permissions and isolation around the verification pages, the review actions and document downloads.
test('E25 admin_ops: the database gives it no review permission, so it cannot see or decide anything', async ({ page }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e25ops' });
  const ops = await createReviewer('admin_ops');
  await reviewerGoto(page, ops, '/en/admin/verification');

  // OBSERVATION: the brief expected admin_ops to see the queue read-only, but role_permissions gives admin_ops no
  // verification:review, so the page answers "no access" and shows no data.
  await expect(alertWith(page, t('adminVer.noAccess'))).toBeVisible();
  await expect(page.locator('main table')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(sub.orgName);
  await page.goto(`/en/admin/verification/${sub.claimId}`);
  await expect(page.locator('main')).not.toContainText(sub.orgName);
  await expect(page.locator('#reason')).toHaveCount(0);

  // Direct calls with its own aal2 token are refused and change nothing.
  const token = await aal2Token(ops);
  const start = await rpcFromPage(page, token, 'start_review', { p_claim: sub.claimId });
  expect(start.status).toBeGreaterThanOrEqual(400);
  const decide = await rpcFromPage(page, token, 'decide_claim', { p_claim: sub.claimId, p_decision: 'approve', p_reason: 'sneaky approval', p_expected_version: 1 });
  expect(decide.status).toBeGreaterThanOrEqual(400);
  expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('submitted');
});

test('E25 a role that may review but not decide sees the read-only message and no decision form', async ({ page }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e25ro' });
  const ops = await createReviewer('admin_ops');
  // Test setup only: temporarily give admin_ops the review (look-only) permission; removed in finally.
  await sql(`insert into public.role_permissions (role, permission) values ('admin_ops', 'verification:review') on conflict do nothing`);
  try {
    await reviewerGoto(page, ops, '/en/admin/verification');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('adminVer.title'));
    await expect(page.locator('tbody tr').filter({ hasText: sub.orgName })).toBeVisible();
    await page.goto(`/en/admin/verification/${sub.claimId}`);
    await expect(page.locator('main')).toContainText(t('adminVer.readOnly'));
    await expect(page.locator('#reason')).toHaveCount(0);
    await expect(page.locator('#d-approve')).toHaveCount(0);

    const token = await aal2Token(ops);
    const decide = await rpcFromPage(page, token, 'decide_claim', { p_claim: sub.claimId, p_decision: 'approve', p_reason: 'sneaky approval', p_expected_version: 1 });
    expect(decide.status).toBeGreaterThanOrEqual(400);
    expect((await claimOf(sub.orgId, sub.ct))!.status).not.toBe('approved');
  } finally {
    await sql(`delete from public.role_permissions where role = 'admin_ops' and permission = 'verification:review'`);
  }
});

test('E25 a reviewer who belongs to the business cannot start a review, decide or download (conflict_of_interest)', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e25coi' });
  const docId = (await docsOf(sub.orgId, sub.ct))[0]!.id;
  const rc = await createReviewer('admin_review', 'conflicted');
  await addMember(sub.orgId, rc.id, 'staff'); // test setup: the reviewer is also a member of the business

  await reviewerGoto(page, rc, `/en/admin/verification/${sub.claimId}`);
  await page.getByRole('button', { name: t('adminVer.startReview'), exact: true }).click();
  await expect(alertWith(page, t('errors.conflict_of_interest'))).toBeVisible();
  expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('submitted');

  // Another reviewer starts it; the conflicted one now sees the decision form but cannot use it.
  const other = await createReviewer('admin_review', 'clean');
  const ctx = await freshContext(browser, page);
  const op = await ctx.newPage();
  await reviewerGoto(op, other, `/en/admin/verification/${sub.claimId}`);
  await op.getByRole('button', { name: t('adminVer.startReview'), exact: true }).click();
  await expect(op.locator('main')).toContainText(t('claimStatus.in_review'));
  await ctx.close();

  await page.goto(`/en/admin/verification/${sub.claimId}`);
  await page.locator('#d-approve').check();
  await page.locator('#reason').fill('I am allowed to approve my own shop');
  await page.getByRole('button', { name: t('adminVer.saveDecision'), exact: true }).click();
  await expect(alertWith(page, t('errors.conflict_of_interest'))).toBeVisible();
  expect((await claimOf(sub.orgId, sub.ct))!.status).toBe('in_review');

  // And the documents stay closed to them (404, no bytes).
  const dl = await page.request.get(`/api/v1/documents/${docId}`);
  expect(dl.status()).toBe(404);
  const token = await aal2Token(rc);
  expect((await rpcFromPage(page, token, 'get_document_access', { p_doc: docId })).status).toBeGreaterThanOrEqual(400);
});

test('E25 business staff can edit the profile but not see verification; a viewer cannot edit', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e25st' });
  const docId = (await docsOf(sub.orgId, sub.ct))[0]!.id;
  const staff = await createUser('e25-staff');
  const viewer = await createUser('e25-viewer');
  await addMember(sub.orgId, staff.id, 'staff');
  await addMember(sub.orgId, viewer.id, 'viewer');

  // Staff
  const sctx = await freshContext(browser, page);
  const sp = await sctx.newPage();
  await loginUi(sp, staff);
  await sp.goto(orgPath('en', sub.orgId));
  await expect(sp.locator('main')).toContainText(t('biz.staffNoVerification'));
  await expect(sp.getByRole('link', { name: t('biz.openVerification') })).toHaveCount(0);
  await sp.goto(orgPath('en', sub.orgId, '/verification'));
  await expect(sp.locator('main')).toContainText(t('biz.staffNoVerification'));
  await expect(sp.locator('article')).toHaveCount(0);
  expect((await sp.request.get(`/api/v1/documents/${docId}`)).status()).toBe(404);

  await sp.goto(`${orgPath('en', sub.orgId, '/onboarding')}?step=1`);
  const newName = `Renamed ${uniq('s')}`;
  await sp.locator('#business_name').fill(newName);
  await sp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(sp).toHaveURL(/step=2$/);
  expect((await sql(`select business_name from public.business_profiles where org_id = $1`, [sub.orgId]))[0]!.business_name).toBe(newName);
  // Staff cannot send for review: no controls on step 5, and the RPC refuses.
  await sp.goto(`${orgPath('en', sub.orgId, '/onboarding')}?step=5`);
  await expect(sp.getByRole('button', { name: t('ob.s5.submit'), exact: true })).toHaveCount(0);
  await expect(sp.getByRole('button', { name: t('ob.s5.upload'), exact: true })).toHaveCount(0);
  const stok = (await signedClient(staff)).accessToken;
  const sub1 = await rpcFromPage(sp, stok, 'submit_claim', { p_org: sub.orgId, p_type: 'business_location', p_document_ids: [], p_note: null });
  expect(sub1.status).toBeGreaterThanOrEqual(400);
  await sctx.close();

  // Viewer
  const vctx = await freshContext(browser, page);
  const vp = await vctx.newPage();
  await loginUi(vp, viewer);
  await vp.goto(`${orgPath('en', sub.orgId, '/onboarding')}?step=1`);
  await expect(vp.locator('#business_name')).toHaveCount(0);
  await expect(vp.locator('main')).toContainText(t('errors.forbidden'));
  await vp.goto(orgPath('en', sub.orgId, '/verification'));
  await expect(vp.locator('main')).toContainText(t('biz.staffNoVerification'));
  expect((await vp.request.get(`/api/v1/documents/${docId}`)).status()).toBe(404);
  const vtok = (await signedClient(viewer)).accessToken;
  const save = await rpcFromPage(vp, vtok, 'save_business_profile', { p_org: sub.orgId, p_data: { business_name: 'Viewer wrote this' } });
  expect(save.status).toBeGreaterThanOrEqual(400);
  expect((await sql(`select business_name from public.business_profiles where org_id = $1`, [sub.orgId]))[0]!.business_name).toBe(newName);
  expect(await roleOf(sub.orgId, viewer.id)).toBe('viewer');
  await vctx.close();
});

test('E25 another organisation cannot open this business or its documents; anonymous callers get 404', async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e25x' });
  const docId = (await docsOf(sub.orgId, sub.ct))[0]!.id;
  const rival = await createUser('e25-rival');
  const rivalOrg = await createOrgAs(rival, 'business', `Rival ${uniq('r')}`);

  const ctx = await freshContext(browser, page);
  const rp = await ctx.newPage();
  await loginUi(rp, rival);
  for (const path of [orgPath('en', sub.orgId), orgPath('en', sub.orgId, '/verification'), orgPath('en', sub.orgId, '/preview'), `${orgPath('en', sub.orgId, '/onboarding')}?step=1`]) {
    const res = await rp.goto(path);
    expect(res!.status(), path).toBe(404);
    await expect(rp.getByRole('heading', { level: 1 })).toHaveText(t('notFound.title'));
    await expect(rp.locator('body')).not.toContainText(sub.orgName);
  }
  expect((await rp.request.get(`/api/v1/documents/${docId}`)).status()).toBe(404);

  // Their own business still works and does not list the other org's data.
  await onboardUi(rp, 'en', rivalOrg);
  await rp.goto(orgPath('en', rivalOrg, '/verification'));
  await expect(rp.locator('body')).not.toContainText(sub.orgName);

  const tok = (await signedClient(rival)).accessToken;
  expect((await rpcFromPage(rp, tok, 'get_document_access', { p_doc: docId })).status).toBeGreaterThanOrEqual(400);
  const claims = await rp.evaluate(async ({ url, key, token, org }) => {
    const r = await fetch(`${url}/rest/v1/verification_claims?org_id=eq.${org}&select=id`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
    return r.json();
  }, { url: process.env.TEST_API_URL ?? 'http://127.0.0.1:54421', key: (await import('./support/env')).PUBLISHABLE_KEY, token: tok, org: sub.orgId });
  expect(claims).toEqual([]);
  await ctx.close();

  // Anonymous.
  expect((await request.get(`/api/v1/documents/${docId}`)).status()).toBe(404);
  expect((await request.get('/api/v1/documents/not-a-uuid')).status()).toBe(404);
  const anon = await freshContext(browser, page);
  const ap = await anon.newPage();
  await ap.goto(orgPath('en', sub.orgId));
  await expect(ap).toHaveURL(/\/en\/login\?next=/);
  await ap.goto('/en/admin/verification');
  await expect(ap).toHaveURL(/\/en\/login\?next=/);
  await ap.goto('/en/notifications');
  await expect(ap).toHaveURL(/\/en\/login\?next=/);
  await anon.close();
});

test('E25 a business owner never gets the reviewer pages', async ({ page }) => {
  const sub = await submittedBusiness(page, { prefix: 'e25own' });
  await page.goto('/en/admin/verification');
  await expect(alertWith(page, t('adminVer.noAccess'))).toBeVisible();
  await expect(page.locator('main table')).toHaveCount(0);
  await page.goto(`/en/admin/verification/${sub.claimId}`);
  await expect(page.locator('main')).not.toContainText(t('adminVer.snapshotTitle'));
  await expect(page.locator('#reason')).toHaveCount(0);
});
