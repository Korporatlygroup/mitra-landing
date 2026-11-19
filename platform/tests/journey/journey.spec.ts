import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { extractTekunScheme } from '../../src/server/gov/tekun';
import { actorGoto, call, createAdmin, createPartner, type Admin } from '../e2e/support/p5-admin';
import { clickSend, createBusinessOwner, gotoStep, orgPath, smallPdf, uploadDoc, fillStep1, fillStep2, fillStep3, fillStep4 } from '../e2e/support/biz';
import { createOrgAs, createUser, serviceClient, sql, uniq, uniqEmail, strongPassword, type TestUser } from '../e2e/support/db';
import { platformDir } from '../e2e/support/env';
import { fillBookingTerms } from '../e2e/support/deals-ui';
import { msg } from '../e2e/support/i18n';
import { makeProduct, makeReviewer, makeSupplier, makePartner } from '../e2e/support/p5-buyer';
import { confirmEmailUi, createOrgUi, loginUi, submitSignUp } from '../e2e/support/ui';

// Whole-platform UI walk at laptop size (1280x800). It really performs each action (sign up, onboard, upload, submit, review,
// approve, request, reply, quote, order a price, save, track) and saves a full-page screenshot before and after the important ones.
// Synthetic data only. Output: test-results/journey/NN-name.png and captions.json (turned into a PDF by scripts/journey-pdf.mjs).

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const OUT = path.join(platformDir, 'test-results', 'journey');
const captions: { file: string; chapter: string; title: string; note: string; url: string }[] = [];
let n = 0;
let chapter = '';
const tag = uniq('jr').replace(/-/g, '');
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function shot(page: Page, slug: string, title: string, note = ''): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  n += 1;
  const file = `${String(n).padStart(2, '0')}-${slug}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  captions.push({ file, chapter, title, note, url: new URL(page.url()).pathname + new URL(page.url()).search });
  fs.writeFileSync(path.join(OUT, 'captions.json'), JSON.stringify(captions, null, 2));
}
const ch = (name: string) => { chapter = name; };

async function persona(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  return { ctx, page: await ctx.newPage() };
}

test('whole platform journey at laptop size', async ({ browser }) => {
  test.setTimeout(1_200_000);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // ------------------------------------------------------------------ 1. Public visitor (no account)
  ch('1. Visitor (no account)');
  const anon = await persona(browser);
  const a = anon.page;
  await a.goto('/en');
  await shot(a, 'home-visitor', 'Home page for a visitor', 'The first screen: what the platform is, and the choices to sign in or sign up.');
  await a.goto('/en/directory');
  await shot(a, 'directory-empty', 'Business directory', 'Public search for approved businesses. No account is needed.');
  await a.goto('/en/catalogue');
  await shot(a, 'catalogue-empty', 'Products from India (catalogue)', 'Public catalogue of approved suppliers and products.');
  await a.goto('/en/business-help');
  await shot(a, 'help-home-visitor', 'Business help home', 'Five large choices to find government help. Public.');
  await a.goto('/en/signup');
  await shot(a, 'signup-form', 'Sign-up form', 'Name, email, password, language, and the two consent boxes.');
  await a.goto('/en/login');
  await shot(a, 'login-form', 'Login form');
  await a.goto('/en/privacy');
  await shot(a, 'privacy', 'Privacy page (placeholder text)');

  // ------------------------------------------------------------------ 2. Sign-up and first login
  ch('2. Sign-up, email confirmation, first login');
  const ownerEmail = uniqEmail('jr-owner');
  const ownerPw = strongPassword();
  const s = await persona(browser);
  const sp = s.page;
  await sp.goto('/en/signup');
  await sp.locator('#displayName').fill('Priya Seller');
  await sp.locator('#email').fill(ownerEmail);
  await sp.locator('#password').fill('short');
  await sp.locator('#acceptTerms').check();
  await shot(sp, 'signup-weak-password', 'Sign-up filled in with a weak password', 'Before submitting: the consent boxes are ticked.');
  await sp.locator('main form button[type=submit]').click();
  await sp.waitForLoadState('networkidle');
  await shot(sp, 'signup-error', 'Sign-up refused: a message explains what to fix', 'Server-side validation message; the typed values stay in the form.');
  await submitSignUp(sp, { locale: 'en', name: 'Priya Seller', email: ownerEmail, password: ownerPw });
  await expect(sp).toHaveURL(/\/signup\/check-email$/);
  await shot(sp, 'check-email', '"Check your email" page after sign-up');
  await confirmEmailUi(sp, ownerEmail);
  await shot(sp, 'after-confirm', 'After the email link: signed in, back on the home page');
  await sp.goto('/en/account');
  await shot(sp, 'account', 'Account page', 'Name, language, password change, consents.');

  // ------------------------------------------------------------------ 3. Business owner: organisation, onboarding, documents
  ch('3. Business owner: organisation, onboarding, verification documents');
  const bizName = `Madras Uniforms ${tag}`;
  await sp.goto('/en/orgs');
  await shot(sp, 'orgs-empty', 'Organisations list (none yet)');
  await sp.goto('/en/orgs/new');
  await sp.locator('#type-business').check();
  await sp.locator('#name').fill(bizName);
  await shot(sp, 'org-new', 'Create an organisation', 'Business, buyer or partner.');
  await sp.locator('main form button[type=submit]').click();
  await expect(sp).toHaveURL(/\/orgs\/[0-9a-f-]{36}\/members$/);
  const orgId = sp.url().match(/orgs\/([0-9a-f-]{36})\/members/)![1]!;
  await shot(sp, 'members', 'Members page of the new organisation', 'The creator is the owner. Invitations are sent from here.');
  await sp.goto(orgPath('en', orgId));
  await shot(sp, 'business-overview', 'Business overview before anything is done', 'Shows the unverified state and what to do next.');

  await gotoStep(sp, 'en', orgId, 1);
  await fillStep1(sp, 'en', { name: bizName, category: 'tailoring-apparel', registered: true });
  await shot(sp, 'onboarding-1', 'Onboarding step 1 of 5: name, category, registered or not');
  await sp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(sp).toHaveURL(/step=2$/);
  await sp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await shot(sp, 'onboarding-2-error', 'Step 2: required fields empty, a message explains', 'Validation on submit.');
  await fillStep2(sp, { ssm: '202001012345', businessType: 'sdn_bhd' });
  await shot(sp, 'onboarding-2', 'Onboarding step 2 of 5: SSM number and business type');
  await sp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(sp).toHaveURL(/step=3$/);
  await fillStep3(sp, { state: 'Selangor', district: 'Petaling', address: '12 Jalan Contoh Satu', postcode: '47301' });
  await shot(sp, 'onboarding-3', 'Onboarding step 3 of 5: location', 'The street address stays private.');
  await sp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(sp).toHaveURL(/step=4$/);
  await fillStep4(sp, { repName: 'Priya Seller', repRole: 'director' });
  await shot(sp, 'onboarding-4', 'Onboarding step 4 of 5: who represents the business');
  await sp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(sp).toHaveURL(/step=5$/);
  await shot(sp, 'onboarding-5', 'Onboarding step 5 of 5: three claims, each with its own upload');
  const slot = await uploadDoc(sp, 'en', 'business_registration', smallPdf('journey-ssm'));
  await expect(slot).toContainText(t('documents.received'));
  await shot(sp, 'upload-done', 'A document uploaded and scanned', 'Stored privately; shown as scanned clean.');
  await clickSend(sp, 'en', 'business_registration', { note: 'The SSM number is on the first page.' });
  await expect(sp).toHaveURL(/\/business\/verification\?sent=1$/);
  await shot(sp, 'claim-sent', 'After "Send for review": confirmation and status "submitted"');
  await sp.goto(orgPath('en', orgId, '/preview'));
  await shot(sp, 'preview-unreviewed', 'Preview of the public profile before review', 'Never shows the private address.');

  await sp.goto(orgPath('en', orgId, '/listing'));
  await sp.locator('#headline').fill('School and restaurant uniforms, made to order');
  await sp.locator('#description').fill('We stitch uniforms, aprons and polo shirts for schools, restaurants and shops across Selangor.');
  await sp.locator('#show_phone').check();
  await sp.locator('#public_phone').fill('+60 3 9999 0000');
  await sp.locator('#svc_name_0').fill(`Custom uniforms ${tag}`);
  await sp.locator('#svc_cat_0').selectOption('tailoring-apparel');
  await shot(sp, 'listing-editor', 'Public listing editor (filled in)', 'Headline, description, contact choices and the services offered.');
  await sp.getByRole('button', { name: t('listing.save'), exact: true }).click();
  await expect(sp.getByText(t('listing.saved'))).toBeVisible();
  await shot(sp, 'listing-saved', 'Listing saved (draft)');
  await sp.getByRole('button', { name: t('listing.send'), exact: true }).click();
  await expect(sp.getByRole('heading', { name: t('listing.pendingTitle') })).toBeVisible();
  await shot(sp, 'listing-pending', 'Listing sent: waiting for MITRA review');

  // ------------------------------------------------------------------ 4. MITRA administrator review
  ch('4. MITRA administrator: verification and listing review');
  const adminCtx = await persona(browser);
  const ap = adminCtx.page;
  const admin: Admin = await createAdmin('admin_super', 'jr-adm');
  await actorGoto(ap, admin, '/en/admin/verification');
  await shot(ap, 'admin-verification-queue', 'Admin: verification queue', 'Admin sign-in needs a second step (authenticator code); done here before this screen.');
  const claimId = (await sql<{ id: string }>(`select id from public.verification_claims where org_id = $1 and claim_type = 'business_registration'`, [orgId]))[0]!.id;
  await ap.goto(`/en/admin/verification/${claimId}`);
  await shot(ap, 'admin-claim-detail', 'Admin: claim detail with the uploaded document and the owner\'s note');
  const start = ap.getByRole('button', { name: t('adminVer.startReview'), exact: true });
  if (await start.count()) await start.click();
  await ap.locator('#d-approve').check();
  await ap.locator('#reason').fill('Document matches the details given.');
  await shot(ap, 'admin-decision-form', 'Admin: decision form (approve) with a written reason');
  await ap.getByRole('button', { name: t('adminVer.saveDecision'), exact: true }).click();
  await expect(ap.locator('#reason')).toHaveCount(0);
  await shot(ap, 'admin-claim-decided', 'Admin: claim approved');
  await ap.goto('/en/admin/listings');
  await shot(ap, 'admin-listings', 'Admin: listings waiting for review');
  const row = ap.locator('tbody tr').filter({ hasText: bizName });
  await row.getByRole('link', { name: t('adminList.open') }).click();
  await expect(ap.getByRole('heading', { level: 1 })).toHaveText(bizName);
  await shot(ap, 'admin-listing-detail', 'Admin: listing review page', 'The private street address is not shown to the reviewer.');
  await ap.locator('#dec-approve').check();
  await ap.getByRole('button', { name: t('adminList.save'), exact: true }).click();
  await expect(ap.getByText(t('adminList.nothingPending'))).toBeVisible();
  await shot(ap, 'admin-listing-approved', 'Admin: listing approved, queue empty');
  for (const [p, slug, title] of [['/en/admin/users', 'admin-users', 'Admin: users and roles'], ['/en/admin/audit', 'admin-audit', 'Admin: audit log (append-only)'], ['/en/admin/reports', 'admin-reports', 'Admin: reports and moderation'], ['/en/admin/reviews', 'admin-reviews', 'Admin: business review moderation']] as const) {
    await ap.goto(p);
    await shot(ap, slug, title);
  }

  // ------------------------------------------------------------------ 5. Buyer: directory, request wizard, matching
  ch('5. Buyer: find a business, post a request, invite, enquiry');
  await a.goto('/en/directory');
  await a.locator('#q').fill(tag);
  await a.getByRole('button', { name: t('dir.search'), exact: true }).click();
  await expect(a.locator('li.card').filter({ hasText: bizName })).toBeVisible();
  await shot(a, 'directory-result', 'Directory search finds the approved business', 'Shows what MITRA reviewed and what it did not.');
  await a.locator('li.card').filter({ hasText: bizName }).getByRole('link', { name: bizName }).click();
  await shot(a, 'public-profile', 'Public business profile');

  const buyer = await createUser('jr-buyer', { name: 'Anand Buyer' });
  const b = await persona(browser);
  const bp = b.page;
  await bp.goto('/en/login');
  await bp.locator('#email').fill('wrong@example.test');
  await bp.locator('#password').fill('wrong-password-123');
  await bp.locator('main form button[type=submit]').click();
  await bp.waitForLoadState('networkidle');
  await shot(bp, 'login-error', 'Login with a wrong password: a message, no detail about which part was wrong');
  await loginUi(bp, buyer, 'en');
  await shot(bp, 'home-signed-in', 'Home page when signed in');
  await bp.goto('/en/requests/new');
  await shot(bp, 'request-1', 'Request wizard step 1 of 5: title and category');
  await bp.locator('#title').fill(`100 school polo shirts ${tag}`);
  await bp.locator('#category_slug').selectOption('tailoring-apparel');
  await bp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(bp).toHaveURL(/step=2&id=/);
  await bp.locator('#target_state').selectOption('Selangor');
  await bp.locator('#target_district').fill('Subang Jaya');
  await shot(bp, 'request-2', 'Request wizard step 2: where');
  await bp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(bp).toHaveURL(/step=3&id=/);
  await bp.locator('#quantity').fill('100');
  await bp.locator('#unit').fill('pcs');
  await bp.locator('#needed_by').fill(inDays(21));
  await shot(bp, 'request-3', 'Request wizard step 3: quantity and date');
  await bp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(bp).toHaveURL(/step=4&id=/);
  await bp.locator('#description').fill('Black polo shirts with an embroidered school badge, mixed sizes, delivered to Subang Jaya.');
  await bp.locator('#contact_phone').fill('0123456789');
  await bp.locator('#share_contact').check();
  await shot(bp, 'request-4', 'Request wizard step 4: details and contact choice');
  await bp.getByRole('button', { name: t('ob.next'), exact: true }).click();
  await expect(bp).toHaveURL(/step=5&id=/);
  await shot(bp, 'request-5', 'Request wizard step 5: review before sending');
  await bp.getByRole('button', { name: t('req.s5.send'), exact: true }).click();
  await expect(bp).toHaveURL(/\/requests\/[0-9a-f-]{36}\?sent=1/);
  const requestId = bp.url().match(/requests\/([0-9a-f-]{36})/)![1]!;
  await shot(bp, 'request-sent', 'Request sent: matched businesses with the reasons why', 'Each match explains itself (serves the state, minimum order OK, and so on).');
  const match = bp.locator('[data-testid=match-card]').filter({ hasText: bizName });
  await match.getByRole('button', { name: t('match.invite'), exact: true }).click();
  await expect(bp.locator('[data-testid=match-card]').filter({ hasText: bizName })).toContainText(t('match.status.invited'));
  await shot(bp, 'request-invited', 'Buyer invited the business to respond');

  // seller side
  await sp.goto(orgPath('en', orgId, '/requests'));
  await shot(sp, 'seller-inbox', 'Seller: request inbox with the new invitation');
  await sp.locator('[data-testid=inbox-row]').filter({ hasText: '100 school polo shirts' }).getByRole('link').first().click();
  await expect(sp.locator('#note-i')).toBeVisible();
  await shot(sp, 'seller-request-detail', 'Seller: request detail', 'The buyer\'s phone number is hidden until the seller replies.');
  await sp.locator('#note-i').fill('We can do this in three weeks.');
  await sp.getByRole('button', { name: t('inbox.interested'), exact: true }).click();
  await expect(sp.getByRole('link', { name: t('match.openEnquiry') })).toBeVisible();
  await shot(sp, 'seller-replied', 'Seller replied "interested": contact now shared, enquiry opened');

  // conversation + quotation
  await bp.goto(`/en/requests/${requestId}`);
  await bp.locator('[data-testid=match-card]').filter({ hasText: bizName }).getByRole('link', { name: t('match.openEnquiry') }).click();
  await expect(bp).toHaveURL(/\/enquiries\/[0-9a-f-]{36}/);
  const enquiryUrl = new URL(bp.url()).pathname;
  await shot(bp, 'enquiry-buyer', 'Enquiry conversation (buyer view)');
  await sp.goto(enquiryUrl);
  await sp.locator('#reply-body').fill('Thank you. We can supply 100 polo shirts in black.');
  await sp.getByRole('button', { name: t('p4.sendReply') }).click();
  await shot(sp, 'enquiry-seller-reply', 'Seller posts a message in the enquiry');
  await sp.locator('#scope').fill('100 black polo shirts with embroidered badge');
  await sp.locator('#description1').fill('Polo shirts');
  await sp.locator('#quantity1').fill('100');
  await sp.locator('#unit1').fill('pieces');
  await sp.locator('#unitPrice1').fill('18.50');
  await sp.locator('#validUntil').fill(inDays(7));
  await sp.locator('#deliveryTiming').fill('Within three weeks');
  await fillBookingTerms(sp);
  await sp.locator('#taxTreatment').fill('Tax included as stated');
  await shot(sp, 'quote-form', 'Seller: quotation form (filled in)');
  await sp.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(sp.locator('main')).toContainText('MYR 1850.00');
  await shot(sp, 'quote-draft', 'Seller: draft quotation with the calculated total');
  await sp.getByRole('button', { name: t('p4.sendQuote') }).click();
  await shot(sp, 'quote-sent', 'Seller: quotation sent (immutable version 1)');
  await bp.reload();
  await shot(bp, 'quote-buyer-view', 'Buyer: sees the quotation');
  await bp.locator('#revision-reason').fill('Please add 10 extra shirts.');
  await bp.getByRole('button', { name: t('p4.requestChange') }).click();
  await shot(bp, 'quote-change-requested', 'Buyer asks for a change');
  await sp.reload();
  await sp.locator('#scope').fill('110 black polo shirts with embroidered badge');
  await sp.locator('#description1').fill('Polo shirts');
  await sp.locator('#quantity1').fill('110');
  await sp.locator('#unit1').fill('pieces');
  await sp.locator('#unitPrice1').fill('18.50');
  await sp.locator('#validUntil').fill(inDays(7));
  await sp.locator('#deliveryTiming').fill('Within three weeks');
  await fillBookingTerms(sp);
  await sp.locator('#taxTreatment').fill('Tax included as stated');
  await sp.getByRole('button', { name: t('p4.saveDraft') }).click();
  await expect(sp.locator('main')).toContainText('MYR 2035.00');
  await sp.getByRole('button', { name: t('p4.sendQuote') }).click();
  await sp.waitForTimeout(1500);
  await bp.reload();
  await expect(bp.getByText('Version 2')).toBeVisible();
  await shot(bp, 'quote-v2', 'Buyer: version 2 of the quotation');
  await bp.getByRole('button', { name: t('p4.accept') }).click();
  await expect(bp.getByText(t('p4.selectedNotice'))).toBeVisible();
  await shot(bp, 'quote-accepted', 'Buyer selects the quotation', 'No payment happens on the platform.');
  await sp.goto(orgPath('en', orgId, '/leads'));
  await shot(sp, 'seller-leads', 'Seller: leads board');
  await bp.goto('/en/requests');
  await shot(bp, 'buyer-requests', 'Buyer: my requests');
  await bp.goto('/en/notifications');
  await shot(bp, 'notifications', 'Notifications list');

  // ------------------------------------------------------------------ 6. Products from India (Phase 5)
  ch('6. Products from India: partner, supplier, catalogue, Request Price');
  const reviewer = await makeReviewer();
  const cp = await createPartner({ approve: true, prefix: 'jr-partner' });
  const mp = { user: cp.owner, org: cp.orgId, s: { client: cp.owner.client, user: cp.owner } } as unknown as Awaited<ReturnType<typeof makePartner>>;
  const sup = await makeSupplier(mp, reviewer, { name: `Kumar Textiles ${tag}` });
  const prod = await makeProduct(sup, reviewer, { name: `Cotton saree ${tag}`, moq: 10, image: true, variants: [{ sku: 'RED', label: 'Red' }] });
  const prod2 = await makeProduct(sup, reviewer, { name: `Cotton towel ${tag}`, moq: 20, currency: 'USD', mode: 'fixed', unitPrice: '4.00' });
  await a.goto(`/en/catalogue?q=${tag}`);
  await shot(a, 'catalogue-results', 'Catalogue search results');
  await a.goto(`/en/catalogue/${prod.id}`);
  await shot(a, 'catalogue-product', 'Product page: price tiers, minimum order, variants, availability dates');
  await a.goto(`/en/catalogue?q=${tag}`);
  await a.waitForLoadState('networkidle');
  await a.locator(`[data-product-id="${prod.id}"]`).locator(`#cmp-${prod.id}`).check();
  await a.locator(`[data-product-id="${prod2.id}"]`).locator(`#cmp-${prod2.id}`).check();
  await shot(a, 'catalogue-compare-tray', 'Two products ticked for comparison (tray at the bottom)');
  await a.getByRole('link', { name: t('p5buyer.compare.open'), exact: true }).click();
  await shot(a, 'catalogue-compare', 'Compare page: side by side, no currency conversion');
  await bp.goto(`/en/catalogue/${prod.id}`);
  await bp.getByRole('button', { name: new RegExp(t('p5buyer.save.save')) }).first().click().catch(() => undefined);
  await bp.goto(`/en/catalogue/${prod.id}/request`);
  await shot(bp, 'request-price-form', 'Request Price form');
  await bp.locator('#quantity').fill('30');
  await bp.locator('#destinationState').selectOption('Selangor');
  await bp.locator('#destinationCity').fill('Shah Alam');
  await bp.locator('#neededBy').fill(inDays(30));
  await bp.locator('#notes').fill('Please quote for the red colour, packed per 10.');
  await bp.getByRole('button', { name: t('p5buyer.request.submit'), exact: true }).click();
  await bp.waitForLoadState('networkidle');
  await shot(bp, 'request-price-sent', 'Request Price sent', 'A stored request with a snapshot of the terms the buyer saw.');
  await bp.goto('/en/catalogue/saved');
  await shot(bp, 'catalogue-saved', 'Saved products');
  await bp.goto('/en/catalogue/requests');
  await shot(bp, 'catalogue-my-requests', 'My product requests');
  const pctx = await persona(browser);
  for (const [p, slug, title] of [
    ['', 'partner-home', 'Partner dashboard home'],
    ['/suppliers', 'partner-suppliers', 'Partner: suppliers'],
    [`/suppliers/${sup.id}`, 'partner-supplier-detail', 'Partner: supplier detail and review status'],
    [`/suppliers/${sup.id}/edit?step=1`, 'partner-supplier-wizard', 'Partner: supplier wizard (step 1)'],
    ['/products', 'partner-products', 'Partner: products'],
    ['/import', 'partner-import', 'Partner: import catalogue (CSV or XLSX)'],
    ['/requests', 'partner-requests', 'Partner: buyer requests'],
    ['/notifications', 'partner-notifications', 'Partner: notifications'],
    ['/settings', 'partner-settings', 'Partner: settings'],
  ] as const) {
    await actorGoto(pctx.page, cp.owner, `/en/orgs/${cp.orgId}/partner${p}`, { login: p === '' });
    await shot(pctx.page, slug, title);
  }
  for (const [p, slug, title] of [
    ['/en/admin/catalogue', 'admin-catalogue-home', 'Admin: catalogue overview'],
    ['/en/admin/catalogue/partners', 'admin-catalogue-partners', 'Admin: partners'],
    ['/en/admin/catalogue/suppliers', 'admin-catalogue-suppliers', 'Admin: supplier review'],
    ['/en/admin/catalogue/products', 'admin-catalogue-products', 'Admin: product review'],
    ['/en/admin/catalogue/reports', 'admin-catalogue-reports', 'Admin: product reports'],
    ['/en/admin/catalogue/imports', 'admin-catalogue-imports', 'Admin: import totals'],
  ] as const) {
    await ap.goto(p);
    await shot(ap, slug, title);
  }

  // ------------------------------------------------------------------ 7. Business help (Phase 7)
  ch('7. Business help: government programmes');
  const fixtures = path.join(platformDir, 'tests', 'fixtures', 'tekun');
  const real = extractTekunScheme({
    schemeHtml: fs.readFileSync(path.join(fixtures, 'skim-pembangunan-usahawan-masyarakat-india-spumi.html'), 'utf8'),
    schemeUrl: 'https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi/',
    conditionsHtml: fs.readFileSync(path.join(fixtures, 'skim-pembangunan-usahawan-masyarakat-india-spumi-syarat-syarat.html'), 'utf8'),
  }).candidate;
  await sql(`update public.gov_settings set enabled = true where key in ('publishing_enabled')`);
  const agency = (await sql<{ id: string }>(`insert into public.gov_agencies(code,name,domain) values ($1,'TEKUN Nasional (saved page copy)','tekun.gov.my') returning id`, [`JR${tag.slice(-6).toUpperCase()}`]))[0]!.id;
  const sourceId = (await sql<{ id: string }>(
    `insert into public.gov_sources(agency_id,name,source_type,adapter,allowed_hosts,approved_urls,enabled,freshness_hours) values ($1,$2,'website','tekun','{www.tekun.gov.my,tekunonline.tekun.gov.my}','{https://www.tekun.gov.my/a/}',false,48) returning id`,
    [agency, `Journey source ${tag}`],
  ))[0]!.id;
  const publish = async (key: string, cand: Record<string, unknown>) => {
    await serviceClient().rpc('gov_submit_candidate', { p_source: sourceId, p_result: null, p_external_key: key, p_candidate: cand });
    const pid = (await sql<{ id: string }>(`select id from public.gov_change_proposals where source_id = $1 and external_key = $2 and status = 'pending'`, [sourceId, key]))[0]!.id;
    await call(admin.client, 'gov_decide_proposal', { p_proposal: pid, p_decision: 'approve', p_reason: 'checked against the saved official page' });
    return (await sql<{ slug: string }>(`select slug from public.gov_programmes where source_id = $1 and external_key = $2`, [sourceId, key]))[0]!.slug;
  };
  // Queue one for the admin screens before publishing the others.
  await serviceClient().rpc('gov_submit_candidate', { p_source: sourceId, p_result: null, p_external_key: `queue-${tag}`, p_candidate: { name: `Queued scheme ${tag}`, description: 'Waiting for review.', funding_type: 'training', info_url: 'https://www.tekun.gov.my/q/', application_status: 'unknown', extraction_status: 'complete', rules: [] } });
  const slug = await publish(`spumi-${tag}`, { ...real, name: `SPUMI ${tag}` });
  const openSlug = await publish(`online-${tag}`, { name: `Online scheme ${tag}`, description: 'Synthetic programme with an online channel.', funding_type: 'grant', amount_max: '20000', currency: 'MYR', application_channel: 'online', application_url: 'https://tekunonline.tekun.gov.my/login', info_url: 'https://www.tekun.gov.my/online/', application_status: 'open', extraction_status: 'complete', rules: [{ field: 'employees_max', op: 'lte', value: 5, quote: 'Maksimum 5 pekerja' }] });
  await sql(`update public.gov_programmes set last_checked_at = now() where source_id = $1`, [sourceId]);

  await a.goto('/en/business-help/find?need=financing');
  await shot(a, 'help-find-visitor', 'Find help (visitor): programmes listed, matching needs a sign-in');
  await a.goto(`/en/business-help/${slug}`);
  await shot(a, 'help-detail', 'Programme page: INOK summary apart from the agency\'s own words (original language), how to apply');
  await a.goto(`/en/business-help/${openSlug}`);
  await shot(a, 'help-detail-online', 'Programme page with an online channel and the official application link');
  await loginUi(sp, { email: ownerEmail, password: ownerPw }, 'en');
  await sp.goto('/en/business-help/find?need=financing');
  await shot(sp, 'help-find-before-answers', 'Signed-in owner: before answering, matches say "more information needed"');
  await sp.locator('#gp-registration').selectOption('registered');
  await sp.locator('#gp-community').selectOption('indian');
  await sp.locator('#gp-citizenship').selectOption('malaysian');
  await sp.locator('#gp-age').fill('40');
  await shot(sp, 'help-answers-form', 'Questions about the business (all optional; sensitive ones are explained)');
  await sp.getByRole('button', { name: t('gov.find.save') }).click();
  await expect(sp.getByText(t('gov.find.saved'))).toBeVisible();
  await shot(sp, 'help-matched', 'After saving: "Potential match" with an explanation');
  await sp.goto(`/en/business-help/${slug}`);
  await shot(sp, 'help-detail-match', 'Programme page with the explained match: what fits, what only the agency can assess');
  await sp.goto('/en/business-help/find?need=financing');
  await sp.locator(`[data-programme="${slug}"]`).getByRole('button', { name: new RegExp(t('gov.card.save')) }).click();
  await sp.waitForLoadState('networkidle');
  await sp.goto('/en/business-help/saved');
  await shot(sp, 'help-saved', 'Saved opportunities with self-reported tracking');
  const saved = sp.locator(`[data-programme="${slug}"]`);
  await saved.locator('select[name=tracking_status]').selectOption('applied_externally');
  await saved.locator('input[name=applied_on]').fill(inDays(-3));
  await saved.getByRole('button', { name: t('gov.saved.update') }).click();
  await expect(saved.getByText(t('gov.saved.updated'))).toBeVisible();
  await shot(sp, 'help-tracking-updated', 'Tracking updated: "Applied on the official channel"');
  await sp.goto('/en/business-help/settings');
  await sp.locator('#gs-email').check();
  await sp.locator('#gs-freq').selectOption('daily');
  await sp.getByRole('button', { name: t('gov.settings.save') }).click();
  await expect(sp.getByText(t('gov.settings.saved'))).toBeVisible();
  await shot(sp, 'help-settings', 'Notification settings saved');
  await actorGoto(ap, admin, '/en/admin/business-help', { login: false });
  await shot(ap, 'help-admin-home', 'Admin: switches, source health, review queue, programmes');
  const item = ap.locator('[data-proposal]').filter({ hasText: `Queued scheme ${tag}` });
  await item.getByRole('link', { name: new RegExp(t('gov.admin.review')) }).click();
  await shot(ap, 'help-admin-review', 'Admin: review a proposed programme (data, before/after, evidence, reason required)');
  const form = ap.locator('form').filter({ has: ap.locator('input[name=decision][value=approve]') });
  await form.locator('input[name=reason]').fill('checked against the official page');
  await form.getByRole('button', { name: t('gov.admin.approve') }).click();
  await ap.waitForLoadState('networkidle');
  await shot(ap, 'help-admin-approved', 'Admin: proposal approved and published');
  for (const L of ['ta', 'ms'] as const) {
    await a.goto(`/${L}/business-help`);
    await shot(a, `help-home-${L}`, `Business help home in ${L === 'ta' ? 'Tamil' : 'Bahasa Melayu'}`, 'Machine-assisted text; needs native review.');
    await a.goto(`/${L}/business-help/${slug}`);
    await shot(a, `help-detail-${L}`, `Programme page in ${L === 'ta' ? 'Tamil' : 'Bahasa Melayu'}`, 'The agency\'s own text is never re-translated.');
  }
  await sql(`update public.gov_settings set enabled = false where key in ('publishing_enabled')`);
  void createOrgAs; void createOrgUi; void createBusinessOwner;
  void (null as unknown as TestUser);
});
