import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { sql } from './support/db';
import { msg } from './support/i18n';
import { checkPage, createPartner, createReviewer, loginPartner, partnerPath, seedProduct, seedSupplier, type Partner, type SupplierSeed } from './support/p5';
import type { Locale } from './support/ui';

// E52: catalogue import. Synthetic files built here: 10 rows of which 7 are valid and 3 invalid (exact row numbers are checked), the rejected-rows
// download, fix and upload again, confirm, history, the same file again (idempotent), updating needs an explicit confirmation, formulas, wrong type.

const t = (k: string, v?: Record<string, string>) => msg('en', k, v);
const main = (page: Page) => page.locator('main');
const TODAY = new Date().toISOString().slice(0, 10);
const HEAD = 'supplier_code,sku,name,category,description,unit,moq,currency,price,specifications,lead_time_days,availability_date,status';

interface R {
  sku: string;
  name?: string;
  price?: string;
  moq?: string;
  currency?: string;
}
function csv(code: string, rows: R[]): { name: string; mimeType: string; buffer: Buffer } {
  const lines = rows.map((r) =>
    [code, r.sku, r.name ?? `Product ${r.sku}`, 'textiles-apparel', 'A synthetic product for the import test.', 'piece', r.moq ?? '10', r.currency ?? 'INR', r.price ?? '25.50', 'Material: cotton', '7', TODAY, 'draft'].join(','),
  );
  return { name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from([HEAD, ...lines].join('\r\n') + '\r\n', 'utf8') };
}
/** Ten rows. `bad` lists 1-based data rows that are wrong (spreadsheet row = data row + 1). */
const tenRows = (prefix: string, bad: number[] = [], suffix = ''): R[] =>
  Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    const sku = `${prefix}-${String(n).padStart(2, '0')}`;
    if (!bad.includes(n)) return { sku, name: `Item ${n}${suffix}` };
    return n === bad[0] ? { sku, price: 'abc' } : n === bad[1] ? { sku, moq: '0' } : { sku, currency: 'EUR' };
  });

/** An xlsx whose Products sheet holds a real formula cell. */
function xlsxWithFormula() {
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>sku</t></is></c></row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return { name: 'formula.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(zipSync(files)) };
}

async function openImport(page: Page, p: Partner, locale: Locale = 'en') {
  await page.goto(partnerPath(locale, p.orgId, '/import'));
  await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
}
async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, mode: 'create_only' | 'create_or_update' = 'create_only') {
  await page.locator(mode === 'create_only' ? '#mode-create' : '#mode-update').check();
  await page.locator('#file').setInputFiles(file);
  await main(page).getByRole('button', { name: t('p5partner.import.upload'), exact: true }).click();
}
const jobsOf = (orgId: string) => sql<{ id: string; status: string; mode: string }>(`select id, status, mode from public.import_jobs where partner_org_id = $1 order by created_at`, [orgId]);

