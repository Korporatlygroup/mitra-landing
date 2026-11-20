import AxeBuilder from '@axe-core/playwright';
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createReviewer, reviewerGoto } from '../e2e/support/biz';
import { createOrgAs, createUser, signedClient, sql, type TestUser } from '../e2e/support/db';
import { seedDemo } from '../e2e/support/demo-seed';
import { loginUi } from '../e2e/support/ui';

// UX AUDIT (local stack only). Visits the route inventory as each kind of user, in en/ms/ta, at 360/390/768/1280/1440 px, and records objective problems:
// failed or erroring pages, sideways scroll, missing or duplicate h1, empty title, untranslated message keys on screen, images without alt, links or
// buttons with no accessible name, tap targets under 40 px on phones, console/page errors and serious or critical axe findings.
// It only reports; it never changes data beyond the demo seed and one synthetic agreement. Output: tests/audit/out/audit.json
const WIDTHS = [360, 390, 768, 1280, 1440];
const OUT = process.env.AUDIT_OUT ? path.resolve(process.env.AUDIT_OUT) : path.join(import.meta.dirname, 'out');
const ONLY = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null;
type Role = 'anon' | 'seller' | 'buyer' | 'partner' | 'admin' | 'newbie';
interface Visit { role: Role; route: string; lang: string; status: number | null; finalUrl: string; problems: string[]; overflow: Record<number, number>; small: number; axe: string[] }
const results: Visit[] = [];

const KEY_LIKE = /(?<![\w./@-])(?:[a-z][a-zA-Z0-9]*)\.(?:[a-z][a-zA-Z0-9_]*\.)*[a-z][a-zA-Z0-9_]*(?![\w@-])/g;
const NOT_KEYS = /^(?:e\.g|i\.e|etc|www|inok|org|com|my|gov|net|png|jpg|pdf|js|css|html|co|ssm|no|vs|a\.m|p\.m|sdn|bhd|w\.p)\b/i;

