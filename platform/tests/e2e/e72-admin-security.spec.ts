import { expect, test, type Page } from '@playwright/test';
import { addMember, createUser, rpcFromPage, signedClient, sql, uniqEmail, type TestUser } from './support/db';
import { msg } from './support/i18n';
import {
  actorGoto,
  approveSupplierAs,
  approvedSupplier,
  call,
  createAdmin,
  createBuyer,
  createPartner,
  createProduct,
  createSupplier,
  enrolClient,
  productData,
  productRow,
  registerCleanDoc,
  supplierRow,
  tokenOf,
  type Admin,
} from './support/p5-admin';
import { addMitraMember, freshContext, loginUi } from './support/ui';

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);

const PAGES: { path: (ids: Ids) => string; title: string; who: string[] }[] = [
  { path: () => '/en/admin/catalogue', title: 'p5admin.home.title', who: ['admin_review', 'admin_support', 'admin_ops', 'admin_super'] },
  { path: () => '/en/admin/catalogue/partners', title: 'p5admin.partners.title', who: ['admin_review', 'admin_super'] },
  { path: () => '/en/admin/catalogue/suppliers', title: 'p5admin.suppliers.title', who: ['admin_review', 'admin_super'] },
  { path: (i) => `/en/admin/catalogue/suppliers/${i.supplier}`, title: 'p5admin.suppliers.detail.title', who: ['admin_review', 'admin_super'] },
  { path: () => '/en/admin/catalogue/products', title: 'p5admin.products.title', who: ['admin_review', 'admin_super'] },
  { path: (i) => `/en/admin/catalogue/products/${i.product}`, title: 'p5admin.products.detail.title', who: ['admin_review', 'admin_super'] },
  { path: () => '/en/admin/catalogue/reports', title: 'p5admin.reports.title', who: ['admin_support', 'admin_super'] },
  { path: () => '/en/admin/catalogue/imports', title: 'p5admin.imports.title', who: ['admin_review', 'admin_support', 'admin_ops', 'admin_super'] },
];
interface Ids {
  supplier: string;
  product: string;
}

/** What each role may call (the database decides; the screens only mirror it). `null` means: must be refused. */
const ADMIN_RPCS = (ids: Ids, orgId: string, reportId: string) => ({
  review_supplier: { p_supplier: ids.supplier, p_decision: 'approve', p_reason: null, p_checks: ['contact_reachable'], p_expected_version: 1 },
  review_product: { p_product: ids.product, p_decision: 'approve', p_reason: null, p_expected_version: 1 },
  approve_partner: { p_org: orgId, p_reason: null },
  suspend_partner: { p_org: orgId, p_reason: 'testing the doors' },
  provision_partner: { p_name: 'Sneaky Partner', p_owner_email: 'sneaky@example.test', p_display_name: 'Sneaky' },
  suspend_supplier: { p_supplier: ids.supplier, p_reason: 'testing the doors' },
  reinstate_supplier: { p_supplier: ids.supplier, p_reason: 'testing the doors' },
  suspend_product: { p_product: ids.product, p_reason: 'testing the doors' },
  reinstate_product: { p_product: ids.product, p_reason: 'testing the doors' },
  handle_product_report: { p_report: reportId, p_action: 'dismiss', p_note: 'testing the doors' },
  list_supplier_reviews: { p_scope: 'pending', p_offset: 0 },
  list_product_reviews: { p_offset: 0 },
  get_product_for_review: { p_product: ids.product },
  list_product_reports: { p_status: 'open', p_offset: 0 },
  list_partner_orgs: { p_status: null, p_offset: 0 },
  catalogue_stats: {},
});

const refused = (r: { status: number; body: any }) => [401, 403].includes(r.status);

async function unchangedState(ids: Ids, orgId: string, want: { supplier: string; product: string; partner: string }) {
  expect((await supplierRow(ids.supplier)).status).toBe(want.supplier);
  expect((await productRow(ids.product)).status).toBe(want.product);
  expect((await sql<{ status: string }>(`select status::text from public.partner_profiles where org_id = $1`, [orgId]))[0]!.status).toBe(want.partner);
}