test('E52 import: 10 rows (7 fine, 3 wrong), rejected rows, fix and upload again, confirm, history, same file again, updating needs confirmation', async ({ page, request }) => {
  test.setTimeout(300_000);
  const p = await createPartner('e52a');
  const reviewer = await createReviewer('e52a-rev');
  const sup: SupplierSeed = await seedSupplier(p, reviewer, { name: 'Import Supplier' });
  await loginPartner(page, p, 'en', '/import');
  await expect(main(page).getByRole('heading', { name: t('p5partner.import.title'), level: 1 })).toBeVisible();
  await checkPage(page, 'import start');

  // templates (CSV and Excel)
  for (const [fmt, type] of [['csv', 'text/csv'], ['xlsx', 'spreadsheetml']] as const) {
    const href = await main(page).getByRole('link', { name: t(fmt === 'csv' ? 'p5partner.import.downloadCsv' : 'p5partner.import.downloadXlsx') }).getAttribute('href');
    const r = await page.context().request.get(href!);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain(type);
    expect(r.headers()['content-disposition']).toContain(`template.${fmt}`);
    const body = await r.body();
    if (fmt === 'csv') expect(body.toString('utf8')).toContain('supplier_code');
    else expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
  }
  void request;

  // wrong file type and a formula cell: clear message, nothing stored
  await upload(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(main(page).getByRole('alert').filter({ hasText: t('p5partner.import.fileErrors.import_unsupported_file') })).toBeVisible();
  await upload(page, xlsxWithFormula());
  await expect(main(page).getByRole('alert').filter({ hasText: 'Formulas are not accepted' })).toBeVisible();
  expect(await jobsOf(p.orgId)).toHaveLength(0);

  // the 10-row file: 7 fine, 3 wrong (spreadsheet rows 4, 7 and 10)
  await upload(page, csv(sup.code, tenRows('IMP', [3, 6, 9])));
  await expect(page).toHaveURL(new RegExp(`/partner/import/[0-9a-f-]{36}$`));
  const job1 = page.url().split('/').pop()!;
  await expect(main(page).getByTestId('count-total')).toHaveText('10');
  await expect(main(page).getByTestId('count-valid')).toHaveText('7');
  await expect(main(page).getByTestId('count-invalid')).toHaveText('3');
  const rows = main(page).getByTestId('import-row');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-row')))).toEqual(['4', '7', '10']);
  // translated messages, never codes
  const text = (await main(page).getByTestId('import-rows').innerText()).toLowerCase();
  expect(text).not.toMatch(/decimal_invalid|moq_not_positive|currency_invalid|client_validation_failed/);
  await expect(main(page).getByTestId('import-rows')).toContainText(/plain number|more than 0|INR, MYR or USD/);
  await checkPage(page, 'import preview with problems');
  const jobs = await jobsOf(p.orgId);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ id: job1, status: 'previewed', mode: 'create_only' });
  expect(await sql(`select 1 from public.products where partner_org_id = $1`, [p.orgId])).toHaveLength(0);

  // rejected rows
  const href = await main(page).getByTestId('download-rejected').getAttribute('href');
  const rej = await page.context().request.get(href!);
  expect(rej.status()).toBe(200);
  expect(rej.headers()['content-type']).toContain('text/csv');
  const rejText = (await rej.body()).toString('utf8');
  expect(rejText).toContain('IMP-03');
  expect(rejText).toContain('IMP-06');
  expect(rejText).toContain('IMP-09');
  expect(rejText).not.toContain('IMP-01');
  expect(rejText.split('\r\n').filter(Boolean)).toHaveLength(4);

  // confirming a file with problems is allowed: only the 7 good rows are added; but first fix and upload again
  await openImport(page, p);
  await upload(page, csv(sup.code, tenRows('IMP')));
  await expect(page).toHaveURL(new RegExp(`/partner/import/[0-9a-f-]{36}$`));
  const job2 = page.url().split('/').pop()!;
  expect(job2).not.toBe(job1);
  await expect(main(page).getByTestId('count-valid')).toHaveText('10');
  await expect(main(page).getByTestId('count-invalid')).toHaveText('0');
  await expect(main(page).getByTestId('overwrite-box')).toHaveCount(0);
  await main(page).getByRole('button', { name: t('p5partner.import.confirmButton', { n: '10' }), exact: true }).click();
  await expect(main(page).getByTestId('import-result')).toBeVisible();
  await expect(main(page).getByTestId('import-result')).toContainText('10 products were added as drafts');
  await checkPage(page, 'import result');
  const prods = await sql<{ status: string }>(`select status from public.products where partner_org_id = $1`, [p.orgId]);
  expect(prods).toHaveLength(10);
  expect(new Set(prods.map((x) => x.status))).toEqual(new Set(['draft']));
  expect((await jobsOf(p.orgId)).map((j) => j.status)).toEqual(['previewed', 'committed']);
  // money kept as exact decimals
  const d = (await sql<{ draft: { unit_price: string } }>(`select draft from public.products where partner_org_id = $1 and sku = 'IMP-01'`, [p.orgId]))[0]!;
  expect(d.draft.unit_price).toBe('25.50');

  // the same file again returns the same job (nothing added twice)
  await openImport(page, p);
  await upload(page, csv(sup.code, tenRows('IMP')));
  await expect(page).toHaveURL(new RegExp(`/partner/import/${job2}$`));
  await expect(main(page).getByTestId('import-result')).toBeVisible();
  expect(await jobsOf(p.orgId)).toHaveLength(2);
  expect(await sql(`select 1 from public.products where partner_org_id = $1`, [p.orgId])).toHaveLength(10);

  // history: both jobs, and an earlier job with its row problems
  await openImport(page, p);
  await expect(main(page).getByTestId('import-job')).toHaveCount(2);
  await expect(main(page).getByTestId('import-history')).toContainText(t('p5common.status.import.committed'));
  await checkPage(page, 'import history');
  await main(page).getByRole('link', { name: 'catalogue.csv' }).last().click();
  await expect(main(page).getByTestId('import-row').first()).toBeVisible();

  // updating existing drafts needs an explicit confirmation
  await openImport(page, p);
  await upload(page, csv(sup.code, tenRows('IMP', [], ' renamed')), 'create_or_update');
  await expect(page).toHaveURL(new RegExp(`/partner/import/[0-9a-f-]{36}$`));
  await expect(main(page).getByTestId('overwrite-box')).toBeVisible();
  await checkPage(page, 'import preview (update mode)');
  await main(page).getByRole('button', { name: t('p5partner.import.confirmButton', { n: '10' }), exact: true }).click();
  await expect(main(page).getByRole('alert').filter({ hasText: t('errors.overwrite_confirmation_required') })).toBeVisible();
  expect((await sql<{ draft: { name: string } }>(`select draft from public.products where partner_org_id = $1 and sku = 'IMP-01'`, [p.orgId]))[0]!.draft.name).toBe('Item 1');
  await page.locator('#confirmOverwrite').check();
  await main(page).getByRole('button', { name: t('p5partner.import.confirmButton', { n: '10' }), exact: true }).click();
  await expect(main(page).getByTestId('import-result')).toBeVisible();
  expect((await sql<{ draft: { name: string } }>(`select draft from public.products where partner_org_id = $1 and sku = 'IMP-01'`, [p.orgId]))[0]!.draft.name).toBe('Item 1 renamed');
  expect(await sql(`select 1 from public.products where partner_org_id = $1`, [p.orgId])).toHaveLength(10);
  expect((await sql(`select 1 from public.products where partner_org_id = $1 and status <> 'draft'`, [p.orgId]))).toHaveLength(0);
});

