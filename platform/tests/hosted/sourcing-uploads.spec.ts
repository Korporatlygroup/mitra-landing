import { expect, test, type Page } from '@playwright/test';
import { msg } from '../e2e/support/i18n';
import { account, gotoWithMfa, guardStaging, lit, loginUi, remoteRows, remoteSql, run, type Account } from './support';

// Hosted staging: supplier sourcing (RFQ) journey, document uploads with NO scanner connected (everything must stay quarantined),
// and cross-tenant authorization on the same data. Real Worker, real staging database, disposable accounts.
test.describe.configure({ mode: 'serial' });
test.beforeAll(guardStaging);

const t = (key: string) => msg('en', key);
const future = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const pdf = (tag: string) => ({
  name: `${tag}.pdf`,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${tag} ${run}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1'),
});

async function partner(tag: string): Promise<{ acc: Account; org: string }> {
  const acc = await account(tag, true);
  const org = (await acc.client.rpc('create_org', { p_type: 'partner', p_name: `Hosted Partner ${tag} ${run}` })).data as string;
  const prof = await acc.client.rpc('save_partner_profile', { p_org: org, p_display_name: `Hosted partner ${tag}`, p_contact_email: `hosted-${run}-${tag}@example.test` });
  expect(prof.error, prof.error?.message).toBeNull();
  remoteSql(`update public.partner_profiles set status = 'approved', decided_at = now() where org_id = ${lit(org)}`);
  return { acc, org };
}