test('E72 every admin screen and RPC refuses the wrong people (partner, buyer, viewer, ops, support, content, anonymous, aal1)', async ({ page, browser }) => {
  test.setTimeout(540_000);
  const [rv, sp, ops, content, sup] = await Promise.all([
    createAdmin('admin_review', 'e72r'),
    createAdmin('admin_support', 'e72s'),
    createAdmin('admin_ops', 'e72o'),
    createAdmin('admin_content', 'e72c'),
    createAdmin('admin_super', 'e72a'),
  ]);
  const admins: Record<string, Admin> = { admin_review: rv, admin_support: sp, admin_ops: ops, admin_content: content, admin_super: sup };

  // data: partner A with an approved supplier and a submitted product, partner B with its own supplier and a document
  const pa = await createPartner({ prefix: 'e72a' });
  const pb = await createPartner({ prefix: 'e72b' });
  const supA = await approvedSupplier(pa, rv);
  const productId = await createProduct(pa, supA.id, productData(`E72${Date.now().toString(36)}`.slice(0, 18), { name: 'E72 secret lamp' }));
  const supB = await createSupplier(pb, { submit: true, name: 'E72 partner B supplier' });
  const docB = await registerCleanDoc(pb, supB.id).catch(() => null);
  // a supplier of A that waits for review, so the queue pages have content
  const supWaiting = await createSupplier(pa, { submit: true, name: 'E72 waiting supplier' });
  const ids: Ids = { supplier: supWaiting.id, product: productId };
  const buyer = await createBuyer('e72buy');
  const viewer = await createUser('e72-viewer', { name: 'E72 viewer' });
  await addMember(pa.orgId, viewer.id, 'viewer');

  // ---------------------------------------------------------------- 1. screens: each role sees exactly what it may
  const roleOrder = ['admin_review', 'admin_support', 'admin_ops', 'admin_content', 'admin_super'] as const;
  for (const role of roleOrder) {
    const ctx = await freshContext(browser, page);
    const p = await ctx.newPage();
    await actorGoto(p, admins[role]!, '/en/admin/catalogue/imports').catch(() => undefined);
    for (const pg of PAGES) {
      await p.goto(pg.path(ids));
      const allowed = pg.who.includes(role);
      if (allowed) {
        await expect(p.getByRole('heading', { level: 1 }).first(), `${role} should see ${pg.path(ids)}`).toBeVisible();
        await expect(p.locator('main'), `${role} should not be told it has no access on ${pg.path(ids)}`).not.toContainText(t('p5admin.common.noAccess'));
        if (pg.title === 'p5admin.home.title') {
          // the overview shows only the links this role may use
          for (const [href, who] of [
            ['/admin/catalogue/partners', ['admin_review', 'admin_super']],
            ['/admin/catalogue/suppliers', ['admin_review', 'admin_super']],
            ['/admin/catalogue/products', ['admin_review', 'admin_super']],
            ['/admin/catalogue/reports', ['admin_support', 'admin_super']],
          ] as const) {
            await expect(p.locator(`main a[href$="${href}"]`), `${role} link ${href}`).toHaveCount(who.includes(role) ? 2 : 0);
          }
        }
      } else {
        await expect(p.locator('main'), `${role} must be refused on ${pg.path(ids)}`).toContainText(t('p5admin.common.noAccess'));
        await expect(p.locator('main')).not.toContainText('E72 waiting supplier');
        await expect(p.locator('main')).not.toContainText('E72 secret lamp');
        await expect(p.locator('main')).not.toContainText('Ravi Kumar');
        // Scoped to the page content, not the admin shell's own sidebar (which carries its own sign-out form).
        await expect(p.locator('.ad-main form')).toHaveCount(0);
      }
    }
    await ctx.close();
  }

  // people who are not MITRA staff: buyer, partner viewer, partner owner (at aal2) and an anonymous visitor
  const others: { label: string; user: TestUser; secret?: string }[] = [
    { label: 'buyer', user: buyer.user },
    { label: 'partner viewer', user: viewer },
    { label: 'partner owner', user: pa.owner, secret: pa.owner.secret },
  ];
  for (const o of others) {
    const ctx = await freshContext(browser, page);
    const p = await ctx.newPage();
    if (o.secret) await actorGoto(p, pa.owner, '/en/admin/catalogue');
    else await loginUi(p, o.user, 'en');
    for (const pg of PAGES) {
      await p.goto(pg.path(ids));
      await expect(p.locator('main'), `${o.label} must be refused on ${pg.path(ids)}`).toContainText(t('p5admin.common.noAccess'));
      await expect(p.locator('main')).not.toContainText('E72 waiting supplier');
      await expect(p.locator('main')).not.toContainText('E72 secret lamp');
      await expect(p.locator('main form')).toHaveCount(0);
    }
    await ctx.close();
  }
  {
    const ctx = await freshContext(browser, page);
    const p = await ctx.newPage();
    for (const pg of PAGES) {
      await p.goto(pg.path(ids));
      await expect(p, `anonymous on ${pg.path(ids)}`).toHaveURL(/\/en\/login\?next=/);
    }
    await ctx.close();
  }
  // an administrator who has not passed the second step (aal1) is sent to it and sees nothing
  {
    const ctx = await freshContext(browser, page);
    const p = await ctx.newPage();
    await loginUi(p, rv, 'en');
    for (const pg of PAGES) {
      await p.goto(pg.path(ids));
      await expect(p, `aal1 admin on ${pg.path(ids)}`).toHaveURL(/\/en\/mfa\/verify\?next=/);
      await expect(p.locator('main')).not.toContainText('E72 waiting supplier');
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- 2. RPCs from a hostile client (browser, user's own token)
  const [{ id: reportRow }] = [{ id: '00000000-0000-4000-8000-000000000000' }];
  const calls = ADMIN_RPCS(ids, pa.orgId, reportRow);
  await page.goto('/en');
  const state = { supplier: 'awaiting_review', product: 'submitted', partner: 'approved' };
  const denyAll = async (label: string, token: string, except: string[] = []) => {
    for (const [fn, body] of Object.entries(calls)) {
      if (except.includes(fn)) continue;
      const r = await rpcFromPage(page, token, fn, body);
      expect(refused(r), `${label}: ${fn} must be refused, got ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }
  };
  const buyerToken = (await signedClient(buyer.user)).accessToken;
  await denyAll('buyer', buyerToken);
  await denyAll('partner owner (aal2)', await tokenOf(pa.owner.client));
  await denyAll('partner viewer', (await signedClient(viewer)).accessToken);
  await denyAll('administrator at aal1 (no second step)', (await signedClient(rv)).accessToken);
  await denyAll('admin_content', await tokenOf(content.client));
  // admin_ops may read statistics and nothing else
  await denyAll('admin_ops', await tokenOf(ops.client), ['catalogue_stats']);
  expect((await rpcFromPage(page, await tokenOf(ops.client), 'catalogue_stats', {})).status).toBe(200);
  // admin_support: moderation only (reports and suspension), never supplier or product decisions or partners
  await denyAll('admin_support', await tokenOf(sp.client), ['catalogue_stats', 'suspend_supplier', 'suspend_product', 'reinstate_product', 'handle_product_report', 'list_product_reports']);
  // admin_review: decisions, not report handling
  await denyAll('admin_review', await tokenOf(rv.client), ['review_supplier', 'review_product', 'approve_partner', 'suspend_partner', 'provision_partner', 'suspend_supplier', 'reinstate_supplier', 'suspend_product', 'reinstate_product', 'list_supplier_reviews', 'list_product_reviews', 'get_product_for_review', 'list_partner_orgs', 'catalogue_stats']);
  // anonymous (publishable key only)
  const anon = await page.evaluate(async ({ url, key, body }) => {
    const r = await fetch(`${url}/rest/v1/rpc/review_supplier`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.status;
  }, { url: process.env.TEST_API_URL ?? (await import('./support/env')).API_URL, key: (await import('./support/env')).PUBLISHABLE_KEY, body: calls.review_supplier });
  expect([401, 403]).toContain(anon);
  await unchangedState(ids, pa.orgId, state);

  // writes straight into the tables are refused too (no policy lets a partner or buyer approve anything)
  for (const [label, token] of [['partner owner', await tokenOf(pa.owner.client)], ['buyer', buyerToken]] as const) {
    for (const [table, patch] of [['suppliers', { status: 'approved' }], ['products', { status: 'published' }], ['partner_profiles', { status: 'approved' }], ['product_revisions', { status: 'approved' }]] as const) {
      const r = await page.evaluate(async ({ url, key, token, table, patch }) => {
        const res = await fetch(`${url}/rest/v1/${table}?select=id`, { method: 'PATCH', headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(patch) });
        return { status: res.status, text: await res.text() };
      }, { url: (await import('./support/env')).API_URL, key: (await import('./support/env')).PUBLISHABLE_KEY, token, table, patch });
      const touched = r.status < 300 && r.text.trim() !== '[]' && r.text.trim() !== '';
      expect(touched, `${label} PATCH ${table}: ${r.status} ${r.text.slice(0, 120)}`).toBe(false);
    }
  }
  await unchangedState(ids, pa.orgId, state);

  // ---------------------------------------------------------------- 3. partner A cannot read or change partner B
  const a = pa.owner.client;
  expect((await a.rpc('get_supplier', { p_supplier: supB.id })).error).not.toBeNull();
  expect((await a.rpc('list_my_suppliers', { p_org: pb.orgId })).error?.message).toBe('forbidden');
  expect((await a.rpc('list_my_products', { p_org: pb.orgId, p_supplier: null, p_status: null, p_offset: 0, p_limit: 25 })).error?.message).toBe('forbidden');
  expect((await a.rpc('submit_supplier', { p_org: pb.orgId, p_supplier: supB.id, p_expected_version: 1 })).error?.message).toBe('forbidden');
  expect((await a.rpc('save_supplier_draft', { p_org: pb.orgId, p_supplier: supB.id, p_data: { name: 'Hijacked' }, p_expected_version: 1 })).error?.message).toBe('forbidden');
  // naming an own organisation but another partner's supplier hides it (not found)
  const mixed = await a.rpc('save_supplier_draft', { p_org: pa.orgId, p_supplier: supB.id, p_data: { name: 'Hijacked' }, p_expected_version: 1 });
  expect(mixed.error).not.toBeNull();
  expect((await supplierRow(supB.id)).status).toBe('awaiting_review');
  const rows = await a.from('suppliers').select('id');
  expect((rows.data ?? []).map((r: { id: string }) => r.id)).not.toContain(supB.id);
  const priv = await a.from('supplier_private').select('supplier_id');
  expect((priv.data ?? []).map((r: { supplier_id: string }) => r.supplier_id)).not.toContain(supB.id);
  // the evidence route: another partner and a support administrator get 404, never the file
  if (docB) {
    const pctx = await freshContext(browser, page);
    const pp = await pctx.newPage();
    await actorGoto(pp, pa.owner, '/en/admin/catalogue');
    expect((await pp.request.get(`/api/v1/suppliers/${supB.id}/documents/${docB}`)).status()).toBe(404);
    const sctx = await freshContext(browser, page);
    const sp2 = await sctx.newPage();
    await actorGoto(sp2, sp, '/en/admin/catalogue');
    expect((await sp2.request.get(`/api/v1/suppliers/${supB.id}/documents/${docB}`)).status()).toBe(404);
    const actx = await freshContext(browser, page);
    const an = await actx.newPage();
    expect((await an.request.get(`/api/v1/suppliers/${supB.id}/documents/${docB}`)).status()).toBe(404);
  }

  // ---------------------------------------------------------------- 4. a reviewer cannot decide on a partner they were involved with
  // (a) the administrator who provisioned a partner
  const pcOwner = await createUser('e72-pc-owner', { email: uniqEmail('e72pc'), name: 'E72 PC owner' });
  const pcName = `E72 Provisioned ${Date.now().toString(36)}`;
  const prov = await call(sup.client, 'provision_partner', { p_name: pcName, p_owner_email: pcOwner.email, p_display_name: pcName });
  const pcClient = await enrolClient(pcOwner);
  const acc = await pcClient.client.rpc('accept_partner_invitation', { p_token: prov.token });
  expect(acc.error).toBeNull();
  const pc = { owner: pcClient, orgId: prov.org_id as string, name: pcName };
  const supC = await createSupplier(pc, { submit: true, name: `E72 provisioned supplier ${pcName.slice(-6)}` });
  const supCrow = await supplierRow(supC.id);
  const conflict = await sup.client.rpc('review_supplier', { p_supplier: supC.id, p_decision: 'approve', p_reason: null, p_checks: ['contact_reachable'], p_expected_version: supCrow.draft_submitted_version });
  expect(conflict.error?.message).toBe('conflict_of_interest');
  expect((await supplierRow(supC.id)).status).toBe('awaiting_review');
  const sPage = await (await freshContext(browser, page)).newPage();
  await actorGoto(sPage, sup, '/en/admin/catalogue/suppliers');
  await expect(sPage.locator('[data-testid=supplier-card]').filter({ hasText: `E72 provisioned supplier ${pcName.slice(-6)}` })).toContainText(t('p5admin.common.conflict'));
  await sPage.goto(`/en/admin/catalogue/suppliers/${supC.id}`);
  await expect(sPage.getByTestId('supplier-unavailable')).toBeVisible();
  await expect(sPage.locator('main')).not.toContainText('Ravi Kumar');
  await expect(sPage.locator('.ad-main form')).toHaveCount(0);
  await sPage.goto('/en/admin/catalogue/partners');
  const pcCard = sPage.locator('[data-testid=partner-card]').filter({ hasText: pcName });
  await expect(pcCard).toContainText(t('p5admin.common.conflict'));
  await expect(pcCard.getByRole('button', { name: t('p5admin.partners.suspendButton'), exact: true })).toHaveCount(0);
  expect((await sup.client.rpc('suspend_partner', { p_org: pc.orgId, p_reason: 'not allowed to' })).error?.message).toBe('conflict_of_interest');
  // another reviewer can decide it
  await approveSupplierAs(rv, supC.id);
  expect((await supplierRow(supC.id)).status).toBe('approved');
  // product of that partner: the provisioning administrator cannot decide or pause it either
  const prodC = await createProduct(pc, supC.id, productData(`E72C${Date.now().toString(36)}`.slice(0, 18), { name: 'E72 provisioned lamp' }));
  const detail = await call(sup.client, 'get_product_for_review', { p_product: prodC });
  expect(detail.conflict_of_interest).toBe(true);
  expect((await sup.client.rpc('review_product', { p_product: prodC, p_decision: 'approve', p_reason: null, p_expected_version: detail.version })).error?.message).toBe('conflict_of_interest');
  expect((await sup.client.rpc('suspend_product', { p_product: prodC, p_reason: 'not allowed to' })).error?.message).toBe('conflict_of_interest');
  await sPage.goto(`/en/admin/catalogue/products/${prodC}`);
  await expect(sPage.getByTestId('product-conflict')).toBeVisible();
  await expect(sPage.getByRole('button', { name: t('p5admin.products.detail.approveButton'), exact: true })).toHaveCount(0);
  await expect(sPage.getByRole('button', { name: t('p5admin.products.detail.suspendButton'), exact: true })).toHaveCount(0);
  expect((await productRow(prodC)).status).toBe('submitted');

  // (b) a person who was a member of the partner and later became a reviewer
  const dual = await createUser('e72-dual', { name: 'E72 dual' });
  await addMember(pa.orgId, dual.id, 'staff');
  await addMitraMember(dual.id, 'admin_review');
  const dualA = await enrolClient(dual);
  const dualSup = await supplierRow(supWaiting.id);
  expect((await dualA.client.rpc('review_supplier', { p_supplier: supWaiting.id, p_decision: 'reject', p_reason: 'Conflict test, should be refused', p_checks: [], p_expected_version: dualSup.draft_submitted_version })).error?.message).toBe('conflict_of_interest');
  expect((await supplierRow(supWaiting.id)).status).toBe('awaiting_review');

  // nothing changed for the original fixtures
  await unchangedState(ids, pa.orgId, state);
});
