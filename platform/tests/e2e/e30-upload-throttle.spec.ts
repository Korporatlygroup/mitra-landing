import { expect, test, type Browser, type Page } from '@playwright/test';
import { addMember, createBusinessOwner, docsOf, freshReviewerContext, gotoStep, onboardUi, smallPdf, uploadDoc, type UploadFile } from './support/biz';
import { createUser, sql } from './support/db';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

const t = (k: string) => msg('en', k);
const CT = 'business_registration' as const;
const junk = (i: number): UploadFile => ({ name: `note-${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`not a document ${i}`) });

async function session(browser: Browser, like: Page, user: { email: string; password: string }, orgId: string, onboard = false) {
  const ctx = await freshReviewerContext(browser, like);
  const p = await ctx.newPage();
  await loginUi(p, user);
  if (onboard) await onboardUi(p, 'en', orgId);
  await gotoStep(p, 'en', orgId, 5);
  return { ctx, p };
}

// Uploads are throttled per user (30 per hour) and per organisation (120 per hour). Rejected uploads count.
test('E30 the 31st upload by one user in an hour is throttled, stores nothing, and others are unaffected', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { owner, orgId } = await createBusinessOwner('e30u');
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);
  await gotoStep(page, 'en', orgId, 5);

  // 30 rejected uploads (they count) get the normal rejection message, never the throttle.
  for (let i = 1; i <= 30; i++) {
    const slot = await uploadDoc(page, 'en', CT, junk(i));
    await expect(slot, `upload ${i}`).toContainText(t('errors.file_type_not_allowed'));
  }
  expect(await docsOf(orgId, CT)).toHaveLength(0);

  // The 31st, even a perfectly good PDF, is refused with the throttle message and nothing is stored.
  await expect(await uploadDoc(page, 'en', CT, smallPdf('over-the-limit'))).toContainText(t('errors.rate_limited'));
  await expect(await uploadDoc(page, 'en', CT, smallPdf('still-over'))).toContainText(t('errors.rate_limited'));
  expect(await docsOf(orgId, CT)).toHaveLength(0);
  const stored = await sql(`select count(*)::int as n from storage.objects where name like $1`, [`${orgId}/%`]);
  expect(Number(stored[0]!.n)).toBe(0);

  // Another user in the same organisation (own quota) can still upload.
  const manager = await createUser('e30-manager');
  await addMember(orgId, manager.id, 'manager');
  const m = await session(browser, page, manager, orgId);
  await expect(await uploadDoc(m.p, 'en', CT, smallPdf('manager-ok'))).toContainText(t('documents.received'));
  await m.ctx.close();

  // Another user in another organisation is unaffected.
  const other = await createBusinessOwner('e30o');
  const o = await session(browser, page, other.owner, other.orgId, true);
  await expect(await uploadDoc(o.p, 'en', CT, smallPdf('other-org-ok'))).toContainText(t('documents.received'));
  await o.ctx.close();
});

test('E30 the organisation limit (120 per hour) throttles every member of that organisation but no other organisation', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { owner, orgId } = await createBusinessOwner('e30g');
  const manager = await createUser('e30g-manager');
  await addMember(orgId, manager.id, 'manager');
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);

  // Test setup: the organisation has already used its 120 uploads this hour (rows in the throttle table).
  await sql(`insert into public.rate_limit_events (key) select 'upload:o:' || $1 from generate_series(1, 120)`, [orgId]);

  await gotoStep(page, 'en', orgId, 5);
  await expect(await uploadDoc(page, 'en', CT, smallPdf('org-over'))).toContainText(t('errors.rate_limited'));
  expect(await docsOf(orgId, CT)).toHaveLength(0);

  const m = await session(browser, page, manager, orgId);
  await expect(await uploadDoc(m.p, 'en', CT, smallPdf('manager-org-over'))).toContainText(t('errors.rate_limited'));
  expect(await docsOf(orgId, CT)).toHaveLength(0);
  await m.ctx.close();

  // A different organisation (different user) is fine.
  const other = await createBusinessOwner('e30h');
  const o = await session(browser, page, other.owner, other.orgId, true);
  await expect(await uploadDoc(o.p, 'en', CT, smallPdf('elsewhere-ok'))).toContainText(t('documents.received'));
  await o.ctx.close();
});
