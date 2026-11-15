import { expect, test } from '@playwright/test';
import { actorGoto, createAdmin } from './support/p5-admin';
import { createBusinessOwner } from './support/biz';
import { createUser, sql, uniq } from './support/db';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

// E91: a failed save must not throw away what the person typed. React resets uncontrolled fields after every form action, so the
// forms restore them. Each failure here is a REAL server refusal (the record changed under the person: stale_version), not a
// browser validation message.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const tag = uniq('r91').replace(/-/g, '');

test.describe.configure({ timeout: 240_000 });
test.skip(({ isMobile }) => isMobile, 'laptop journey');

test('shared ActionForm: a failed sign-in keeps the email and never restores the password', async ({ page }) => {
  const user = await createUser('r91-login', { name: 'Restore Login' });
  await page.goto('/en/login');
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill('definitely-not-the-password');
  await page.locator('main form button[type=submit]').click();
  await expect(page.locator('.form-message-slot')).toContainText(/\S/);
  await expect(page.locator('#email')).toHaveValue(user.email);
  await expect(page.locator('#password')).toHaveValue('');
});

test('news editor keeps every edited field after a refused save', async ({ page }) => {
  const editor = await createAdmin('admin_content', 'r91news');
  await actorGoto(page, editor, '/en/admin/news');
  await page.getByRole('link', { name: t('news2.admin.newPost'), exact: true }).first().click();
  await page.getByLabel(t('news2.admin.fTitle')).fill(`Restore news ${tag}`);
  await page.getByLabel(t('news2.admin.fSummary')).fill('A first summary that is long enough.');
  await page.getByLabel(t('news2.admin.fBody')).fill('The first body of the post, long enough to be saved.');
  await page.getByRole('button', { name: t('news2.admin.save'), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/news\/[0-9a-f-]{36}/);

  // Someone else saves the post first: this editor's next save is refused.
  await sql(`update public.news_posts set version = version + 1 where title = $1`, [`Restore news ${tag}`]);
  await page.getByLabel(t('news2.admin.fTitle')).fill(`Restore news ${tag} edited`);
  await page.getByLabel(t('news2.admin.fSummary')).fill('My changed summary, typed after the other person saved.');
  await page.getByLabel(t('news2.admin.fBody')).fill('My changed body text that must survive the refusal.');
  await page.getByLabel(t('news2.admin.fDeadline')).fill('2099-04-30');
  await page.getByRole('button', { name: t('news2.admin.save'), exact: true }).click();
  await expect(page.locator('.form-message-slot').filter({ hasText: /\S/ })).toBeVisible();
  await expect(page.getByLabel(t('news2.admin.fTitle'))).toHaveValue(`Restore news ${tag} edited`);
  await expect(page.getByLabel(t('news2.admin.fSummary'))).toHaveValue('My changed summary, typed after the other person saved.');
  await expect(page.getByLabel(t('news2.admin.fBody'))).toHaveValue('My changed body text that must survive the refusal.');
  await expect(page.getByLabel(t('news2.admin.fDeadline'))).toHaveValue('2099-04-30');
});

test('product form keeps the typed values; product review keeps the note and the choice', async ({ page }) => {
  const { owner, orgId } = await createBusinessOwner('r91p');
  const product = `Restore lamp ${tag}`;
  await loginUi(page, owner);
  await page.goto(`/en/orgs/${orgId}/business/products`);
  await page.getByRole('button', { name: t('biz2.products.add'), exact: true }).click();
  const add = page.getByRole('dialog', { name: t('biz2.products.drawerAdd') });
  await add.getByLabel(t('biz2.products.fName')).fill(product);
  await add.getByLabel(t('biz2.products.fPrice')).fill('12.00');
  await add.getByRole('button', { name: t('biz2.products.saveDraft') }).click();
  await expect(add).toHaveCount(0);

  // The record changes under the owner; the next save is refused and the typed values stay in the drawer.
  await page.getByRole('button', { name: new RegExp(product) }).click();
  const edit = page.getByRole('dialog', { name: t('biz2.products.drawerEdit') });
  await sql(`update public.biz_products set version = version + 1 where org_id = $1`, [orgId]);
  await edit.getByLabel(t('biz2.products.fName')).fill(`${product} renamed`);
  await edit.getByLabel(t('biz2.products.fPrice')).fill('13.75');
  await edit.getByRole('button', { name: t('biz2.products.saveDraft') }).click();
  await expect(edit.locator('.form-message-slot').filter({ hasText: /\S/ })).toBeVisible();
  await expect(edit.getByLabel(t('biz2.products.fName'))).toHaveValue(`${product} renamed`);
  await expect(edit.getByLabel(t('biz2.products.fPrice'))).toHaveValue('13.75');

  // Send it for review (after reopening so the version is current), then the reviewer's save is refused the same way.
  await page.reload();
  await page.getByRole('button', { name: new RegExp(product) }).click();
  await page.getByRole('dialog', { name: t('biz2.products.drawerEdit') }).getByRole('button', { name: t('biz2.products.submit') }).click();
  await expect(page.getByText(t('biz2.products.statusReview'), { exact: true }).first()).toBeVisible();

  const admin = await createAdmin('admin_review', 'r91rev');
  await actorGoto(page, admin, '/en/admin/products');
  await page.getByRole('button', { name: `${t('adm2.review')}: ${product}` }).click();
  const drawer = page.getByRole('dialog', { name: product });
  await drawer.getByText(t('adm2.products.changes'), { exact: true }).click();
  await drawer.locator('#pr-note').fill('Please add a clearer photo and the lamp size.');
  await sql(`update public.biz_products set version = version + 1 where org_id = $1`, [orgId]);
  await drawer.getByRole('button', { name: t('adm2.products.save') }).click();
  await expect(drawer.locator('.form-message-slot').filter({ hasText: /\S/ })).toBeVisible();
  await expect(drawer.locator('#pr-note')).toHaveValue('Please add a clearer photo and the lamp size.');
  await expect(drawer.getByRole('radio', { name: t('adm2.products.changes') })).toBeChecked();
});
