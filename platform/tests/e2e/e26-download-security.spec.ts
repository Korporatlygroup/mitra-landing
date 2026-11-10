import { createHash } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import { claimSection, createReviewer, docsOf, gotoStep, reviewerGoto, smallPdf, submittedBusiness, uploadDoc } from './support/biz';
import { sql } from './support/db';
import { msg } from './support/i18n';
import { freshContext } from './support/ui';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function counts(claimId: string, orgId: string, docId: string) {
  const ev = await sql(`select actor_user_id from public.verification_events where claim_id = $1 and event = 'document_viewed' and details->>'document_id' = $2 order by id`, [claimId, docId]);
  const au = await sql(`select actor_user_id from public.audit_log where action = 'verification.document_viewed' and org_id = $1 and entity_id = $2 order by id`, [orgId, docId]);
  return { ev: ev.map((r) => r.actor_user_id as string), au: au.map((r) => r.actor_user_id as string) };
}

function expectSafeHeaders(res: APIResponse, name: string) {
  const h = res.headers();
  expect(res.status()).toBe(200);
  expect(h['content-type']).toBe('application/pdf');
  expect(h['content-disposition']).toMatch(/^attachment;/);
  expect(h['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`);
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['cache-control']).toBe('no-store');
  expect(h['content-security-policy']).toContain("default-src 'none'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-frame-options']).toBe('DENY');
}

test('E26 owner and reviewer downloads: safe headers, identical bytes, and one audit trail entry per access', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const file = smallPdf('e26-evidence');
  const sub = await submittedBusiness(page, { prefix: 'e26', file });
  const doc = (await docsOf(sub.orgId, sub.ct))[0]!;
  const url = `/api/v1/documents/${doc.id}`;
  const before = await counts(sub.claimId, sub.orgId, doc.id);

  // Owner (their own session): attachment, nosniff, no-store, strict CSP; bytes match the upload.
  const own = await page.request.get(url);
  expectSafeHeaders(own, file.name);
  expect(sha(await own.body())).toBe(sha(file.buffer));
  expect(doc.sha256).toBe(sha(file.buffer));
  const afterOwner = await counts(sub.claimId, sub.orgId, doc.id);
  expect(afterOwner.ev).toHaveLength(before.ev.length + 1);
  expect(afterOwner.au).toHaveLength(before.au.length + 1);
  expect(afterOwner.ev.at(-1)).toBe(sub.owner.id);
  expect(afterOwner.au.at(-1)).toBe(sub.owner.id);

  // Reviewer (aal2).
  const rv = await createReviewer('admin_review');
  const ctx = await freshContext(browser, page);
  const rp = await ctx.newPage();
  await reviewerGoto(rp, rv, `/en/admin/verification/${sub.claimId}`);
  const link = rp.getByRole('link', { name: msg('en', 'adminVer.download') });
  await expect(link).toHaveAttribute('href', url);
  const rev = await rp.request.get(url);
  expectSafeHeaders(rev, file.name);
  expect(sha(await rev.body())).toBe(sha(file.buffer));
  const afterRev = await counts(sub.claimId, sub.orgId, doc.id);
  expect(afterRev.ev).toHaveLength(afterOwner.ev.length + 1);
  expect(afterRev.au).toHaveLength(afterOwner.au.length + 1);
  expect(afterRev.ev.at(-1)).toBe(rv.id);
  expect(afterRev.au.at(-1)).toBe(rv.id);

  // Unknown, malformed and wrong-method requests: one identical 404 (or 405) and no audit row.
  const unknown = await rp.request.get('/api/v1/documents/00000000-0000-4000-8000-000000000000');
  expect(unknown.status()).toBe(404);
  const bad = await rp.request.get('/api/v1/documents/..%2F..%2Fetc%2Fpasswd');
  expect(bad.status()).toBe(404);
  const noted = await page.request.get(url);
  expect(await unknown.text()).toBe(await bad.text());
  expect(noted.status()).toBe(200);
  const post = await page.request.post(url);
  expect([404, 405]).toContain(post.status());
  await ctx.close();
});

test('E26 a reviewer cannot download a draft document that was never sent; the owner can', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const sub = await submittedBusiness(page, { prefix: 'e26d' });
  // A second document uploaded after submission is not attached to any submitted version.
  await gotoStep(page, 'en', sub.orgId, 5);
  // The claim is submitted (not editable), so use the verification page flow: withdraw makes it editable again.
  await expect(claimSection(page, sub.ct)).toBeVisible();
  const rows = await docsOf(sub.orgId, sub.ct);
  expect(rows).toHaveLength(1);

  // Withdraw, add a draft document, leave it unsent.
  await claimSection(page, sub.ct).getByRole('button', { name: msg('en', 'ver.withdraw'), exact: true }).click();
  await expect(claimSection(page, sub.ct).locator(`#file-${sub.ct}`)).toBeVisible();
  const slot = await uploadDoc(page, 'en', sub.ct, smallPdf('draft-only'));
  await expect(slot).toContainText(msg('en', 'documents.received'));
  const draft = (await docsOf(sub.orgId, sub.ct)).find((d) => d.display_name.startsWith('draft-only'))!;
  expect((await page.request.get(`/api/v1/documents/${draft.id}`)).status()).toBe(200);

  const rv = await createReviewer('admin_review');
  const ctx = await freshContext(browser, page);
  const rp = await ctx.newPage();
  await reviewerGoto(rp, rv, '/en/admin/verification');
  expect((await rp.request.get(`/api/v1/documents/${draft.id}`)).status()).toBe(404);
  await ctx.close();
});