async function inspect(page: Page, role: Role, route: string, lang: string, withAxe: boolean): Promise<void> {
  const v: Visit = { role, route, lang, status: null, finalUrl: '', problems: [], overflow: {}, small: 0, axe: [] };
  const errors: string[] = [];
  const onErr = (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); };
  const onPage = (e: Error) => errors.push(`pageerror: ${e.message.slice(0, 160)}`);
  page.on('console', onErr); page.on('pageerror', onPage);
  try {
    await page.setViewportSize({ width: 390, height: 800 });
    const resp = await page.goto(route, { waitUntil: 'load', timeout: 45_000 });
    v.status = resp?.status() ?? null;
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    v.finalUrl = new URL(page.url()).pathname;
    if (v.status && v.status >= 400) v.problems.push(`HTTP ${v.status}`);
    const info = await page.evaluate(() => {
      const vis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const name = (el: Element) => (el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLElement).innerText || el.querySelector('img')?.getAttribute('alt') || '').trim();
      const h1 = Array.from(document.querySelectorAll('h1')).filter(vis);
      const imgs = Array.from(document.images).filter((i) => vis(i) && !i.hasAttribute('alt') && i.getAttribute('role') !== 'presentation');
      const noName = Array.from(document.querySelectorAll('a[href],button')).filter((e) => vis(e) && !name(e)).map((e) => e.outerHTML.slice(0, 90));
      const text = (document.querySelector('main') as HTMLElement | null)?.innerText ?? document.body.innerText;
      return { h1: h1.length, title: document.title.trim(), imgs: imgs.length, noName: noName.slice(0, 3), text: text.slice(0, 20000), lang: document.documentElement.lang };
    });
    if (info.h1 !== 1) v.problems.push(`${info.h1} visible h1`);
    if (!info.title) v.problems.push('empty <title>');
    if (info.imgs) v.problems.push(`${info.imgs} images without alt`);
    if (info.noName.length) v.problems.push(`unnamed controls: ${info.noName.join(' ')}`);
    const keys = Array.from(new Set((info.text.match(KEY_LIKE) ?? []).filter((k) => !NOT_KEYS.test(k) && /[A-Z_]|^(deals|p4|p5|p6|p7|rd|adm|adminList|ob|nav|ws|dir|enq|req|errors|listing|rep|home)\./.test(k)))).slice(0, 4);
    if (keys.length) v.problems.push(`possible untranslated keys: ${keys.join(', ')}`);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(60);
      v.overflow[w] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (v.overflow[w]! > 1) v.problems.push(`sideways scroll ${v.overflow[w]}px at ${w}`);
      if (w === 360) {
        v.small = await page.evaluate(() => Array.from(document.querySelectorAll('a[href],button,select,input:not([type=hidden]),textarea,summary')).filter((e) => {
          const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e as HTMLElement);
          if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') return false;
          if (e.closest('p,li,dd,td,span.mut') && e.tagName === 'A' && getComputedStyle(e).display === 'inline') return false; // inline text links are exempt
          return r.height < 36 || r.width < 36;
        }).length);
      }
    }
    if (process.env.AUDIT_SHOTS) {
      const slug = (role + '-' + route.replace(/^\/(en|ms|ta)/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'id').replace(/[^a-z0-9]+/gi, '_')).slice(0, 70);
      fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
      for (const w of lang === 'en' ? [390, 1280] : [390]) { await page.setViewportSize({ width: w, height: 800 }); await page.screenshot({ path: path.join(OUT, 'shots', slug + '__' + lang + '__' + w + '.png'), fullPage: true }); }
    }
    if (withAxe) {
      await page.setViewportSize({ width: 360, height: 800 });
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      v.axe = r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id} x${x.nodes.length}`);
    }
  } catch (e) {
    v.problems.push(`navigation failed: ${String((e as Error).message).slice(0, 120)}`);
  }
  if (errors.length) v.problems.push(`console: ${Array.from(new Set(errors)).slice(0, 2).join(' | ')}`);
  page.off('console', onErr); page.off('pageerror', onPage);
  results.push(v);
}

function flush(): void { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(results, null, 1)); }

async function sweep(page: Page, role: Role, routes: string[], langs = ['en', 'ms', 'ta']): Promise<void> {
  for (const r of routes) {
    for (const lang of langs) {
      const route = r === '' ? `/${lang}` : `/${lang}${r}`;
      if (ONLY && !ONLY.test(route)) continue;
      await inspect(page, role, route, lang, lang === 'en');
    }
    flush();
  }
}

async function ctxFor(browser: Browser, user: TestUser | null): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000', locale: 'en-US' });
  const page = await ctx.newPage();
  if (user) await loginUi(page, user, 'en');
  return { ctx, page };
}

test('UX audit', async ({ browser }) => {
  test.setTimeout(3_000_000);
  const demo = await seedDemo();
  const seller = demo.businesses[0]!;
  const buyer = demo.buyers[0]!;
  const partner = demo.partner;
  const slug = String((await sql<{ slug: string }>(`select slug from public.business_listings where org_id=$1`, [seller.orgId]))[0]?.slug ?? '');
  const product = demo.products[0]!;

  // one synthetic agreement with booking terms and an issue, so orders, deals and the admin list have real content
  const sc = (await signedClient(seller.owner)).client, bc = (await signedClient(buyer.user)).client;
  const enquiryId = String((await sql<{ id: string }>(`insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by) values($1,$2,'listing','Audit: 500 flyers',$1,$3) returning id`, [buyer.orgId, seller.orgId, buyer.user.id]))[0]!.id);
  await sc.rpc('post_enquiry_message', { p_enquiry: enquiryId, p_body: 'Yes, we can do that. Quotation coming.', p_key: 'audit-key-0001' });
  const day = (n: number) => new Date(Date.now() + 8 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const saved = await sc.rpc('save_quote_draft', { p_enquiry: enquiryId, p_draft: { currency: 'MYR', scope: '500 A5 flyers, full colour', exclusions: '', tax_treatment: 'No tax charged', delivery_timing: 'Within a week', terms: '', valid_until: `${day(7)}T23:59:59+08:00`, delivery_fee: '0.00', tax_amount: '0.00',
    lines: [{ description: 'A5 flyers', quantity: '500', unit: 'piece', unit_price: '0.40' }], booking_date: day(14), completion_by: '', deposit_terms: 'No deposit', cancellation_option: 'free_7d', cancellation_text: '' }, p_expected_version: 0 });
  const qid = String(saved.data);
  const sent = await sc.rpc('send_quote_version', { p_quotation: qid, p_expected_version: 0 });
  const qv = Number((await sql<{ v: number }>('select version v from public.quotations where id=$1', [qid]))[0]!.v);
  await bc.rpc('respond_to_quote', { p_quotation: qid, p_version: String(sent.data), p_action: 'accept', p_reason: null, p_expected_version: qv });
  const orderId = String((await sql<{ id: string }>('select id from public.orders where enquiry_id=$1', [enquiryId]))[0]?.id ?? '');
  if (orderId) { await sc.rpc('order_action', { p_order: orderId, p_action: 'start', p_note: null }); await bc.rpc('order_action', { p_order: orderId, p_action: 'dispute', p_note: '[not_delivered] Audit: nothing arrived' }); }

  const rfq = (await sql<{ id: string }>(`select id from public.sourcing_rfqs limit 1`).catch(() => []))[0]?.id;
  const breq = (await sql<{ id: string }>(`select id from public.buyer_requests limit 1`).catch(() => []))[0]?.id;

  // anonymous visitor
  { const { ctx, page } = await ctxFor(browser, null);
    await sweep(page, 'anon', ['', '/directory', slug ? `/directory/${slug}` : '/directory', '/directory?q=packaging', '/directory?q=zzzzzz', '/login', '/signup', '/forgot-password', '/news', '/business-help', '/business-help/find',
      '/catalogue', `/catalogue/${product.id}`, '/catalogue/compare', '/search?q=packaging', '/terms', '/privacy', '/cookies', '/complaints', '/marketplace-policy', '/government-disclaimer', '/list-your-business', '/sourcing', '/orders', '/deals']);
    await ctx.close(); }

  // brand-new user without a business
  { const u = await createUser('audit-newbie', { name: 'Audit Newbie' });
    const { ctx, page } = await ctxFor(browser, u);
    await sweep(page, 'newbie', ['', '/orgs/new', '/deals', '/notifications', '/account', '/directory']);
    await ctx.close(); }

  // seller
  { const { ctx, page } = await ctxFor(browser, seller.owner);
    const b = `/orgs/${seller.orgId}`;
    await sweep(page, 'seller', ['', '/deals', '/enquiries', `/enquiries/${enquiryId}`, '/orders', orderId ? `/orders/${orderId}` : '/orders', '/requests', '/sourcing', `${b}/business`, `${b}/business/360`, `${b}/business/listing`, `${b}/business/listing/preview`,
      `${b}/business/products`, `${b}/business/verification`, `${b}/business/onboarding`, `${b}/business/quickstart`, `${b}/business/leads`, `${b}/business/requests`, `${b}/business/requests/board`, `${b}/members`,
      '/notifications', '/account', '/business-help', '/business-help/find', '/business-help/saved', '/business-help/settings', '/news', '/catalogue/saved']);
    await ctx.close(); }

  // buyer
  { const { ctx, page } = await ctxFor(browser, buyer.user);
    await sweep(page, 'buyer', ['', '/deals', '/requests', '/requests/new', breq ? `/requests/${breq}` : '/requests', '/enquiries', `/enquiries/${enquiryId}`, '/orders', orderId ? `/orders/${orderId}` : '/orders', '/catalogue', `/catalogue/${product.id}/request`,
      '/catalogue/saved', '/catalogue/requests', '/sourcing', '/sourcing/new', rfq ? `/sourcing/${rfq}` : '/sourcing', '/notifications', '/account', '/directory']);
    await ctx.close(); }

  // supplier partner
  { const { ctx, page } = await ctxFor(browser, partner.user);
    const p = `/orgs/${partner.org}/partner`;
    await sweep(page, 'partner', [p, `${p}/products`, `${p}/products/new`, `${p}/suppliers`, `${p}/suppliers/new`, `${p}/requests`, `${p}/sourcing`, `${p}/settings`, `${p}/notifications`, `${p}/import`]);
    await ctx.close(); }

  // INOK staff
  { const rv = await createReviewer('admin_super', 'audit');
    const { ctx, page } = await ctxFor(browser, null);
    await reviewerGoto(page, rv, '/en/admin');
    await sweep(page, 'admin', ['/admin', '/admin/verification', '/admin/listings', `/admin/listings/${seller.orgId}`, '/admin/issues', '/admin/reviews', '/admin/reports', '/admin/products', '/admin/catalogue', '/admin/catalogue/suppliers', '/admin/catalogue/partners',
      '/admin/catalogue/products', '/admin/catalogue/imports', '/admin/catalogue/reports', '/admin/business-help', '/admin/business-help/sources', '/admin/business-help/page-changes', '/admin/news', '/admin/users', '/admin/audit', '/admin/privacy-requests', '/admin/duplicates', '/admin/sourcing']);
    await ctx.close(); }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(results, null, 1));
  void createOrgAs;
});
