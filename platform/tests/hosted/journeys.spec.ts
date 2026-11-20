import { expect, test } from '@playwright/test';
import { fillBookingTerms } from '../e2e/support/deals-ui';
import { msg } from '../e2e/support/i18n';
import { account, gotoWithMfa, guardStaging, lit, loginUi, remoteRows, remoteSql, run } from './support';

// Hosted journeys on the deployed Worker and the real staging database, driven through the real screens (ported from the local
// suites e41 and e82, whose fixtures need a direct database connection that hosted projects do not offer).
test.describe.configure({ mode: 'serial' });
test.beforeAll(guardStaging);

const t = (key: string) => msg('en', key);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('quotation: seller replies and quotes, buyer asks for a change, seller revises, buyer accepts, a stranger is kept out', async ({ browser }) => {
  test.setTimeout(420_000);
  const seller = await account('q-seller');
  const buyer = await account('q-buyer');
  const orgS = (await seller.client.rpc('create_org', { p_type: 'business', p_name: `Hosted Kedai Q ${run}` })).data as string;
  const orgB = (await buyer.client.rpc('create_org', { p_type: 'buyer', p_name: `Hosted Buyer Q ${run}` })).data as string;
  expect(orgS && orgB).toBeTruthy();
  const enquiryId = String(
    remoteRows<{ id: string }>(
      `insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by) values (${lit(orgB)},${lit(orgS)},'listing',${lit(`Hosted uniforms ${run}`)},${lit(orgB)},${lit(buyer.id)}) returning id`,
    )[0]!.id,
  );
  const url = `/en/enquiries/${enquiryId}`;
  const sctx = await browser.newContext();
  const bctx = await browser.newContext();
  const octx = await browser.newContext();
  const sp = await sctx.newPage();
  const bp = await bctx.newPage();
  await loginUi(sp, seller);
  await sp.goto(url);
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText(`Hosted uniforms ${run}`);
  await sp.locator('#reply-body').fill('We can make these uniforms.');
  await sp.getByRole('button', { name: t('p4.sendReply') }).click();
  await expect(sp.locator('main')).toContainText('We can make these uniforms.');
  const fillQuote = async (scope: string, qty: string) => {
    await sp.locator('#scope').fill(scope);
    await sp.locator('#description1').fill('Uniforms');
    await sp.locator('#quantity1').fill(qty);
    await sp.locator('#unit1').fill('pieces');
    await sp.locator('#unitPrice1').fill('12.50');
    await sp.locator('#validUntil').fill(inDays(7));
    await sp.locator('#deliveryTiming').fill('Within three weeks');
    await fillBookingTerms(sp);
    await sp.locator('#taxTreatment').fill('Tax included as stated');
    await sp.getByRole('button', { name: t('p4.saveDraft') }).click();
  };
  await fillQuote('100 custom uniforms', '100');
  await expect(sp.locator('main')).toContainText('MYR 1250.00');
  await sp.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(sp.locator('main')).toContainText('100 custom uniforms');

  await loginUi(bp, buyer);
  await bp.goto(url);
  await expect(bp.locator('main')).toContainText('MYR 1250.00');
  await bp.locator('#revision-reason').fill('Please include 10 extra shirts.');
  await bp.getByRole('button', { name: t('p4.requestChange') }).click();
  await expect(bp.locator('main')).toContainText('Please include 10 extra shirts.');

  await sp.reload();
  await fillQuote('110 custom uniforms and shirts', '110');
  await sp.getByRole('button', { name: t('p4.sendQuote') }).click();
  await expect(sp.locator('main')).toContainText('MYR 1375.00');
  await bp.reload();
  await expect(bp.getByText('Version 2')).toBeVisible();
  await bp.getByRole('button', { name: t('p4.accept') }).click();
  await expect(bp.getByText(t('p4.selectedNotice'))).toBeVisible();
  const q = remoteRows<{ status: string; accepted_version_id: string; current_version_id: string }>(
    `select status,accepted_version_id,current_version_id from public.quotations where enquiry_id=${lit(enquiryId)}`,
  )[0]!;
  expect(q.status).toBe('accepted');
  expect(q.accepted_version_id).toBe(q.current_version_id);

  // A stranger cannot read this enquiry or its price.
  const other = await account('q-other');
  const op = await octx.newPage();
  await loginUi(op, other);
  await op.goto(url);
  await expect(op.locator('main')).not.toContainText('MYR 1375.00');
  await expect(op.locator('main')).not.toContainText('We can make these uniforms.');
  await Promise.all([sctx.close(), bctx.close(), octx.close()]);
});

