import { expect, test } from '@playwright/test';
import { Agent, cover, finding, inDays } from './harness';
import { def } from './personas';
import { getData, persona, setData } from './store';
import { lit, remoteRows, remoteSql } from '../hosted/support';
import { next, t } from './ui';
import { fillBookingTerms } from '../e2e/support/deals-ui';

// The coordinated scenario: Buyer A posts a request, the seller independently receives it and answers, they negotiate a quotation
// (draft, send, revision request, revision, accept), both verify status/messages/notifications, and Buyer B (an outsider) is refused.
test.describe.configure({ mode: 'serial' });
const SELLER = def('seller').orgName!;
const TITLE = `100 school polo shirts (agent ${new Date().toISOString().slice(5, 16).replace(/\D/g, '')})`;

test('Buyer A posts a request and invites the seller', async ({ browser }) => {
  test.setTimeout(600_000);
  // Start from a clean slate: a buyer may hold only 5 open requests, and an earlier run's accepted enquiry would block a new negotiation.
  remoteSql(`update public.buyer_requests set status = 'closed' where buyer_org_id = ${lit(persona('buyerA').orgId!)} and status::text = 'open'`);
  const b = await Agent.create(browser, 'buyerA');
  await b.login();
  await b.must('request', 'five-step request form: validation on step 1 then complete', async () => {
    await b.goto('/en/requests/new');
    await next(b.page).click(); // empty: must stay and explain
    await expect(b.page).toHaveURL(/requests\/new/);
    await b.page.locator('#title').fill(TITLE);
    await b.page.locator('#category_slug').selectOption('tailoring-apparel');
    await next(b.page).click();
    await expect(b.page).toHaveURL(/step=2&id=/);
    await b.page.locator('#target_state').selectOption('Selangor');
    await b.page.locator('#target_district').fill('Subang Jaya');
    await next(b.page).click();
    await expect(b.page).toHaveURL(/step=3&id=/);
    await b.page.locator('#quantity').fill('100');
    await b.page.locator('#unit').fill('pcs');
    await b.page.locator('#needed_by').fill(inDays(21));
    await next(b.page).click();
    await expect(b.page).toHaveURL(/step=4&id=/);
    await b.page.locator('#description').fill('Black polo shirts with an embroidered badge, mixed sizes (synthetic agent test).');
    await b.page.locator('#contact_phone').fill('0120000000');
    await b.page.locator('#share_contact').check();
    await next(b.page).click();
    await expect(b.page).toHaveURL(/step=5&id=/);
    await b.page.getByRole('button', { name: t('req.s5.send'), exact: true }).click();
    const limited = b.page.getByText(/already have \d+ open requests/i);
    await Promise.race([b.page.waitForURL(/\/requests\/[0-9a-f-]{36}\?sent=1/), limited.waitFor()]);
    if (await limited.count()) {
      // Designed limit (5 open requests per buyer) reached by repeated runs: record it and carry on with the newest open request.
      cover('request', 'open-request limit (5) is enforced with a clear message', 'pass');
      const id = remoteRows<{ id: string }>(`select id from public.buyer_requests where buyer_org_id = ${lit(persona('buyerA').orgId!)} and status::text = 'open' order by created_at desc limit 1`)[0]!.id;
      setData('requestId', id);
      await b.goto(`/en/requests/${id}`);
    } else setData('requestId', b.page.url().match(/requests\/([0-9a-f-]{36})/)![1]!);
  });
  await b.must('request', 'matching lists the approved seller and Buyer A invites it', async () => {
    const card = b.page.locator('[data-testid=match-card]').filter({ hasText: SELLER });
    await expect(card).toBeVisible();
    if (await card.getByRole('button', { name: t('match.invite'), exact: true }).count()) await card.getByRole('button', { name: t('match.invite'), exact: true }).click();
    await expect(b.page.locator('[data-testid=match-card]').filter({ hasText: SELLER })).toContainText(/invited|interested|reply/i);
  });
  await b.page.getByRole('heading', { level: 1 }).first().innerText().then((h) => setData('requestTitle', h.trim()));
  await b.check('request', 'duplicate: reloading the request page does not create a second invitation', async () => {
    await b.page.reload();
    await expect(b.page.locator('[data-testid=match-card]').filter({ hasText: SELLER })).toHaveCount(1);
  });
  await b.a11y('a11y', 'request detail with matches');
  await b.close();
  void finding;
});

