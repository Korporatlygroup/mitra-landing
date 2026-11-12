import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { claimSection, clickSend, createBusinessOwner, docsOf, gotoStep, jpegWithMetadata, onboardUi, pdfOfSize, pngWithMetadata, smallPdf, uploadDoc, type UploadFile } from './support/biz';
import { EICAR, scanner } from './support/clamd-stub';
import { sql } from './support/db';
import { CRON_SECRET } from './support/env';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

const t = (k: string) => msg('en', k);
const CT = 'business_registration' as const;

async function rejectedCount(orgId: string, reason: string): Promise<number> {
  return Number(
    (await sql(`select count(*)::int as n from public.audit_log where action = 'verification.upload_rejected' and org_id = $1 and details->>'reason' = $2`, [orgId, reason]))[0]!.n,
  );
}

async function ready() {
  const { owner, orgId } = await createBusinessOwner('e23');
  return { owner, orgId };
}

// E23 (security): the upload pipeline refuses unsafe files and quarantines when the scanner is down.
test('E23 unsafe uploads are rejected with the right message, are never downloadable and leave an audit row', async ({ page }) => {
  test.setTimeout(240_000);
  const { owner, orgId } = await ready();
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);
  await gotoStep(page, 'en', orgId, 5);

  const exe: UploadFile = { name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90), Buffer.from('This program cannot be run in DOS mode')]) };
  const jsPdf: UploadFile = {
    name: 'active.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  };
  const obfuscated: UploadFile = {
    name: 'obf.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /AA << /S /J#61vaScript /JS (x) >> >>\nendobj\n%%EOF\n', 'latin1'),
  };
  const empty: UploadFile = { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) };
  const pngWithPdfBytes: UploadFile = { name: 'scan.png', mimeType: 'image/png', buffer: smallPdf().buffer };
  const wrongMime: UploadFile = { name: 'real.pdf', mimeType: 'image/png', buffer: smallPdf().buffer };
  const eicar: UploadFile = {
    name: 'virus.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% ${EICAR}\n%%EOF\n`, 'latin1'),
  };

  const riskyPdf = (token: string): UploadFile => ({
    name: `risky.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog ${token} >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`, 'latin1'),
  });
  const cases: { label: string; file: UploadFile; message: string; reason: string }[] = [
    { label: 'spoofed .pdf that is an executable', file: exe, message: t('errors.file_type_not_allowed'), reason: 'bad_type' },
    { label: 'PDF with /JavaScript', file: jsPdf, message: t('errors.file_unsafe_content'), reason: 'unsafe_content' },
    { label: 'PDF with obfuscated /J#61vaScript', file: obfuscated, message: t('errors.file_unsafe_content'), reason: 'unsafe_content' },
    { label: 'empty file', file: empty, message: t('errors.file_empty'), reason: 'empty' },
    { label: '.png holding PDF bytes', file: pngWithPdfBytes, message: t('errors.file_type_not_allowed'), reason: 'bad_type' },
    { label: 'PDF declared as image/png', file: wrongMime, message: t('errors.file_type_not_allowed'), reason: 'bad_type' },
    { label: 'EICAR test file', file: eicar, message: t('errors.file_infected'), reason: 'infected' },
    ...['/AA << /S /Named >>', '/GoToR << /F (x) >>', '/GoToE << /T 1 >>', '/SubmitForm << /F (x) >>', '/ImportData << /F (x) >>', '/XFA [ (a) (b) ]'].map((tok) => ({
      label: `PDF with ${tok.split(' ')[0]}`,
      file: riskyPdf(tok),
      message: t('errors.file_unsafe_content'),
      reason: 'unsafe_content',
    })),
    { label: 'truncated JPEG (malformed)', file: jpegWithMetadata({ truncated: true, name: 'cut.jpg' }), message: t('errors.file_unsafe_content'), reason: 'unsafe_content' },
    { label: 'PNG with a corrupt chunk CRC (malformed)', file: pngWithMetadata({ badCrc: true, name: 'bad.png' }), message: t('errors.file_unsafe_content'), reason: 'unsafe_content' },
  ];

  for (const c of cases) {
    const before = await rejectedCount(orgId, c.reason);
    const slot = await uploadDoc(page, 'en', CT, c.file);
    await expect(slot, c.label).toContainText(c.message);
    // The empty file is refused before any audit is possible without a file; every other case leaves a row.
    if (c.reason !== 'empty') expect(await rejectedCount(orgId, c.reason), `${c.label}: audit row`).toBe(before + 1);

    // Nothing downloadable: no download link, no clean row, and any stored row answers 404.
    await expect(claimSection(page, CT).getByRole('link', { name: t('documents.download') })).toHaveCount(0);
    const rows = await docsOf(orgId, CT);
    expect(rows.filter((r) => r.scan_status === 'clean' && !r.removed_at), `${c.label}: no clean document`).toHaveLength(0);
    for (const r of rows) expect((await page.request.get(`/api/v1/documents/${r.id}`)).status(), `${c.label}: download`).toBe(404);
  }
  expect(await rejectedCount(orgId, 'infected')).toBe(1);
});