test('sourcing: buyer sends a request to two partners, partner quotes, an unscanned attachment is refused, buyer counters, partner revises, buyer chooses, outsiders see nothing', async ({ browser }) => {
  test.setTimeout(600_000);
  const buyer = await account('s-buyer');
  const bOrg = (await buyer.client.rpc('create_org', { p_type: 'buyer', p_name: `Hosted Sourcing Buyer ${run}` })).data as string;
  expect(bOrg).toBeTruthy();
  const a = await partner('s-pa');
  const b = await partner('s-pb');
  const outsider = await account('s-out');
  const outsiderPartner = await partner('s-pc');

  const bp = await (await browser.newContext()).newPage();
  await loginUi(bp, buyer);
  await bp.goto('/en/sourcing/new');
  await expect(bp.getByRole('heading', { name: t('p6.new') })).toBeVisible();
  await bp.locator('#product-0').fill('Hosted cotton rolls');
  await bp.locator('#quantity-0').fill('10');
  await bp.locator('#unit-0').fill('rolls');
  await bp.locator('#category-0').selectOption('textiles-apparel');
  await bp.locator('#p6-state').selectOption('Selangor');
  await bp.locator(`input[name=partner][value="${a.org}"]`).check();
  await bp.locator(`input[name=partner][value="${b.org}"]`).check();
  await bp.getByRole('button', { name: t('p6.send'), exact: true }).click();
  await expect(bp).toHaveURL(/\/en\/sourcing\/[0-9a-f-]{36}$/);
  const rfq = bp.url().split('/').pop()!;
  expect(remoteRows<{ n: number }>(`select count(*)::int as n from public.sourcing_rfq_items where rfq_id = ${lit(rfq)}`)[0]!.n).toBe(1);

  // Partner A quotes and uploads a document.
  const pa = await (await browser.newContext()).newPage();
  await loginUi(pa, a.acc);
  await gotoWithMfa(pa, a.acc, `/en/sourcing/${rfq}?partner=${a.org}`);
  await expect(pa.locator('strong').filter({ hasText: 'Hosted cotton rolls' }).first()).toBeVisible();
  await pa.getByRole('button', { name: t('p6.accept'), exact: true }).first().click();
  await pa.locator('[id^="price-"]').fill('12.50');
  await pa.locator('#p6-valid').fill(future());
  await pa.getByRole('button', { name: t('p6.submitQuote'), exact: true }).click();
  await expect.poll(() => remoteRows<{ n: number }>(`select count(*)::int as n from public.sourcing_rfq_quotes where rfq_id = ${lit(rfq)}`)[0]!.n, { timeout: 40_000 }).toBe(1);
  await pa.locator(`#sourcing-file-${a.org}`).setInputFiles(pdf('quote-sheet'));
  await pa.getByRole('button', { name: t('p6.uploadDocument') }).click();
  // No scanner is connected to staging. Sourcing attachments are scanned before they are stored, so the upload is refused and nothing is kept.
  await expect(pa.locator('main [role=alert], main .form-message-slot').filter({ hasText: /./ }).first()).toBeVisible({ timeout: 30_000 });
  await pa.waitForTimeout(3000);
  expect(remoteRows<{ n: number }>(`select count(*)::int as n from public.sourcing_rfq_documents where rfq_id = ${lit(rfq)}`)[0]!.n).toBe(0);
  const docUrl = `/api/v1/sourcing/${rfq}/documents/00000000-0000-4000-8000-000000000000`;
  expect((await bp.request.get(docUrl)).status()).toBe(404);

  // Buyer sees the price, messages, requests a sample and counters.
  await bp.reload();
  await expect(bp.getByText('INR 125.00', { exact: true })).toBeVisible();
  await bp.locator(`#message-${a.org}`).fill('Hosted request details for partner A');
  await bp.locator(`#message-${a.org}`).locator('xpath=ancestor::form').getByRole('button', { name: t('p6.sendMessage') }).click();
  await expect.poll(() => remoteRows<{ n: number }>(`select count(*)::int as n from public.sourcing_rfq_messages where rfq_id = ${lit(rfq)} and partner_org_id = ${lit(a.org)}`)[0]!.n, { timeout: 40_000 }).toBe(1);
  await bp.reload();
  await bp.waitForLoadState('networkidle');
  await bp.locator('#sample-partner').selectOption(a.org);
  await bp.getByRole('button', { name: t('p6.requestSample') }).click();
  await expect.poll(() => remoteRows<{ n: number }>(`select count(*)::int as n from public.sourcing_rfq_samples where rfq_id = ${lit(rfq)}`)[0]!.n, { timeout: 40_000 }).toBe(1);
  const quote = remoteRows<{ id: string }>(`select id from public.sourcing_rfq_quotes where rfq_id = ${lit(rfq)}`)[0]!.id;
  await bp.reload();
  await bp.waitForLoadState('networkidle');
  await bp.locator(`#counter-${quote}`).fill('115.00');
  await bp.locator(`#counter-note-${quote}`).fill('Could you offer this price?');
  await bp.getByRole('button', { name: t('p6.suggest') }).click();
  await expect.poll(() => remoteRows<{ n: number }>(`select count(*)::int as n from public.sourcing_rfq_counters where quote_id = ${lit(quote)}`)[0]!.n, { timeout: 40_000 }).toBe(1);

  // Partner A revises; buyer chooses.
  await pa.goto(`/en/sourcing/${rfq}?partner=${a.org}`);
  await expect(pa.getByText('Hosted request details for partner A')).toBeVisible();
  await pa.getByRole('button', { name: t('p6.accept'), exact: true }).first().click();
  await pa.locator('[id^="price-"]').fill('11.50');
  await pa.getByRole('button', { name: t('p6.reviseQuote') }).click();
  await expect.poll(() => remoteRows<{ n: number }>(`select count(*)::int as n from public.sourcing_rfq_quote_revisions where quote_id = ${lit(quote)}`)[0]!.n, { timeout: 40_000 }).toBe(2);
  await bp.reload();
  await expect(bp.getByText('INR 115.00', { exact: true })).toBeVisible();
  await bp.getByRole('button', { name: t('p6.choose'), exact: true }).click();
  await expect(bp.getByText(t('p6.status.preferred_selected')).first()).toBeVisible();
  expect(remoteRows<{ n: number }>(`select count(*)::int as n from public.sourcing_rfqs where id = ${lit(rfq)} and status = 'preferred_selected'`)[0]!.n).toBe(1);

  // Cross-tenant: another buyer, an unrelated partner and the non-chosen partner B (who never quoted) see nothing of partner A's price or document.
  const octx = await browser.newContext();
  const op = await octx.newPage();
  await loginUi(op, outsider);
  await op.goto(`/en/sourcing/${rfq}`);
  await expect(op.locator('body')).not.toContainText('Hosted cotton rolls');
  expect((await op.request.get(docUrl)).status()).toBe(404);
  const pc = await (await browser.newContext()).newPage();
  await loginUi(pc, outsiderPartner.acc);
  await gotoWithMfa(pc, outsiderPartner.acc, `/en/sourcing/${rfq}?partner=${outsiderPartner.org}`);
  await expect(pc.locator('body')).not.toContainText('Hosted cotton rolls');
  expect((await pc.request.get(docUrl)).status()).toBe(404);
  const pb = await (await browser.newContext()).newPage();
  await loginUi(pb, b.acc);
  await gotoWithMfa(pb, b.acc, `/en/sourcing/${rfq}?partner=${b.org}`);
  await expect(pb.locator('body')).not.toContainText('INR 115.00');
  await expect(pb.locator('body')).not.toContainText('Hosted request details for partner A');
  expect((await pb.request.get(docUrl)).status()).toBe(404);
  // API level: the outsider cannot read the RFQ, quotes or documents rows.
  for (const table of ['sourcing_rfqs', 'sourcing_rfq_quotes', 'sourcing_rfq_documents', 'sourcing_rfq_messages']) {
    const r = await outsider.client.from(table).select('id').limit(5);
    expect(r.data ?? [], table).toHaveLength(0);
  }
});

