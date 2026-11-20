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

/** A date `n` days from now as YYYY-MM-DD (Asia/Kuala_Lumpur, like the database check). */
export const daysAhead = (n: number): string => new Date(Date.now() + 8 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

/** Fills the booking terms that every quotation must carry before it can be sent (date, deposit expectation, cancellation). */
export async function fillBookingTerms(page: Page, o: { date?: string; finishBy?: string; deposit?: string; option?: 'free_7d' | 'deposit_kept' | 'no_cancel' | 'custom'; custom?: string } = {}): Promise<void> {
  await page.locator('#bookingDate').fill(o.date ?? daysAhead(21));
  if (o.finishBy !== undefined) await page.locator('#completionBy').fill(o.finishBy);
  await page.locator('#depositTerms').fill(o.deposit ?? 'No deposit');
  await page.locator('#cancellationOption').selectOption(o.option ?? 'free_7d');
  if (o.custom) await page.locator('#cancellationText').fill(o.custom);
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
