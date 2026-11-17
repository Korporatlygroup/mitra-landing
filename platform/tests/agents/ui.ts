import { expect, type Locator, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { msg } from '../e2e/support/i18n';
import { cover } from './harness';

// UI-only helpers ported from tests/e2e/support/biz.ts (that module needs a direct database connection, which hosted projects do not give).
export const t = (key: string, vars?: Record<string, string>) => msg('en', key, vars);
export type ClaimType = 'business_registration' | 'business_location' | 'representative_authority';
export interface UploadFile { name: string; mimeType: string; buffer: Buffer }

export function smallPdf(tag: string): UploadFile {
  const body = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${tag} ${randomBytes(8).toString('hex')}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
  return { name: `${tag}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(body, 'latin1') };
}

export const bizPath = (orgId: string, tail = '') => `/en/orgs/${orgId}/business${tail}`;
export const partnerPath = (orgId: string, tail = '') => `/en/orgs/${orgId}/partner${tail}`;
const main = (p: Page) => p.locator('main');
export const next = (p: Page) => main(p).getByRole('button', { name: t('ob.next'), exact: true });

export function claimSection(page: Page, ct: ClaimType): Locator {
  return page.locator('section.card').filter({ has: page.locator(`#claim-${ct}`) });
}

/** Creates an organisation through the real form; returns its id. */
export async function createOrgViaUi(page: Page, type: 'buyer' | 'business' | 'partner', name: string): Promise<string> {
  await page.goto('/en/orgs/new');
  await page.locator(`#type-${type}`).check();
  await page.locator('#name').fill(name);
  await page.locator('main form button[type=submit]').click();
  await page.waitForURL(/\/orgs\/[0-9a-f-]{36}\//, { timeout: 40_000 });
  return page.url().match(/orgs\/([0-9a-f-]{36})/)![1]!;
}

export async function uploadClaimDoc(page: Page, ct: ClaimType, file: UploadFile): Promise<string> {
  const section = claimSection(page, ct);
  const form = section.locator('form').filter({ has: page.locator(`#file-${ct}`) });
  await page.waitForLoadState('networkidle');
  await section.locator(`#file-${ct}`).setInputFiles(file);
  const resp = page.waitForResponse((r) => r.request().method() === 'POST');
  await form.getByRole('button', { name: t('ob.s5.upload'), exact: true }).click();
  await resp;
  await page.waitForLoadState('networkidle');
  return (await form.locator('.form-message-slot').innerText().catch(() => '')).trim();
}

export async function expectNoRawKeys(page: Page): Promise<void> {
  const mains = await page.locator('main').count();
  if (mains > 1) cover('a11y', `single main landmark: ${new URL(page.url()).pathname}`, 'fail', `${mains} <main> elements on one page`);
  const text = await page.locator('main').last().innerText();
  expect(text).not.toMatch(/MISSING_MESSAGE|undefined|\[object Object\]|NaN/);
}