test('government assistance: manual entry, approval by a different administrator, public page, save and track, close, archive, audit', async ({ browser }) => {
  test.setTimeout(480_000);
  const a = await account('g-admin-a', true);
  const b = await account('g-admin-b', true);
  const owner = await account('g-owner');
  for (const x of [a, b]) {
    remoteSql(
      `insert into public.memberships (org_id, user_id, role) select id, ${lit(x.id)}, 'admin_super' from public.organisations where type = 'mitra' on conflict (org_id, user_id) do update set role = excluded.role, status = 'active'`,
    );
  }
  remoteSql(`update public.gov_settings set enabled = true where key = 'publishing_enabled'`);
  try {
    const code = `HG${run.toUpperCase()}`;
    const agency = remoteRows<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values (${lit(code)},'Hosted agency','www.mitra.gov.my') returning id`)[0]!.id;
    const sourceId = remoteRows<{ id: string }>(
      `insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,allowed_method,enabled) values (${lit(agency)},${lit(`Hosted source ${run}`)},'manual','manual','{www.mitra.gov.my}','{}','manual_entry',false) returning id`,
    )[0]!.id;
    const name = `Hosted Grant ${run}`;
    const ca = await browser.newContext();
    const cb = await browser.newContext();
    const pa = await ca.newPage();
    const pb = await cb.newPage();
    const form = (page: typeof pa, anchor: string) => page.locator(anchor).locator('xpath=ancestor::form');
    const proposed = msg('en', 'gov.admin.manual.proposed');

    await loginUi(pa, a);
    await gotoWithMfa(pa, a, '/en/admin/business-help/programmes/new');
    await pa.locator('#mp-source').selectOption(sourceId);
    await pa.locator('#mp-name').fill(name);
    await pa.locator('#mp-category').selectOption('grants_funding');
    await pa.locator('#mp-ft').selectOption('grant');
    await pa.locator('#mp-desc').fill('A synthetic programme entered by hand for the hosted staging check.');
    await pa.locator('#mp-iurl').fill('https://www.mitra.gov.my/ms/modal-insan');
    await pa.locator('#mp-status').selectOption('open');
    await pa.locator('#mp-closes').fill(inDays(30));
    await pa.locator('#mp-docs').fill('SSM registration\nBusiness photos');
    await pa.locator('#mp-reason').fill('Read from the official page by hand');
    await form(pa, '#mp-name').locator('button[type=submit]').click();
    await expect(pa.locator('.form-message-slot').filter({ hasText: proposed }).first()).toBeVisible();
    const proposal = remoteRows<{ id: string }>(`select id from public.gov_change_proposals where candidate ->> 'name' = ${lit(name)}`)[0]!.id;
    expect(remoteRows(`select 1 from public.gov_programmes where name = ${lit(name)} and publication_state = 'published'`)).toHaveLength(0);

    // The author cannot approve (page and database); a different administrator can.
    await pa.goto(`/en/admin/business-help/review/${proposal}`);
    await expect(pa.getByTestId('gov-own-entry')).toBeVisible();
    const own = await a.client.rpc('gov_decide_proposal', { p_proposal: proposal, p_decision: 'approve', p_reason: 'approving my own entry', p_expected_status: 'pending' });
    expect(own.error).not.toBeNull();
    await loginUi(pb, b);
    await gotoWithMfa(pb, b, `/en/admin/business-help/review/${proposal}`);
    await pb.locator('#rv-reason-approve').fill('Checked against the official page');
    await pb.getByRole('button', { name: msg('en', 'gov.admin.approve'), exact: true }).click();
    await expect
      .poll(() => remoteRows<{ publication_state: string }>(`select publication_state from public.gov_programmes where name = ${lit(name)}`)[0]?.publication_state, { timeout: 40_000 })
      .toBe('published');
    const prog = remoteRows<{ id: string; slug: string }>(`select id, slug from public.gov_programmes where name = ${lit(name)}`)[0]!;

    // Public page, then a business owner saves it and reports progress.
    const pub = await (await browser.newContext()).newPage();
    await pub.goto(`/en/business-help/${prog.slug}`);
    await expect(pub.getByRole('heading', { name })).toBeVisible();
    const orgId = (await owner.client.rpc('create_org', { p_type: 'business', p_name: `Hosted Kedai G ${run}` })).data as string;
    const ow = await (await browser.newContext()).newPage();
    await loginUi(ow, owner);
    const saveRpc = await owner.client.rpc('gov_save_programme', { p_org: orgId, p_programme: prog.id });
    expect(saveRpc.error, saveRpc.error?.message).toBeNull();
    await ow.goto(`/en/business-help/saved?org=${orgId}`);
    const saved = ow.locator(`[data-programme="${prog.slug}"]`);
    await expect(saved).toBeVisible();
    const v0 = await saved.locator('input[name=version]').inputValue();
    await saved.locator('select[name=tracking_status]').selectOption('ready_to_apply');
    await saved.getByRole('button', { name: t('gov.saved.update') }).click();
    await expect
      .poll(() => remoteRows<{ s: string }>(`select tracking_status as s from public.gov_saved where org_id = ${lit(orgId)} and programme_id = ${lit(prog.id)}`)[0]?.s, { timeout: 40_000 })
      .toBe('ready_to_apply');
    await expect(saved.locator('input[name=version]')).not.toHaveValue(v0);

    // Closing is a second approved edit, then archive; the audit trail has the steps.
    await pa.goto(`/en/admin/business-help/programmes/${prog.id}/edit`);
    await pa.locator('#mp-status').selectOption('closed');
    await pa.locator('#mp-reason').fill('The agency page now says applications are closed');
    await form(pa, '#mp-name').locator('button[type=submit]').click();
    await expect(pa.locator('.form-message-slot').filter({ hasText: proposed }).first()).toBeVisible();
    const closing = remoteRows<{ id: string }>(`select id from public.gov_change_proposals where programme_id = ${lit(prog.id)} and status = 'pending'`)[0]!.id;
    await gotoWithMfa(pb, b, `/en/admin/business-help/review/${closing}`);
    await pb.locator('#rv-reason-approve').fill('Confirmed on the official page');
    await pb.getByRole('button', { name: msg('en', 'gov.admin.approve'), exact: true }).click();
    await expect
      .poll(() => remoteRows<{ s: string }>(`select application_status as s from public.gov_programmes where id = ${lit(prog.id)}`)[0]?.s, { timeout: 40_000 })
      .toBe('closed');
    await pa.goto('/en/admin/business-help');
    const card = pa.locator(`[data-programme-id="${prog.id}"]`);
    await expect(card).toBeVisible();
    await card.locator(`#ar-${prog.id}`).fill('The scheme was withdrawn by the agency');
    await card.getByRole('button', { name: msg('en', 'gov.admin.archiveConfirm'), exact: true }).click();
    await expect
      .poll(() => remoteRows<{ s: string }>(`select publication_state as s from public.gov_programmes where id = ${lit(prog.id)}`)[0]?.s, { timeout: 40_000 })
      .toBe('archived');
    const actions = remoteRows<{ action: string }>(`select action from public.audit_log where entity_id = ${lit(prog.id)} order by at`).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['gov.programme.published', 'gov.programme.archived']));
    await Promise.all([ca.close(), cb.close()]);
  } finally {
    remoteSql(`update public.gov_settings set enabled = false where key = 'publishing_enabled'`);
  }
});
