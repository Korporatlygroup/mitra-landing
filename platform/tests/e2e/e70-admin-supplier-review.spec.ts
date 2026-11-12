import { expect, test, type Page } from '@playwright/test';
import { smallPdf } from './support/biz';
import { createUser, sql, uniqEmail } from './support/db';
import { msg } from './support/i18n';
import { waitForMail } from './support/mail';
import {
  PARTNER_INVITE_LINK,
  actorGoto,
  audit,
  call,
  clientWithSecret,
  createAdmin,
  supplierEvents,
  supplierRow,
} from './support/p5-admin';
import { freshCode } from './support/totp';
import { freshContext, loginUi, startEnrolAndReadSecret, submitCode } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const SITE = 'http://127.0.0.1:3503';

/**
 * Journey 1: MITRA provisions a partner, the owner accepts the invitation and signs in with two-step sign-in, creates and sends a supplier,
 * MITRA asks for more information, the partner sends it again and MITRA approves. Every persisted state is read back from the database.
 */
test('E70 partner provisioning, supplier submission, more information, approval (every state persisted, events with reasons)', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const adminA = await createAdmin('admin_super', 'e70a');
  const reviewerB = await createAdmin('admin_review', 'e70b');
  const ownerEmail = uniqEmail('e70-owner');
  const orgName = `E70 Traders ${Date.now().toString(36)}`;

  // ---------------------------------------------------------------- 1. MITRA provisions the partner (UI)
  await actorGoto(page, adminA, '/en/admin/catalogue/partners');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('p5admin.partners.title'));
  await audit(page, 'partners page');

  await page.locator('#prov-name').fill(orgName);
  await page.locator('#prov-display').fill(`${orgName} Display`);
  await page.locator('#prov-email').fill(ownerEmail);
  await page.getByRole('button', { name: t('p5admin.partners.provisionButton'), exact: true }).click();
  await expect(page.locator('.message-ok')).toContainText(t('p5admin.messages.partnerProvisioned'));

  const org = (await sql<{ id: string; type: string; status: string }>(`select id, type::text, status::text from public.organisations where name = $1`, [orgName]))[0]!;
  expect(org.type).toBe('partner');
  const orgId = org.id;
  const profile = (await sql<{ status: string; provisioned_by: string; display_name: string; contact_email: string }>(
    `select status::text, provisioned_by, display_name, contact_email from public.partner_profiles where org_id = $1`, [orgId]))[0]!;
  expect(profile).toMatchObject({ status: 'approved', provisioned_by: adminA.id, display_name: `${orgName} Display`, contact_email: ownerEmail });
  // the administrator is not a member of the partner organisation
  expect(Number((await sql(`select count(*)::int n from public.memberships where org_id = $1`, [orgId]))[0]!.n)).toBe(0);
  const inv1 = (await sql<{ id: string; role: string; email: string; invited_by: string; accepted_at: string | null; revoked_at: string | null; days: number }>(
    `select id, role::text, email::text, invited_by, accepted_at, revoked_at, extract(epoch from (expires_at - now())) / 86400 as days from public.invitations where org_id = $1`, [orgId]))[0]!;
  expect(inv1).toMatchObject({ role: 'owner', email: ownerEmail, invited_by: adminA.id, accepted_at: null, revoked_at: null });
  expect(Number(inv1.days)).toBeGreaterThan(6.9);
  expect(Number(inv1.days)).toBeLessThanOrEqual(7);

  // the invitation e-mail (three languages) carries the one-time link; the token is never in the page
  const mail1 = await waitForMail(ownerEmail, { match: PARTNER_INVITE_LINK });
  const link1 = `${mail1.text}\n${mail1.html}`.match(PARTNER_INVITE_LINK)![0];
  expect(link1.startsWith(SITE)).toBe(true);
  expect(mail1.text).toMatch(/[஀-௿]/);
  expect(mail1.text).toMatch(/telah dijemput menyertai organisasi/);
  const token1 = link1.slice(-64);
  expect(await page.content()).not.toContain(token1);

  // ---------------------------------------------------------------- 2. resend while there is no owner: the first link stops working
  const card = page.locator('[data-testid=partner-card]').filter({ hasText: `${orgName} Display` });
  await card.locator('summary', { hasText: t('p5admin.partners.resendSummary') }).click();
  await card.locator(`#rs-${orgId}`).fill(ownerEmail);
  await card.getByRole('button', { name: t('p5admin.partners.resendButton'), exact: true }).click();
  await expect(card.locator('.message-ok')).toContainText(t('p5admin.messages.partnerResent'));
  const seen = new Set<string>([mail1.id]);
  const mail2 = await waitForMail(ownerEmail, { match: PARTNER_INVITE_LINK, seen });
  const link2 = `${mail2.text}\n${mail2.html}`.match(PARTNER_INVITE_LINK)![0];
  expect(link2).not.toBe(link1);
  const invs = await sql<{ id: string; revoked_at: string | null; accepted_at: string | null }>(`select id, revoked_at, accepted_at from public.invitations where org_id = $1 order by created_at`, [orgId]);
  expect(invs).toHaveLength(2);
  expect(invs[0]!.revoked_at).not.toBeNull();
  expect(invs[1]).toMatchObject({ revoked_at: null, accepted_at: null });
  expect(await page.content()).not.toContain(link2.slice(-64));

  // ---------------------------------------------------------------- 3. the owner: old link fails, new link works, MFA enrolment
  const owner = await createUser('e70-owner', { email: ownerEmail, name: 'E70 Owner' });
  const pctx = await freshContext(browser, page);
  const pp = await pctx.newPage();
  await loginUi(pp, owner, 'en');
  await pp.goto(link1.replace(SITE, ''));
  await expect(pp.locator('main [role=alert]')).toContainText(t('errors.invalid_invitation'));
  expect(Number((await sql(`select count(*)::int n from public.memberships where org_id = $1`, [orgId]))[0]!.n)).toBe(0);

  await pp.goto(link2.replace(SITE, ''));
  // accepted: the owner of a partner organisation must now enrol a second step before anything else
  await expect(pp).toHaveURL(/\/en\/mfa\/enrol/);
  const secret = await startEnrolAndReadSecret(pp, 'en');
  await submitCode(pp, freshCode(secret));
  await expect(pp).toHaveURL(new RegExp(`/en/orgs/${orgId}/partner$`));
  const member = (await sql<{ role: string; status: string }>(`select role::text, status::text from public.memberships where org_id = $1 and user_id = $2`, [orgId, owner.id]))[0]!;
  expect(member).toEqual({ role: 'owner', status: 'active' });
  const accepted = await sql<{ accepted_at: string | null; accepted_by: string | null }>(`select accepted_at, accepted_by from public.invitations where id = $1`, [invs[1]!.id]);
  expect(accepted[0]!.accepted_by).toBe(owner.id);
  expect(accepted[0]!.accepted_at).not.toBeNull();
  const ownerClient = await clientWithSecret(owner, secret);

  // ---------------------------------------------------------------- 4. the partner creates a supplier and uploads evidence through the real route
  const sup = await call(ownerClient.client, 'save_supplier_draft', {
    p_org: orgId,
    p_supplier: null,
    p_expected_version: null,
    p_data: {
      name: `E70 Supplier ${Date.now().toString(36)}`,
      country: 'India',
      state_city: 'Madurai',
      main_category: 'textiles-apparel',
      description: 'Handloom cotton sarees woven in Madurai since 1998.',
      capabilities: ['Handloom weaving', 'Dyeing'],
      code: `E70-${Date.now().toString(36)}`.slice(0, 20),
      contact_name: 'Meena Raj',
      contact_email: 'meena@example.test',
      contact_phone: '+91 90000 11111',
      registration_id: 'TN-REG-777',
      website: 'https://example.test',
    },
  });
  const supplierId = sup.id as string;
  const supplierName = (await call(ownerClient.client, 'get_supplier', { p_supplier: supplierId })).name as string;
  expect((await supplierRow(supplierId)).status).toBe('draft');
  const pdf = smallPdf('e70-registration');
  const up = await pp.evaluate(
    async ({ id, bytes }) => {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'registration.pdf');
      fd.append('docType', 'business_registration');
      const r = await fetch(`/api/v1/suppliers/${id}/documents`, { method: 'POST', body: fd });
      return { status: r.status, body: await r.json() };
    },
    { id: supplierId, bytes: Array.from(pdf.buffer) },
  );
  expect(up.status).toBe(201);
  expect(up.body).toMatchObject({ ok: true, scanStatus: 'clean' });
  const docId = up.body.id as string;
  const cur = await call(ownerClient.client, 'get_supplier', { p_supplier: supplierId });
  await call(ownerClient.client, 'submit_supplier', { p_org: orgId, p_supplier: supplierId, p_expected_version: cur.draft_version });
  const afterSubmit = await supplierRow(supplierId);
  expect(afterSubmit.status).toBe('awaiting_review');
  expect(afterSubmit.draft_submitted_version).not.toBeNull();

  // ---------------------------------------------------------------- 5. MITRA reviewer: queue, detail, private contact, evidence
  const rctx = await freshContext(browser, page);
  const rp = await rctx.newPage();
  await actorGoto(rp, reviewerB, '/en/admin/catalogue/suppliers');
  const queueCard = rp.locator('[data-testid=supplier-card]').filter({ hasText: supplierName });
  await expect(queueCard).toHaveCount(1);
  await expect(queueCard).toContainText(t('p5admin.suppliers.awaitingDecision'));
  await expect(queueCard).not.toContainText(t('p5admin.common.conflict'));
  await audit(rp, 'supplier queue');
  await queueCard.getByRole('link', { name: supplierName }).click();
  await expect(rp).toHaveURL(new RegExp(`/en/admin/catalogue/suppliers/${supplierId}$`));
  await expect(rp.getByRole('heading', { level: 1 })).toHaveText(supplierName);
  await expect(rp.locator('main')).toContainText('Handloom cotton sarees woven in Madurai');
  await expect(rp.getByTestId('supplier-private')).toContainText('meena@example.test');
  await expect(rp.getByTestId('supplier-private')).toContainText('TN-REG-777');
  const docItem = rp.getByTestId('supplier-doc');
  await expect(docItem).toHaveCount(1);
  await expect(docItem).toContainText(t('p5common.status.scan.clean'));
  const href = await docItem.getByRole('link', { name: t('p5admin.suppliers.detail.openDoc') }).getAttribute('href');
  expect(href).toBe(`/api/v1/suppliers/${supplierId}/documents/${docId}`);
  const dl = await rp.request.get(href!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-disposition']).toMatch(/attachment/);
  expect(Buffer.from(await dl.body()).equals(pdf.buffer)).toBe(true);
  await audit(rp, 'supplier detail');

  // ---------------------------------------------------------------- 6. request more information: reason required, then persisted with an event
  await rp.locator('#info-reason').fill('no');
  await rp.getByRole('button', { name: t('p5admin.suppliers.detail.infoButton'), exact: true }).click();
  await expect(rp.getByRole('alert').filter({ hasText: t('errors.reason_required') })).toBeVisible();
  expect((await supplierRow(supplierId)).status).toBe('awaiting_review');
  const infoReason = 'Please add the trade licence number and a clearer registration document.';
  await rp.locator('#info-reason').fill(infoReason);
  const before = Date.now();
  await rp.getByRole('button', { name: t('p5admin.suppliers.detail.infoButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.supplierInfoRequested'));
  const info = await supplierRow(supplierId);
  expect(info).toMatchObject({ status: 'more_info_needed', decision_reason: infoReason, draft_submitted_version: null });
  const ev1 = (await supplierEvents(supplierId)).filter((e) => e.kind === 'more_info_requested');
  expect(ev1).toHaveLength(1);
  expect(ev1[0]).toMatchObject({ reason: infoReason, actor_user_id: reviewerB.id, from_status: 'awaiting_review', to_status: 'more_info_needed' });
  expect(Math.abs(new Date(ev1[0]!.at).getTime() - before)).toBeLessThan(120_000);
  // no longer in the "waiting" queue, the decision form is gone, the reason and event are on the page
  await rp.goto('/en/admin/catalogue/suppliers');
  await expect(rp.locator('[data-testid=supplier-card]').filter({ hasText: supplierName })).toHaveCount(0);
  await rp.goto(`/en/admin/catalogue/suppliers/${supplierId}`);
  await expect(rp.locator('#info-reason')).toHaveCount(0);
  await expect(rp.getByTestId('supplier-events')).toContainText(infoReason);

  // ---------------------------------------------------------------- 7. the partner edits and sends it again
  const cur2 = await call(ownerClient.client, 'get_supplier', { p_supplier: supplierId });
  await call(ownerClient.client, 'save_supplier_draft', {
    p_org: orgId,
    p_supplier: supplierId,
    p_expected_version: cur2.draft_version,
    p_data: { registration_id: 'TN-REG-777 / TL-2024-55' },
  });
  expect((await supplierRow(supplierId)).status).toBe('draft');
  const cur3 = await call(ownerClient.client, 'get_supplier', { p_supplier: supplierId });
  await call(ownerClient.client, 'submit_supplier', { p_org: orgId, p_supplier: supplierId, p_expected_version: cur3.draft_version });
  expect((await supplierRow(supplierId)).status).toBe('awaiting_review');

  // ---------------------------------------------------------------- 8. approve: checks are required, then persisted with the review date
  await rp.goto(`/en/admin/catalogue/suppliers/${supplierId}`);
  await expect(rp.getByTestId('supplier-private')).toContainText('TL-2024-55');
  await rp.getByRole('button', { name: t('p5admin.suppliers.detail.approveButton'), exact: true }).click();
  await expect(rp.getByRole('alert').filter({ hasText: t('errors.invalid_checks') })).toBeVisible();
  expect((await supplierRow(supplierId)).status).toBe('awaiting_review');
  await rp.locator('#chk-contact_reachable').check();
  await rp.locator('#chk-registration_document_seen').check();
  await rp.locator('#approve-note').fill('Documents match the details given.');
  await rp.getByRole('button', { name: t('p5admin.suppliers.detail.approveButton'), exact: true }).click();
  await expect(rp.getByTestId('done-banner')).toContainText(t('p5admin.messages.supplierApproved'));
  const approved = await supplierRow(supplierId);
  expect(approved).toMatchObject({ status: 'approved', draft_submitted_version: null, reviewed_by: reviewerB.id });
  expect([...(approved.review_checks ?? [])].sort()).toEqual(['contact_reachable', 'registration_document_seen']);
  expect(Math.abs(new Date(approved.reviewed_at!).getTime() - Date.now())).toBeLessThan(180_000);
  const events = await supplierEvents(supplierId);
  const kinds = events.map((e) => e.kind).filter((k) => !['document_uploaded', 'scan_result', 'document_viewed'].includes(k));
  expect(kinds).toEqual(['submitted', 'more_info_requested', 'submitted', 'approved']);
  const ev2 = events.find((e) => e.kind === 'approved')!;
  expect(ev2).toMatchObject({ reason: 'Documents match the details given.', actor_user_id: reviewerB.id, to_status: 'approved' });
  await rp.reload();
  await expect(rp.getByTestId('supplier-reviewed')).toContainText('MITRA reviewed documents for this supplier on');
  await expect(rp.getByTestId('supplier-reviewed')).toContainText('contact details could be reached');
  await expect(rp.getByTestId('supplier-events')).toContainText(t('p5admin.suppliers.events.approved'));
  await expect(rp.locator('#approve-note')).toHaveCount(0);
  // the partner sees the decision (notification) and the supplier as approved
  const mine = await call(ownerClient.client, 'list_my_suppliers', { p_org: orgId });
  expect(mine.items.find((s: { id: string }) => s.id === supplierId)).toMatchObject({ status: 'approved' });
  expect(Number((await sql(`select count(*)::int n from public.notifications where org_id = $1 and kind = 'supplier.decided'`, [orgId]))[0]!.n)).toBeGreaterThanOrEqual(2);

  // ---------------------------------------------------------------- 9. the administrator who set the partner up cannot decide on it (conflict of interest)
  await page.goto('/en/admin/catalogue/suppliers?scope=all');
  const own = page.locator('[data-testid=supplier-card]').filter({ hasText: supplierName });
  await expect(own).toContainText(t('p5admin.common.conflict'));
  await page.goto(`/en/admin/catalogue/suppliers/${supplierId}`);
  await expect(page.getByTestId('supplier-unavailable')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('meena@example.test');
  const direct = await adminA.client.rpc('review_supplier', { p_supplier: supplierId, p_decision: 'reject', p_reason: 'Trying to decide on my own partner', p_checks: [], p_expected_version: 1 });
  expect(direct.error?.message).toBe('conflict_of_interest');
  expect((await supplierRow(supplierId)).status).toBe('approved');
  await audit(page, 'supplier conflict view');
});
