import { expect, test, type Page } from '@playwright/test';
import { smallPdf } from './support/biz';
import { EICAR, scanner } from './support/clamd-stub';
import { addMember, createUser, sql } from './support/db';
import { msg } from './support/i18n';
import { checkPage, createPartner, createReviewer, loginPartner, partnerPath, reviewSupplier, seedSupplier, seedSupplierDocument, supplierRow } from './support/p5';
import type { Locale } from './support/ui';

// E50: the partner's supplier screens. Setup goes through the real RPCs; everything the partner does goes through the real UI; every claim is
// checked in the database too (persisted state), and every main screen is checked with axe and for sideways scrolling at 360 and 1280 px.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const main = (page: Page) => page.locator('main');

async function uploadEvidence(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await main(page).locator('.uploader input[type=file]').setInputFiles(file);
  await main(page).locator('.uploader').getByRole('button', { name: t('p5partner.docs.upload'), exact: true }).click();
}

test('E50 supplier wizard: four steps, drafts, evidence upload with scan status, remove, submit', async ({ page }) => {
  test.setTimeout(240_000);
  const p = await createPartner('e50a');
  await loginPartner(page, p, 'en', '/suppliers');

  // empty state, then the wizard
  await expect(main(page).getByRole('heading', { name: t('p5partner.suppliers.emptyTitle') })).toBeVisible();
  await checkPage(page, 'suppliers (empty)');
  await main(page).getByRole('link', { name: t('p5common.buttons.addSupplier'), exact: true }).first().click();
  await expect(page).toHaveURL(/\/suppliers\/new$/);
  await expect(main(page).getByText(t('p5partner.common.stepOf', { n: '1', total: '4' }))).toBeVisible();
  await checkPage(page, 'wizard step 1');

  // step 1: a too-short name is refused with an announced message and the typed values stay
  await page.locator('#name').fill('A');
  await page.locator('#state_city').fill('Chennai');
  await page.locator('#main_category').selectOption('textiles-apparel');
  await main(page).getByRole('button', { name: t('p5partner.supplierForm.saveContinue'), exact: true }).click();
  await expect(main(page).getByRole('alert').filter({ hasText: t('errors.invalid_name') })).toBeVisible();
  await expect(page.locator('#state_city')).toHaveValue('Chennai');
  expect(await sql(`select 1 from public.suppliers where partner_org_id = $1`, [p.orgId])).toHaveLength(0);

  await page.locator('#name').fill('Kumar Textiles');
  await main(page).getByRole('button', { name: t('p5partner.supplierForm.saveContinue'), exact: true }).click();
  await expect(page).toHaveURL(/\/suppliers\/[0-9a-f-]{36}\/edit\?step=2$/);
  const sid = page.url().match(/suppliers\/([0-9a-f-]{36})\/edit/)![1]!;
  let row = await supplierRow(sid);
  expect(row.status).toBe('draft');
  expect(row.draft.name).toBe('Kumar Textiles');

  // step 2: short description refused; Save Draft stays on the step
  await page.locator('#description').fill('Too short');
  await main(page).getByRole('button', { name: t('p5partner.supplierForm.saveContinue'), exact: true }).click();
  await expect(main(page).getByRole('alert').filter({ hasText: t('errors.invalid_description') })).toBeVisible();
  await page.locator('#description').fill('We weave cotton sarees and cloth for export, on our own looms in Tamil Nadu.');
  await page.locator('#capabilities').fill('Cotton sarees\nBlock printing');
  await main(page).getByRole('button', { name: t('p5common.buttons.saveDraft'), exact: true }).click();
  await expect(main(page).getByRole('status').filter({ hasText: t('p5partner.supplierForm.saved') })).toBeVisible();
  row = await supplierRow(sid);
  expect(row.draft.capabilities).toEqual(['Cotton sarees', 'Block printing']);
  await checkPage(page, 'wizard step 2');
  await main(page).getByRole('button', { name: t('p5partner.supplierForm.saveContinue'), exact: true }).click();
  await expect(page).toHaveURL(/step=3$/);

  // step 3: contact is private; the evidence part says an upload is not a check
  await expect(main(page).getByText(t('p5partner.supplierForm.s3.privacy'))).toBeVisible();
  await expect(main(page).getByText(t('p5partner.docs.notVerification'))).toBeVisible();
  await checkPage(page, 'wizard step 3');

  // a clean PDF: scanned, stored, listed with its scan status
  await uploadEvidence(page, smallPdf('e50-reg'));
  await expect(main(page).getByRole('status').filter({ hasText: t('p5partner.docs.uploadedClean') })).toBeVisible();
  await expect(main(page).locator('[data-testid=supplier-doc]')).toHaveCount(1);
  await expect(main(page).locator('[data-testid=supplier-doc]').getByText(t('p5common.status.scan.clean'))).toBeVisible();
  let docs = await sql<{ scan_status: string; removed_at: string | null }>(`select scan_status, removed_at from public.supplier_documents where supplier_id = $1`, [sid]);
  expect(docs.map((d) => d.scan_status)).toEqual(['clean']);

  // an infected file is refused and nothing is stored
  await uploadEvidence(page, { name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(EICAR, 'latin1'), Buffer.from('\n%%EOF\n')]) });
  await expect(main(page).locator('.uploader').getByRole('alert')).toBeVisible();
  docs = await sql(`select scan_status, removed_at from public.supplier_documents where supplier_id = $1`, [sid]);
  expect(docs).toHaveLength(1);

  // scanner down: kept as "waiting", never served, and can be removed again
  await scanner.down();
  try {
    await uploadEvidence(page, smallPdf('e50-pending'));
    await expect(main(page).getByRole('status').filter({ hasText: t('p5partner.docs.uploadedPending') })).toBeVisible();
  } finally {
    await scanner.up();
  }
  await expect(main(page).locator('[data-testid=supplier-doc]')).toHaveCount(2);
  const pending = main(page).locator('[data-testid=supplier-doc]').filter({ hasText: t('p5common.status.scan.pending') });
  await expect(pending).toHaveCount(1);
  expect(await pending.getByRole('link').count()).toBe(0);
  await pending.getByRole('button', { name: t('p5partner.docs.remove'), exact: true }).click();
  await expect(main(page).locator('[data-testid=supplier-doc]')).toHaveCount(1);
  docs = await sql(`select scan_status, removed_at from public.supplier_documents where supplier_id = $1 order by created_at`, [sid]);
  expect(docs.filter((d) => d.removed_at === null)).toHaveLength(1);

  // contact details (private), "not sure" about the registration number
  await page.locator('#contact_name').fill('Ravi Kumar');
  await page.locator('#contact_email').fill('ravi@example.test');
  await page.locator('#registration_not_sure').check();
  await main(page).getByRole('button', { name: t('p5partner.supplierForm.saveContinue'), exact: true }).click();
  await expect(page).toHaveURL(/step=4$/);
  const priv = await sql<{ contact_name: string; contact_email: string; registration_id: string | null }>(`select contact_name, contact_email, registration_id from public.supplier_private where supplier_id = $1`, [sid]);
  expect(priv[0]).toMatchObject({ contact_name: 'Ravi Kumar', contact_email: 'ravi@example.test' });
  expect(priv[0]!.registration_id ?? '').toBe('');

  // step 4: nothing missing, send for review
  await expect(main(page).getByText(t('p5partner.supplierForm.s4.missingTitle'))).toHaveCount(0);
  await checkPage(page, 'wizard step 4');
  await main(page).getByRole('button', { name: t('p5common.buttons.submitForReview'), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/suppliers/${sid}\\?sent=1$`));
  await expect(main(page).getByTestId('sent-banner')).toBeVisible();
  await expect(main(page).getByText(t('p5common.status.supplier.awaiting_review'), { exact: true }).first()).toBeVisible();
  await expect(main(page).getByTestId('supplier-events').getByText(t('p5partner.suppliers.events.submitted'))).toBeVisible();
  expect((await supplierRow(sid)).status).toBe('awaiting_review');
  // contact details are shown to the partner, labelled private
  await expect(main(page).getByText(t('p5partner.suppliers.privateNote'))).toBeVisible();
  await expect(main(page).getByText('ravi@example.test')).toBeVisible();
  await checkPage(page, 'supplier detail (awaiting review)');

  // while it is being reviewed it cannot be edited; the partner can take it back
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${sid}/edit?step=1`));
  await expect(main(page).getByTestId('not-editable')).toBeVisible();
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${sid}`));
  await main(page).getByRole('button', { name: t('p5partner.suppliers.withdraw'), exact: true }).click();
  await expect(main(page).getByTestId('withdrawn-banner')).toBeVisible();
  await expect.poll(async () => (await supplierRow(sid)).status).toBe('draft');
});

test('E50 more-information loop, rejection, and edit after approval (the approved version stays live)', async ({ page }) => {
  test.setTimeout(240_000);
  const p = await createPartner('e50b');
  const reviewer = await createReviewer('e50b-rev');
  const s1 = await seedSupplier(p, reviewer, { name: 'Loop Supplier', approve: false });
  await loginPartner(page, p, 'en', `/suppliers/${s1.id}`);
  await expect(main(page).getByText(t('p5common.status.supplier.awaiting_review'), { exact: true }).first()).toBeVisible();

  // MITRA asks for more information
  await reviewSupplier(reviewer, s1.id, 'request_info', 'Please add a tax paper and the factory address.');
  await page.goto(partnerPath('en', p.orgId, '/suppliers'));
  await expect(main(page).locator('[data-testid=supplier-row]').getByText(t('p5common.status.supplier.more_info_needed'))).toBeVisible();
  await expect(main(page).getByText(t('p5partner.suppliers.needsAttention'))).toBeVisible();
  await checkPage(page, 'suppliers list (needs attention)');
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${s1.id}`));
  await expect(main(page).getByTestId('admin-reason')).toContainText('Please add a tax paper and the factory address.');
  await expect(main(page).getByTestId('admin-reason')).toContainText(t('p5partner.suppliers.reasonInfo'));
  await expect(main(page).getByTestId('supplier-events').getByText(t('p5partner.suppliers.events.more_info_requested'))).toBeVisible();
  await checkPage(page, 'supplier detail (more information)');

  // correct and send again (a new document is registered first, as an upload would)
  await seedSupplierDocument(p, s1.id);
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${s1.id}/edit?step=2`));
  await page.locator('#description').fill('We weave cotton sarees and cloth for export. Factory address: 12 Mill Road, Chennai.');
  await main(page).getByRole('button', { name: t('p5partner.supplierForm.saveContinue'), exact: true }).click();
  await expect(page).toHaveURL(/step=3$/);
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${s1.id}/edit?step=4`));
  await main(page).getByRole('button', { name: t('p5common.buttons.submitForReview'), exact: true }).click();
  await expect(page).toHaveURL(/sent=1$/);
  expect((await supplierRow(s1.id)).status).toBe('awaiting_review');
  await expect(main(page).getByTestId('supplier-events').getByText(t('p5partner.suppliers.events.submitted')).first()).toBeVisible();

  // rejected: the reason is shown, and it can be fixed and sent again
  await reviewSupplier(reviewer, s1.id, 'reject', 'The documents do not match the address you gave.');
  await page.reload();
  await expect(main(page).getByText(t('p5common.status.supplier.rejected'), { exact: true }).first()).toBeVisible();
  await expect(main(page).getByTestId('admin-reason')).toContainText('The documents do not match the address you gave.');
  await expect(main(page).getByTestId('admin-reason')).toContainText(t('p5partner.suppliers.reasonRejected'));
  await expect(main(page).getByRole('link', { name: t('p5partner.suppliers.edit'), exact: true })).toBeVisible();

  // an approved supplier: edit keeps the approved version live while the change is reviewed
  const s2 = await seedSupplier(p, reviewer, { name: 'Live Supplier' });
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${s2.id}`));
  await expect(main(page).getByText(t('p5common.status.supplier.approved'), { exact: true }).first()).toBeVisible();
  await expect(main(page).getByText(/INOK reviewed documents for this supplier on/)).toBeVisible();
  await expect(main(page).getByText(t('p5partner.suppliers.liveStaysNote'))).toBeVisible();
  await checkPage(page, 'supplier detail (approved)');
  await main(page).getByRole('link', { name: t('p5partner.suppliers.editApproved'), exact: true }).click();
  await page.locator('#name').fill('Live Supplier Renamed');
  await main(page).getByRole('button', { name: t('p5common.buttons.saveDraft'), exact: true }).click();
  await expect(main(page).getByRole('status').filter({ hasText: t('p5partner.supplierForm.saved') })).toBeVisible();
  let live = (await sql<{ status: string; live_name: string; draft_name: string }>(`select status, live_name, draft ->> 'name' as draft_name from public.suppliers where id = $1`, [s2.id]))[0]!;
  expect(live).toMatchObject({ status: 'approved', live_name: 'Live Supplier', draft_name: 'Live Supplier Renamed' });
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${s2.id}/edit?step=4`));
  await expect(main(page).getByText(t('p5partner.supplierForm.s4.approvedNote'))).toBeVisible();
  await main(page).getByRole('button', { name: t('p5partner.supplierForm.s4.submitChanges'), exact: true }).click();
  await expect(page).toHaveURL(/sent=1$/);
  await expect(main(page).getByText(t('p5partner.suppliers.revisionInReview'))).toBeVisible();
  live = (await sql(`select status, live_name, draft ->> 'name' as draft_name from public.suppliers where id = $1`, [s2.id]))[0]!;
  expect(live).toMatchObject({ status: 'approved', live_name: 'Live Supplier' });
  expect((await supplierRow(s2.id)).draft_submitted_version).not.toBeNull();

  // MITRA refuses the revision: still approved and live, with the reason shown
  await reviewSupplier(reviewer, s2.id, 'reject', 'The new name does not match the registration document.');
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${s2.id}`));
  await expect(main(page).getByText(t('p5common.status.supplier.approved'), { exact: true }).first()).toBeVisible();
  await expect(main(page).getByTestId('admin-reason')).toContainText('The new name does not match the registration document.');
  live = (await sql(`select status, live_name, draft ->> 'name' as draft_name from public.suppliers where id = $1`, [s2.id]))[0]!;
  expect(live).toMatchObject({ status: 'approved', live_name: 'Live Supplier' });
});

test('E50 a waiting or paused partner sees a clear status page, and a viewer can only look', async ({ page }) => {
  const pending = await createPartner('e50c', { status: 'pending' });
  await loginPartner(page, pending, 'en');
  await expect(main(page).getByRole('heading', { name: t('p5partner.gate.pendingTitle') })).toBeVisible();
  await expect(main(page).getByText(t('p5partner.gate.pendingBody'))).toBeVisible();
  await checkPage(page, 'partner waiting for approval');
  await page.goto(partnerPath('en', pending.orgId, '/suppliers/new'));
  await expect(main(page).getByTestId('partner-gate')).toBeVisible();
  await page.goto(partnerPath('en', pending.orgId, '/settings'));
  await expect(main(page).getByRole('heading', { name: t('p5partner.settings.title') })).toBeVisible();
  await checkPage(page, 'partner settings');

});

test('E50 a paused partner sees why and what to do', async ({ page }) => {
  const paused = await createPartner('e50d', { status: 'suspended' });
  await sql(`update public.partner_profiles set decision_reason = $2 where org_id = $1`, [paused.orgId, 'Documents are being checked again.']);
  await loginPartner(page, paused, 'en');
  await expect(main(page).getByRole('heading', { name: t('p5partner.gate.suspendedTitle') })).toBeVisible();
  await expect(main(page).getByText('Documents are being checked again.')).toBeVisible();
  await checkPage(page, 'partner paused');
});

test('E50 viewer role: suppliers are readable but cannot be added or changed', async ({ page }) => {
  const owner = await createPartner('e50e');
  const reviewer = await createReviewer('e50e-rev');
  const s = await seedSupplier(owner, reviewer, { name: 'Viewer Supplier' });
  const viewer = await createUser('e50e-view');
  await addMember(owner.orgId, viewer.id, 'viewer');
  const p = { ...owner, manager: viewer };
  await loginPartner(page, p, 'en', '/suppliers');
  await expect(main(page).getByText('Viewer Supplier')).toBeVisible();
  await expect(main(page).getByRole('link', { name: t('p5common.buttons.addSupplier'), exact: true })).toHaveCount(0);
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${s.id}`));
  await expect(main(page).getByRole('link', { name: t('p5partner.suppliers.editApproved'), exact: true })).toHaveCount(0);
  await page.goto(partnerPath('en', p.orgId, `/suppliers/${s.id}/edit?step=1`));
  await expect(main(page).getByTestId('not-editable')).toBeVisible();
});

