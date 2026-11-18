import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createUser } from './support/db';
import { loginUi } from './support/ui';
import { ENABLED, EVIDENCE_DIR } from './support/qa-evidence';

// Layer-by-layer profile of the signed-in catalogue (LOCAL stack, QA=1, run against a production build).
// 1) server render only (HTML, no images, no JavaScript)  2) the same page signed out  3) one image  4) full browser load with and without images.
test.skip(!ENABLED, 'QA evidence runs on request: QA=1');
test.describe.configure({ mode: 'serial' });

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!) : -1; };
const out: Record<string, unknown> = { when: new Date().toISOString(), note: 'local production build, one machine runs server, database and clients' };

async function hammer(ctx: () => APIRequestContext, url: string, concurrency: number, perWorker: number) {
  const times: number[] = [];
  let bad = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    const c = ctx();
    for (let i = 0; i < perWorker; i++) {
      const t0 = performance.now();
      const r = await c.get(url);
      await r.body();
      if (r.status() !== 200) bad++;
      times.push(performance.now() - t0);
    }
  }));
  return { concurrency, requests: times.length, nonOk: bad, p50: pct(times, 50), p95: pct(times, 95), max: pct(times, 100) };
}

test('profile the catalogue by layer', async ({ browser, playwright, baseURL }) => {
  test.setTimeout(900_000);
  const user = await createUser('prof');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUi(page, user, 'en');
  const state = await ctx.storageState();
  await ctx.close();
  const signedIn = await playwright.request.newContext({ baseURL, storageState: state });
  const anon = await playwright.request.newContext({ baseURL });
  const firstId = (await (await anon.get('/en/catalogue')).text()).match(/data-product-id="([0-9a-f-]{36})"/)?.[1];
  const imgId = (await (await anon.get('/en/catalogue')).text()).match(/\/api\/v1\/catalogue-media\/([0-9a-f-]{36})/)?.[1];
  expect(firstId).toBeTruthy();
  for (let i = 0; i < 5; i++) { await signedIn.get('/en/catalogue'); await anon.get('/en/catalogue'); }

  const html = (await (await signedIn.get('/en/catalogue')).body()).length;
  out.htmlBytesSignedIn = html;
  out.imagesOnPage = ((await (await signedIn.get('/en/catalogue')).text()).match(/catalogue-media\//g) ?? []).length;
  out.serverRenderSignedIn = [];
  out.serverRenderSignedOut = [];
  out.imageEndpoint = [];
  for (const n of [1, 5, 10, 20]) {
    (out.serverRenderSignedIn as unknown[]).push(await hammer(() => signedIn, '/en/catalogue', n, 8));
    (out.serverRenderSignedOut as unknown[]).push(await hammer(() => anon, '/en/catalogue', n, 8));
    if (imgId) (out.imageEndpoint as unknown[]).push(await hammer(() => signedIn, `/api/v1/catalogue-media/${imgId}`, n, 8));
  }

  // full browser: DOMContentLoaded, load (waits for images), with images blocked
  out.browser = [];
  for (const n of [1, 5, 10, 20]) {
    for (const block of [false, true]) {
      const dcl: number[] = [], load: number[] = [];
      await Promise.all(Array.from({ length: n }, async () => {
        const c = await browser.newContext({ storageState: state });
        if (block) await c.route(/\/api\/v1\/catalogue-media\//, (r) => r.abort());
        const p = await c.newPage();
        const t0 = performance.now();
        await p.goto('/en/catalogue', { waitUntil: 'domcontentloaded' });
        dcl.push(performance.now() - t0);
        await p.waitForLoadState('load');
        load.push(performance.now() - t0);
        await c.close();
      }));
      (out.browser as unknown[]).push({ concurrency: n, imagesBlocked: block, domContentLoadedP50: pct(dcl, 50), domContentLoadedP95: pct(dcl, 95), loadP50: pct(load, 50), loadP95: pct(load, 95) });
    }
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, `catalogue-profile-${process.env.PROFILE_LABEL ?? 'run'}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
});
