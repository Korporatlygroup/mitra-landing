import { expect, test } from '@playwright/test';
import { createUser, sql, uniq } from './support/db';
import { msg } from './support/i18n';
import { createOrgUi, expectNoHorizontalScroll, loginUi } from './support/ui';

// E2 (F2): create a business org and an individual-buyer org, then switch between them.
test('E2 user creates a business and a buyer organisation and switches between them', async ({ page }) => {
  const u = await createUser('e2');
  const bizName = `Biz ${uniq('b')}`;
  const buyerName = `Buyer ${uniq('p')}`;
  await loginUi(page, u);

  await expect(page.locator('main')).toContainText(msg('en', 'home.noOrgs'));
  const bizId = await createOrgUi(page, 'business', bizName);
  const buyerId = await createOrgUi(page, 'buyer', buyerName);
  expect(bizId).not.toBe(buyerId);

  const rows = await sql<{ type: string; name: string; role: string }>(
    `select o.type, o.name, m.role from public.organisations o join public.memberships m on m.org_id = o.id where m.user_id = $1 order by o.name`,
    [u.id],
  );
  expect(rows).toEqual(expect.arrayContaining([
    { type: 'business', name: bizName, role: 'owner' },
    { type: 'buyer', name: buyerName, role: 'owner' },
  ]));

  // /orgs lists both with their type and the owner role.
  await page.goto('/en/orgs');
  const bizCard = page.locator('li.card', { hasText: bizName });
  const buyerCard = page.locator('li.card', { hasText: buyerName });
  await expect(bizCard).toContainText(msg('en', 'orgTypes.business'));
  await expect(buyerCard).toContainText(msg('en', 'orgTypes.buyer'));
  await expect(bizCard).toContainText(msg('en', 'roles.owner'));
  await expectNoHorizontalScroll(page);

  // Open the first org, then use the switcher to move to the other: the active (aria-current) org changes.
  await bizCard.getByRole('link', { name: msg('en', 'orgs.members') }).click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${bizId}/members$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(bizName);
  const switcher = page.getByRole('navigation', { name: msg('en', 'orgs.switcherLabel') });
  await expect(switcher.getByRole('link', { name: bizName })).toHaveAttribute('aria-current', 'page');
  await expect(switcher.getByRole('link', { name: buyerName })).not.toHaveAttribute('aria-current', 'page');

  await switcher.getByRole('link', { name: buyerName }).click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${buyerId}/members$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(buyerName);
  await expect(page.locator('main')).toContainText(msg('en', 'orgTypes.buyer'));
  await expect(switcher.getByRole('link', { name: buyerName })).toHaveAttribute('aria-current', 'page');
  await expect(switcher.getByRole('link', { name: bizName })).not.toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);
});

test('E2 organisation name validation shows an error and keeps what was typed', async ({ page }) => {
  const u = await createUser('e2v');
  await loginUi(page, u);
  await page.goto('/en/orgs/new');
  await page.locator('#type-buyer').check();
  // Bypass native minlength so the server-side rule is what answers.
  await page.evaluate(() => ((document.querySelector('main form:has(#name)') as HTMLFormElement).noValidate = true));
  await page.locator('#name').fill('x');
  await page.locator('main form button[type=submit]').click();
  await expect(page.locator('main [role=alert]').filter({ hasText: msg('en', 'errors.invalid_name') }).or(page.locator('main [role=alert]').filter({ hasText: msg('en', 'errors.invalid_input') }))).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('x');
  await expect(page.locator('#type-buyer')).toBeChecked();
});