async function sizeCase(page: import('@playwright/test').Page, bytes: number) {
  const { owner, orgId } = await ready();
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);
  await gotoStep(page, 'en', orgId, 5);
  const file = pdfOfSize(bytes, 'sized.pdf');
  const slot = await uploadDoc(page, 'en', CT, file);
  return { slot, orgId, file };
}

test('E23 a 9 MiB file is accepted and downloads identically', async ({ page }) => {
  test.setTimeout(180_000);
  const { slot, orgId, file } = await sizeCase(page, 9 * 1024 * 1024);
  await expect(slot).toContainText(t('documents.received'), { timeout: 60_000 });
  const rows = await docsOf(orgId, CT);
  expect(rows).toHaveLength(1);
  const res = await page.request.get(`/api/v1/documents/${rows[0]!.id}`);
  expect(res.status()).toBe(200);
  expect(createHash('sha256').update(await res.body()).digest('hex')).toBe(createHash('sha256').update(file.buffer).digest('hex'));
});

// Regression (was D3): the proxy used to truncate bodies at 10 MB, so a 10 MiB file failed with "Unexpected end of form".
test('E23 a file of exactly 10 MiB is accepted at the limit and downloads identically', async ({ page }) => {
  test.setTimeout(180_000);
  const { slot, orgId, file } = await sizeCase(page, 10 * 1024 * 1024);
  await expect(slot).toContainText(t('documents.received'), { timeout: 15_000 });
  const rows = await docsOf(orgId, CT);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.scan_status).toBe('clean');
  const res = await page.request.get(`/api/v1/documents/${rows[0]!.id}`);
  expect(res.status()).toBe(200);
  expect(createHash('sha256').update(await res.body()).digest('hex')).toBe(createHash('sha256').update(file.buffer).digest('hex'));
});

test('E23 a file of 10 MiB + 1 byte says "larger than 10 MB" and leaves an audit row', async ({ page }) => {
  test.setTimeout(180_000);
  const { slot, orgId } = await sizeCase(page, 10 * 1024 * 1024 + 1);
  await expect(slot).toContainText(t('errors.file_too_large'), { timeout: 15_000 });
  expect(await rejectedCount(orgId, 'too_large')).toBe(1);
  expect((await docsOf(orgId, CT)).filter((r) => !r.removed_at)).toHaveLength(0);
});

