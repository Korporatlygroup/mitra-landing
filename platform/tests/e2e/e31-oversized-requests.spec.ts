import { expect, test, type APIRequestContext } from '@playwright/test';
import { createBusinessOwner, gotoStep, onboardUi, pdfOfSize, uploadDoc } from './support/biz';
import { msg } from './support/i18n';
import { loginUi } from './support/ui';

const MB = 1024 * 1024;
const post = (request: APIRequestContext, path: string, size: number, type = 'application/octet-stream') =>
  request.post(path, { data: Buffer.alloc(size, 0x41), headers: { 'content-type': type }, maxRedirects: 0, failOnStatusCode: false });

// Any POST over 1 MB outside the two upload pages is refused with 413 and no body.
for (const path of ['/en/login', '/en/signup', '/ta/login', '/en/forgot-password', '/en/orgs/new', '/en/account', '/en']) {
  test(`E31 a 2 MB POST to ${path} gets 413 with no body`, async ({ request }) => {
    const res = await post(request, path, 2 * MB);
    expect(res.status()).toBe(413);
    expect((await res.body()).length).toBe(0);
  });
}

test('E31 multipart, form-encoded, PUT and PATCH oversized bodies are refused as well', async ({ request }) => {
  const multipart = await request.post('/en/login', {
    multipart: { file: { name: 'x.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(2 * MB, 0x41) } },
    failOnStatusCode: false,
  });
  expect(multipart.status()).toBe(413);
  expect((await multipart.body()).length).toBe(0);
  const form = await post(request, '/en/signup', 2 * MB, 'application/x-www-form-urlencoded');
  expect(form.status()).toBe(413);
  for (const method of ['put', 'patch'] as const) {
    const r = await request[method]('/en/login', { data: Buffer.alloc(2 * MB, 0x41), failOnStatusCode: false });
    expect(r.status(), method).toBe(413);
  }
});

test('E31 normal-sized POSTs are not affected, and reads are never refused', async ({ request }) => {
  const small = await post(request, '/en/login', 200 * 1024);
  expect(small.status()).not.toBe(413);
  const exactly = await post(request, '/en/login', 1 * MB);
  expect(exactly.status()).not.toBe(413); // the limit is "above 1 MB"
  const get = await request.get('/en/login');
  expect(get.status()).toBe(200);
});

test('E31 the two upload pages still accept large bodies (they are not answered with 413)', async ({ request }) => {
  const org = '00000000-0000-4000-8000-000000000000';
  for (const tail of ['onboarding', 'verification']) {
    for (const locale of ['en', 'ta']) {
      const res = await post(request, `/${locale}/orgs/${org}/business/${tail}`, 2 * MB);
      expect(res.status(), `${locale} ${tail}`).not.toBe(413);
    }
  }
  // Other business pages are not on the allow-list.
  expect((await post(request, `/en/orgs/${org}/business/preview`, 2 * MB)).status()).toBe(413);
  expect((await post(request, `/en/orgs/${org}/members`, 2 * MB)).status()).toBe(413);
});

test('E31 a 10 MiB + 1 file on the upload page still shows the clear "larger than 10 MB" message', async ({ page }) => {
  test.setTimeout(180_000);
  const { owner, orgId } = await createBusinessOwner('e31');
  await loginUi(page, owner);
  await onboardUi(page, 'en', orgId);
  await gotoStep(page, 'en', orgId, 5);
  const slot = await uploadDoc(page, 'en', 'business_registration', pdfOfSize(10 * MB + 1, 'big.pdf'));
  await expect(slot).toContainText(msg('en', 'errors.file_too_large'), { timeout: 30_000 });
});