test('E52 import: a supplier code from the example row, a text cell starting with =, and a viewer who cannot import', async ({ page }) => {
  test.setTimeout(180_000);
  const p = await createPartner('e52b');
  const reviewer = await createReviewer('e52b-rev');
  const sup = await seedSupplier(p, reviewer, { name: 'Second Import Supplier' });
  await loginPartner(page, p, 'en', '/import');
  const bad = csv('EXAMPLE-DELETE-ME', [{ sku: 'EX-1' }]);
  await upload(page, bad);
  await expect(page).toHaveURL(/\/partner\/import\/[0-9a-f-]{36}$/);
  await expect(main(page).getByTestId('import-failed')).toBeVisible();
  await expect(main(page).getByTestId('import-rows')).toContainText(t('p5partner.import.errors.client_validation_failed'));
  await expect(main(page).getByTestId('import-commit')).toHaveCount(0);

  await openImport(page, p);
  const f = csv(sup.code, [{ sku: 'F-1', name: '=HYPERLINK("http://example.test")' }, { sku: 'F-2' }]);
  await upload(page, f);
  await expect(main(page).getByTestId('count-valid')).toHaveText('1');
  await expect(main(page).getByTestId('count-invalid')).toHaveText('1');
  await expect(main(page).getByTestId('import-rows')).toContainText(t('p5partner.import.errors.client_validation_failed'));

  const v = await createPartner('e52v', { managerRole: 'viewer' });
  await page.context().clearCookies();
  await loginPartner(page, v, 'en', '/import');
  await expect(main(page).getByText(t('p5partner.import.readOnly'))).toBeVisible();
  void seedProduct;
});

for (const locale of ['ta', 'ms'] as Locale[]) {
  test(`E52 ${locale}: import screens are in the language, errors are translated, axe passes`, async ({ page }) => {
    test.setTimeout(180_000);
    const p = await createPartner(`e52${locale}`, { language: locale });
    const reviewer = await createReviewer(`e52${locale}-rev`);
    const sup = await seedSupplier(p, reviewer, { name: `Import ${locale}` });
    const T = (k: string, v?: Record<string, string>) => msg(locale, k, v);
    await loginPartner(page, p, locale, '/import');
    await expect(main(page).getByRole('heading', { name: T('p5partner.import.title'), level: 1 })).toBeVisible();
    await checkPage(page, `import ${locale}`);
    await page.locator('#file').setInputFiles(csv(sup.code, tenRows(`L${locale.toUpperCase()}`, [3, 6, 9])));
    await main(page).getByRole('button', { name: T('p5partner.import.upload'), exact: true }).click();
    await expect(page).toHaveURL(/\/partner\/import\/[0-9a-f-]{36}$/);
    await expect(main(page).getByRole('heading', { name: T('p5partner.import.previewTitle'), level: 1 })).toBeVisible();
    await expect(main(page).getByTestId('count-valid')).toHaveText('7');
    expect((await main(page).getByTestId('import-rows').innerText())).not.toMatch(/decimal_invalid|moq_not_positive|currency_invalid/);
    await checkPage(page, `import preview ${locale}`);
  });
}