test('E23 scanner down: upload is quarantined, not downloadable, not sendable; rescan makes it clean', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { owner, orgId } = await ready();
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);
  await gotoStep(page, 'en', orgId, 5);

  await scanner.down();
  try {
    const file = smallPdf('quarantine');
    const slot = await uploadDoc(page, 'en', CT, file);
    await expect(slot).toContainText(t('documents.pendingScan'));
    await expect(claimSection(page, CT)).toContainText(t('documents.scanPending'));
    await expect(claimSection(page, CT).getByRole('link', { name: t('documents.download') })).toHaveCount(0);

    const rows = await docsOf(orgId, CT);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scan_status).toBe('pending');
    const id = rows[0]!.id;
    expect((await page.request.get(`/api/v1/documents/${id}`)).status()).toBe(404);

    // Send for review refuses documents that are not scanned yet.
    await clickSend(page, 'en', CT);
    await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.documents_not_ready') })).toBeVisible();
    expect((await sql(`select status from public.verification_claims where org_id = $1 and claim_type = $2`, [orgId, CT]))[0]!.status).toBe('draft');

    // Rescan endpoint: needs the cron secret.
    const none = await request.post('/api/v1/jobs/rescan');
    expect(none.status()).toBe(401);
    const wrong = await request.post('/api/v1/jobs/rescan', { headers: { authorization: 'Bearer not-the-secret' } });
    expect(wrong.status()).toBe(401);
    const odd = await request.post('/api/v1/jobs/rescan', { headers: { authorization: `Basic ${CRON_SECRET}` } });
    expect(odd.status()).toBe(401);
    // Still down: the document stays waiting.
    const stillDown = await request.post('/api/v1/jobs/rescan', { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(stillDown.status()).toBe(200);
    const downSummary = (await stillDown.json()) as Record<string, number | boolean>;
    expect(Object.keys(downSummary).sort()).toEqual(['checked', 'clean', 'infected', 'ok', 'product_media', 'remaining', 'supplier_documents', 'waiting']);
    expect(downSummary).toMatchObject({ ok: true, clean: 0, infected: 0 });
    expect(downSummary.checked).toBeGreaterThanOrEqual(1);
    expect(downSummary.waiting).toBeGreaterThanOrEqual(1);
    // An unscannable document is stamped "failed" (rotated to the back of the queue), never served, still retried.
    expect((await docsOf(orgId, CT))[0]!.scan_status).toBe('failed');
    expect((await page.request.get(`/api/v1/documents/${id}`)).status()).toBe(404);
    await gotoStep(page, 'en', orgId, 5);
    await expect(claimSection(page, CT)).toContainText(t('documents.scanFailed'));
    await expect(claimSection(page, CT).getByRole('link', { name: t('documents.download') })).toHaveCount(0);
    await clickSend(page, 'en', CT);
    await expect(page.locator('main [role=alert]').filter({ hasText: t('errors.documents_not_ready') })).toBeVisible();

    await scanner.up();
    const ok = await request.post('/api/v1/jobs/rescan', { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    const summary = (await ok.json()) as { ok: boolean; clean: number; remaining: number };
    expect(summary.ok).toBe(true);
    expect(summary.clean).toBeGreaterThanOrEqual(1);
    expect(summary.remaining).toBe(0);

    expect((await docsOf(orgId, CT))[0]!.scan_status).toBe('clean');
    const dl = await page.request.get(`/api/v1/documents/${id}`);
    expect(dl.status()).toBe(200);
    expect(createHash('sha256').update(await dl.body()).digest('hex')).toBe(createHash('sha256').update(file.buffer).digest('hex'));
    await gotoStep(page, 'en', orgId, 5);
    await expect(claimSection(page, CT)).toContainText(t('documents.scanClean'));
    await expect(claimSection(page, CT).getByRole('link', { name: t('documents.download') })).toBeVisible();

    // Now it can be sent.
    await clickSend(page, 'en', CT);
    await expect(page).toHaveURL(/\/verification\?sent=1$/);
  } finally {
    await scanner.up();
  }
});

test('E23 an infected result at rescan time is final: the document never becomes downloadable', async ({ page, request }) => {
  test.setTimeout(180_000);
  const { owner, orgId } = await ready();
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);
  await gotoStep(page, 'en', orgId, 5);
  await scanner.down();
  try {
    const virus: UploadFile = { name: 'late.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${EICAR}\n%%EOF\n`, 'latin1') };
    const slot = await uploadDoc(page, 'en', CT, virus);
    await expect(slot).toContainText(t('documents.pendingScan'));
    await scanner.up();
    const r = await request.post('/api/v1/jobs/rescan', { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(r.status()).toBe(200);
    const rows = await docsOf(orgId, CT);
    expect(rows[0]!.scan_status).toBe('infected');
    expect((await page.request.get(`/api/v1/documents/${rows[0]!.id}`)).status()).toBe(404);
    await gotoStep(page, 'en', orgId, 5);
    await expect(claimSection(page, CT)).toContainText(t('documents.scanInfected'));
    await expect(claimSection(page, CT).getByRole('link', { name: t('documents.download') })).toHaveCount(0);
  } finally {
    await scanner.up();
  }
});

test('E23 rescan processes at most 10 documents per call, reports remaining, and a second call finishes the rest', async ({ page, request }) => {
  test.setTimeout(300_000);
  const rescan = async () => {
    const r = await request.post('/api/v1/jobs/rescan', { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(r.status()).toBe(200);
    return (await r.json()) as { ok: boolean; checked: number; clean: number; infected: number; waiting: number; remaining: number };
  };
  // Baseline: nothing left over from earlier tests.
  for (let i = 0; i < 20 && (await rescan()).remaining > 0; i++);

  const { owner, orgId } = await ready();
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);
  await gotoStep(page, 'en', orgId, 5);
  await scanner.down();
  try {
    const plan: [typeof CT | 'business_location' | 'representative_authority', number][] = [
      ['business_registration', 5],
      ['business_location', 5],
      ['representative_authority', 2],
    ];
    for (const [ct, n] of plan) {
      for (let i = 0; i < n; i++) {
        const slot = await uploadDoc(page, 'en', ct, smallPdf(`batch-${ct}-${i}`));
        await expect(slot).toContainText(t('documents.pendingScan'));
      }
    }
    expect((await docsOf(orgId)).filter((d) => d.scan_status === 'pending')).toHaveLength(12);
  } finally {
    await scanner.up();
  }

  const first = await rescan();
  expect(first).toMatchObject({ ok: true, checked: 10, clean: 10, infected: 0, waiting: 0, remaining: 2 });
  expect((await docsOf(orgId)).filter((d) => d.scan_status === 'clean')).toHaveLength(10);
  const second = await rescan();
  expect(second).toMatchObject({ ok: true, checked: 2, clean: 2, infected: 0, waiting: 0, remaining: 0 });
  expect((await docsOf(orgId)).filter((d) => d.scan_status === 'clean')).toHaveLength(12);
  expect(await rescan()).toMatchObject({ checked: 0, remaining: 0 });
});