for (const locale of ['ta', 'ms'] as Locale[]) {
  test(`E50 ${locale}: main supplier screens are in the language and pass axe`, async ({ page }) => {
    test.setTimeout(180_000);
    const p = await createPartner(`e50${locale}`, { language: locale });
    const reviewer = await createReviewer(`e50${locale}-rev`);
    const s = await seedSupplier(p, reviewer, { name: `Language Supplier ${locale}` });
    const T = (k: string, v?: Record<string, string>) => msg(locale, k, v);
    await loginPartner(page, p, locale);
    await expect(main(page).getByRole('heading', { level: 1 })).toContainText(p.name);
    await expect(main(page).getByRole('link', { name: T('p5common.buttons.addSupplier'), exact: true })).toBeVisible();
    await checkPage(page, `home ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, '/suppliers'));
    await expect(main(page).getByRole('heading', { name: T('p5partner.suppliers.title'), level: 1 })).toBeVisible();
    await expect(main(page).getByText(T('p5common.status.supplier.approved'), { exact: true }).first()).toBeVisible();
    await checkPage(page, `suppliers ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, `/suppliers/${s.id}`));
    await expect(main(page).getByRole('heading', { name: T('p5partner.suppliers.detailsTitle') })).toBeVisible();
    await checkPage(page, `supplier detail ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, `/suppliers/${s.id}/edit?step=3`));
    await expect(main(page).getByText(T('p5partner.supplierForm.s3.privacy'))).toBeVisible();
    await checkPage(page, `wizard step 3 ${locale}`);
    await page.goto(partnerPath(locale, p.orgId, '/suppliers/new'));
    await expect(main(page).getByText(T('p5partner.common.stepOf', { n: '1', total: '4' }))).toBeVisible();
    await checkPage(page, `wizard step 1 ${locale}`);
  });
}
