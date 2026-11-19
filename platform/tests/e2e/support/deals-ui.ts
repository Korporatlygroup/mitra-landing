import { expect, type Page } from '@playwright/test';
import { msg } from './i18n';

/** Strings of the conversation workspace (namespace "deals"). */
export const dl = (key: string, locale: 'en' | 'ms' | 'ta' = 'en') => msg(locale, `deals.${key}`);

/** The quotation editor lives in a dialog opened from the composer. */
export async function openQuoteEditor(page: Page, locale: 'en' | 'ms' | 'ta' = 'en'): Promise<void> {
  const btn = page.getByRole('button', { name: new RegExp(`^(${dl('createQuote', locale)}|${dl('editQuote', locale)})$`) });
  await expect(btn).toBeVisible();
  await page.waitForLoadState('networkidle');
  await btn.click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Opens the collapsible details panel (closed on phones) and then one of its sections by its summary text. */
export async function openPanelSection(page: Page, summaryText?: string, locale: 'en' | 'ms' | 'ta' = 'en'): Promise<void> {
  const show = page.getByRole('button', { name: dl('showDetails', locale), exact: true });
  await page.waitForLoadState('networkidle');
  if (await show.isVisible()) await show.click();
  if (summaryText) await page.locator('.deal-more > summary', { hasText: summaryText }).first().click();
}

/** The buyer's "request changes" form is inside a collapsed block on the quotation card. */
export async function requestChanges(page: Page, reason: string): Promise<void> {
  await page.locator('.qcard-actions summary', { hasText: dl('requestChanges') }).click();
  await page.locator('#revision-reason').fill(reason);
  await page.locator('.qcard-actions details form').getByRole('button').click();
}