test('Seller receives it independently, expresses interest and quotes; Buyer A negotiates and accepts', async ({ browser }) => {
  test.setTimeout(900_000);
  const s = await Agent.create(browser, 'seller');
  const b = await Agent.create(browser, 'buyerA');
  await s.login();
  await b.login();
  const orgId = (await import('./store')).persona('seller').orgId!;

  // AGENT_REUSE_ENQUIRY=<id> resumes the negotiation on an existing enquiry (a buyer may post only 10 requests a day, so reruns cannot always start a new one).
  const reuse = process.env.AGENT_REUSE_ENQUIRY;
  if (!reuse) await s.must('quotation', 'seller sees the invitation in the request inbox and shows interest', async () => {
    await s.goto(`/en/orgs/${orgId}/business/requests`);
    const row = s.page.getByText(getData('requestTitle') ?? /100 school polo shirts/).first();
    await expect(row).toBeVisible();
    await row.click();
    if (await s.page.locator('#note-i').count()) await s.page.locator('#note-i').fill('We can do this in three weeks.');
    const interested = s.page.getByRole('button', { name: /interested/i });
    await interested.or(s.page.getByRole('button', { name: /send quotation/i })).first().waitFor();
    if (await interested.count()) await interested.click();
    await s.page.waitForLoadState('networkidle'); // the drawer closes and the lead moves to Talking
    
  });
  let url = reuse ? `/en/enquiries/${reuse}` : '';
  if (reuse) setData('enquiryUrl', url);
  if (!reuse) await b.must('quotation', 'Buyer A sees the seller interest and opens the enquiry', async () => {
    await b.goto(`/en/requests/${getData('requestId')}`);
    await b.page.locator('[data-testid=match-card]').filter({ hasText: SELLER }).getByRole('link', { name: t('match.openEnquiry') }).click();
    await expect(b.page).toHaveURL(/\/enquiries\/[0-9a-f-]{36}/);
    url = new URL(b.page.url()).pathname;
    setData('enquiryUrl', url);
  });
  const fill = async (scope: string, qty: string, price: string) => {
    await s.page.locator('#scope').fill(scope);
    await s.page.locator('#description1').fill('Polo shirts');
    await s.page.locator('#quantity1').fill(qty);
    await s.page.locator('#unit1').fill('pieces');
    await s.page.locator('#unitPrice1').fill(price);
    await s.page.locator('#validUntil').fill(inDays(7));
    await s.page.locator('#deliveryTiming').fill('Within three weeks');
    await fillBookingTerms(s.page);
    await s.page.locator('#taxTreatment').fill('Tax included as stated');
    await s.page.getByRole('button', { name: t('p4.saveDraft') }).click();
  };
  await s.must('quotation', 'seller replies in the enquiry thread and drafts a quotation (total computed)', async () => {
    await s.goto(url);
    await s.page.locator('#reply-body').fill('Thank you. We can supply 100 polo shirts in black.');
    await s.page.getByRole('button', { name: t('p4.sendReply') }).click();
    await expect(s.page.locator('main')).toContainText('We can supply 100 polo shirts');
    await fill('100 black polo shirts', '100', '18.50');
    await expect(s.page.locator('main')).toContainText('MYR 1850.00');
  });
  await s.check('quotation', 'invalid quotation input (negative price) is refused', async () => {
    await s.page.locator('#unitPrice1').fill('-5');
    await s.page.getByRole('button', { name: t('p4.saveDraft') }).click();
    await expect(s.page.locator('main')).not.toContainText('MYR -500.00');
    await s.page.locator('#unitPrice1').fill('18.50');
    await s.page.getByRole('button', { name: t('p4.saveDraft') }).click();
    // Let the save finish and the page refresh before sending (clicking Send while the save is still in flight is a stale-version race, not a defect).
    await s.page.waitForLoadState('networkidle');
    await expect(s.page.locator('main').last()).toContainText('MYR 1850.00');
  });
  await s.must('quotation', 'seller sends the quotation', async () => {
    await s.page.waitForLoadState('networkidle');
    await s.page.waitForTimeout(1500); // let the page re-render with the saved draft version before pressing Send
    await s.page.getByRole('button', { name: t('p4.sendQuote') }).click();
    await s.page.waitForLoadState('networkidle');
    if (await s.page.getByText(/someone changed this item/i).count()) {
      finding({ id: 'UX-QUOTE-STALE', sev: 'P2', cat: 'application', area: 'quotations', title: 'Send quotation fails with "Someone changed this item" after saving the draft twice without reloading', steps: 'Seller opens enquiry, saves a quotation draft, saves it again (e.g. after a correction), presses Send quotation without reloading', expected: 'The quotation is sent (the form should carry the latest draft version)', actual: 'Error: Someone changed this item while you were reading it. Reload the page and check again. A reload then allows sending.' });
      await s.page.reload();
      await s.page.getByRole('button', { name: t('p4.sendQuote') }).click();
      await s.page.waitForLoadState('networkidle');
    }
    await expect(s.page.getByText(/someone changed this item/i)).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: t('p4.sendQuote') })).toHaveCount(0);
  });
  await b.must('quotation', 'Buyer A reads the quotation and asks for a change', async () => {
    await b.goto(url);
    await expect(b.page.locator('main')).toContainText('MYR 1850.00');
    await b.page.locator('#revision-reason').fill('Please add 10 extra shirts.');
    await b.page.getByRole('button', { name: t('p4.requestChange') }).click();
    await expect(b.page.locator('main')).toContainText('Please add 10 extra shirts.');
  });
  await s.must('quotation', 'seller sees the change request and sends version 2', async () => {
    await s.goto(url);
    await expect(s.page.locator('main')).toContainText('Please add 10 extra shirts.');
    await fill('110 black polo shirts', '110', '18.50');
    await expect(s.page.locator('main')).toContainText('MYR 2035.00');
    await s.page.getByRole('button', { name: t('p4.sendQuote') }).click();
  });
  await b.must('quotation', 'Buyer A sees version 2 and accepts it', async () => {
    await b.goto(url);
    await expect(b.page.getByText('Version 2')).toBeVisible();
    await b.page.getByRole('button', { name: t('p4.accept') }).click();
    await expect(b.page.getByText(t('p4.selectedNotice'))).toBeVisible();
  });
  await s.check('quotation', 'seller independently sees the accepted status and the lead', async () => {
    await s.goto(url);
    await expect(s.page.locator('main')).toContainText(/accepted|selected/i);
    await s.goto(`/en/orgs/${orgId}/business/leads`);
    await expect(s.page.locator('main')).toContainText(TITLE.slice(0, 20));
  });
  await b.check('quotation', 'an accepted quotation cannot be accepted or changed again', async () => {
    await b.goto(url);
    await expect(b.page.getByRole('button', { name: t('p4.accept') })).toHaveCount(0);
    await expect(b.page.getByRole('button', { name: t('p4.requestChange') })).toHaveCount(0);
  });
  await b.check('notifications', 'Buyer A notifications page lists seller activity', async () => {
    await b.goto('/en/notifications');
    await expect(b.page.locator('main')).not.toContainText(/error/i);
    cover('notifications', 'in-app notification text after quotation events', 'observed', (await b.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200));
  });
  await s.check('notifications', 'seller notifications page lists buyer activity', async () => {
    await s.goto('/en/notifications');
    await expect(s.page.locator('main')).not.toContainText(/error/i);
  });
  cover('notifications', 'email notification of quotation events', 'disabled', 'No mail provider on staging; in-app notifications only');
  await s.close();
  await b.close();
});