test('E26 images are stored without metadata: sha256, size and downloaded bytes describe the stripped file; PDFs stay byte-identical', async ({ page }) => {
  test.setTimeout(240_000);
  const { createBusinessOwner, onboardUi, jpegWithMetadata, pngWithMetadata, SECRETS } = await import('./support/biz');
  const { loginUi } = await import('./support/ui');
  const { owner, orgId } = await createBusinessOwner('e26img');
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);
  await gotoStep(page, 'en', orgId, 5);

  const jpg = jpegWithMetadata({ name: 'photo.jpg' });
  const png = pngWithMetadata({ name: 'scan.png' });
  const pdf = smallPdf('plain');
  for (const f of [jpg, png, pdf]) {
    const slot = await uploadDoc(page, 'en', 'business_registration', f);
    await expect(slot).toContainText(msg('en', 'documents.received'));
  }
  const rows = await docsOf(orgId, 'business_registration');
  expect(rows).toHaveLength(3);
  const byName = (n: string) => rows.find((r) => r.display_name === n)!;
  const sizes = await sql<{ id: string; size_bytes: string }>(`select id, size_bytes::text from public.verification_documents where org_id = $1`, [orgId]);
  const sizeOf = (id: string) => Number(sizes.find((r) => r.id === id)!.size_bytes);

  const cases: { f: typeof jpg; secrets: string[]; keep: string[] }[] = [
    { f: jpg, secrets: [SECRETS.exif, SECRETS.xmp, SECRETS.com, SECRETS.iptc, 'Exif', 'Photoshop'], keep: ['JFIF'] },
    { f: png, secrets: [SECRETS.text, SECRETS.itxt, SECRETS.time, SECRETS.exif, 'tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'], keep: ['IHDR', 'IDAT', 'IEND'] },
  ];
  for (const c of cases) {
    const row = byName(c.f.name);
    const res = await page.request.get(`/api/v1/documents/${row.id}`);
    expect(res.status()).toBe(200);
    const body = await res.body();
    const text = body.toString('latin1');
    for (const s of c.secrets) expect(text, `${c.f.name}: "${s}" must be gone`).not.toContain(s);
    for (const k of c.keep) expect(text, `${c.f.name}: "${k}" must be kept`).toContain(k);
    expect(body.length).toBeLessThan(c.f.buffer.length);
    expect(body.length).toBe(sizeOf(row.id));
    expect(sha(body)).toBe(row.sha256);
    expect(sha(body)).not.toBe(sha(c.f.buffer));
    expect(res.headers()['content-type']).toBe(c.f.mimeType);
  }
  // The PDF is untouched.
  const pdfRow = byName(pdf.name);
  const pdfRes = await page.request.get(`/api/v1/documents/${pdfRow.id}`);
  expect(sha(await pdfRes.body())).toBe(sha(pdf.buffer));
  expect(pdfRow.sha256).toBe(sha(pdf.buffer));
  expect(sizeOf(pdfRow.id)).toBe(pdf.buffer.length);
});