async function fillOnboarding(page: Page, orgId: string) {
  const btn = () => page.locator('main').getByRole('button', { name: t('ob.next'), exact: true });
  await page.goto(`/en/orgs/${orgId}/business/onboarding?step=1`);
  await page.locator('#business_name').fill(`Hosted Biz ${run}`);
  await page.locator('#category_slug').selectOption('retail-shop');
  await page.locator('#reg-yes').check();
  await btn().click();
  await expect(page).toHaveURL(/step=2$/);
  await page.locator('#ssm_number').fill('202001012345');
  await page.locator('#business_type').selectOption('sdn_bhd');
  await btn().click();
  await expect(page).toHaveURL(/step=3$/);
  await page.locator('#state').selectOption('Selangor');
  await page.locator('#district').fill('Petaling');
  await page.locator('#address_line').fill('12 Jalan Contoh Rahsia');
  await page.locator('#postcode').fill('47301');
  await btn().click();
  await expect(page).toHaveURL(/step=4$/);
  await page.locator('#rep_name').fill('Siti Authorised');
  await page.locator('#rep_role').selectOption('owner');
  await btn().click();
  await expect(page).toHaveURL(/step=5$/);
}

async function upload(page: Page, ct: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const section = page.locator('section.card').filter({ has: page.locator(`#claim-${ct}`) });
  const form = section.locator('form').filter({ has: page.locator(`#file-${ct}`) });
  await page.waitForLoadState('networkidle');
  await section.locator(`#file-${ct}`).setInputFiles(file);
  const resp = page.waitForResponse((r) => r.request().method() === 'POST');
  await form.getByRole('button', { name: t('ob.s5.upload'), exact: true }).click();
  await resp;
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  return { section, message: form.locator('.form-message-slot') };
}