test('Buyer B (outsider) cannot see Buyer A\'s request, enquiry, quotation or messages', async ({ browser }) => {
  test.setTimeout(400_000);
  const o = await Agent.create(browser, 'buyerB');
  await o.login();
  const url = getData('enquiryUrl')!;
  const rid = getData('requestId')!;
  await o.must('isolation', 'Buyer B is refused the enquiry page', async () => {
    const r = await o.goto(url, false);
    const txt = await o.page.locator('main').innerText().catch(() => '');
    expect(txt).not.toContain('MYR 2035.00');
    expect(txt).not.toContain('We can supply 100 polo shirts');
    expect(txt).not.toContain('Please add 10 extra shirts');
    cover('isolation', 'enquiry page for Buyer B shows', 'observed', `${r!.status()} ${txt.replace(/\s+/g, ' ').slice(0, 80)}`);
  });
  await o.must('isolation', 'Buyer B is refused the request page and its quotes list', async () => {
    for (const p of [`/en/requests/${rid}`, `/en/requests/${rid}/quotes`]) {
      await o.goto(p, false);
      const txt = await o.page.locator('main').innerText().catch(() => '');
      expect(txt).not.toContain(TITLE.slice(0, 20));
      expect(txt).not.toContain('MYR');
    }
  });
  await o.check('isolation', 'Buyer B own request list does not include Buyer A requests', async () => {
    await o.goto('/en/requests');
    await expect(o.page.locator('main')).not.toContainText(TITLE.slice(0, 20));
  });
  await o.check('isolation', 'Buyer B enquiries list is empty of Buyer A threads', async () => {
    await o.goto('/en/enquiries');
    await expect(o.page.locator('main')).not.toContainText('polo shirts');
  });
  await o.close();
});