test('verification documents on hosted: unsafe files refused, a valid file stays quarantined (no scanner), cannot be downloaded or sent, other tenants cannot reach it', async ({ browser }) => {
  test.setTimeout(600_000);
  const owner = await account('d-owner');
  const orgId = (await owner.client.rpc('create_org', { p_type: 'business', p_name: `Hosted Docs Shop ${run}` })).data as string;
  const stranger = await account('d-stranger');
  const strangerOrg = (await stranger.client.rpc('create_org', { p_type: 'business', p_name: `Hosted Stranger Shop ${run}` })).data as string;
  const ct = 'business_registration';
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUi(page, owner);
  await fillOnboarding(page, orgId);

  // Unsafe files are refused before storage, with the right message.
  const exe = { name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90), Buffer.from('This program cannot be run in DOS mode')]) };
  const js = { name: 'active.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1') };
  const bad = await upload(page, ct, exe);
  await expect(bad.message).toContainText(t('errors.file_type_not_allowed'));
  const active = await upload(page, ct, js);
  await expect(active.message).toContainText(t('errors.file_unsafe_content'));
  expect(remoteRows<{ n: number }>(`select count(*)::int as n from public.verification_documents d join public.verification_claims c on c.id = d.claim_id where c.org_id = ${lit(orgId)} and d.removed_at is null`)[0]!.n).toBe(0);

  // A valid PDF is accepted but waits for the scanner, which is not connected on staging.
  const ok = await upload(page, ct, pdf('registration'));
  await expect(ok.message).toContainText(t('documents.pendingScan'));
  await expect(ok.section.getByRole('link', { name: t('documents.download') })).toHaveCount(0);
  const row = remoteRows<{ id: string; scan_status: string }>(`select d.id, d.scan_status from public.verification_documents d join public.verification_claims c on c.id = d.claim_id where c.org_id = ${lit(orgId)} and d.removed_at is null`)[0]!;
  expect(['pending', 'failed']).toContain(row.scan_status);
  expect((await page.request.get(`/api/v1/documents/${row.id}`)).status()).toBe(404);

  // It cannot be sent for review while unscanned, and the claim stays a draft.
  await ok.section.getByRole('button', { name: t('ob.s5.submit'), exact: true }).click();
  await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.documents_not_ready') })).toBeVisible();
  expect(remoteRows<{ status: string }>(`select status from public.verification_claims where org_id = ${lit(orgId)} and claim_type = ${lit(ct)}`)[0]!.status).toBe('draft');

  // Cross-tenant: another signed-in owner, an anonymous caller and the storage API cannot get it.
  const sctx = await browser.newContext();
  const sp = await sctx.newPage();
  await loginUi(sp, stranger);
  expect((await sp.request.get(`/api/v1/documents/${row.id}`)).status()).toBe(404);
  await sp.goto(`/en/orgs/${orgId}/business/onboarding?step=5`);
  await expect(sp.locator('body')).not.toContainText(`Hosted Biz ${run}`);
  const anonCtx = await browser.newContext();
  expect([401, 403, 404]).toContain((await anonCtx.request.get(`/api/v1/documents/${row.id}`)).status());
  const rows = await stranger.client.from('verification_documents').select('id').eq('claim_id', remoteRows<{ id: string }>(`select id from public.verification_claims where org_id = ${lit(orgId)} and claim_type = ${lit(ct)}`)[0]!.id);
  expect(rows.data ?? []).toHaveLength(0);
  const path = remoteRows<{ storage_path: string }>(`select storage_path from public.verification_documents where id = ${lit(row.id)}`)[0]!.storage_path;
  const dl = await stranger.client.storage.from('verification-docs').download(path);
  expect(dl.error).toBeTruthy();
  const own = await owner.client.storage.from('verification-docs').download(path);
  expect(own.error).toBeTruthy();
  // The stranger cannot act on the other organisation through the API either.
  const forge = await stranger.client.rpc('save_partner_profile', { p_org: orgId, p_display_name: 'x', p_contact_email: 'x@example.test' });
  expect(forge.error).not.toBeNull();
  expect(strangerOrg).toBeTruthy();
  await Promise.all([ctx.close(), sctx.close(), anonCtx.close()]);
});
