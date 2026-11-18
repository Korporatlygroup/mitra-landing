import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createUser } from './support/db';
import { loginUi } from './support/ui';
import { ENABLED, EVIDENCE_DIR } from './support/qa-evidence';

// Bounded concurrent-session test with REAL browsers (LOCAL stack, QA=1). N signed-in sessions run the same short journey at the same time
// (sign in, home, directory search, catalogue, requests, notifications). Durations are measured per step; nothing is estimated.
test.skip(!ENABLED, 'QA evidence runs on request: QA=1');
test.describe.configure({ mode: 'serial' });

const LEVELS = [5, 10, 20];
const pct = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]! : -1);
const all: unknown[] = [];

for (const n of LEVELS) {
  test(`${n} concurrent signed-in browser sessions`, async ({ browser }) => {
    test.setTimeout(600_000);
    const users = await Promise.all(Array.from({ length: n }, (_, i) => createUser(`load${n}-${i}`)));
    const steps: Record<string, number[]> = {};
    const failures: string[] = [];
    const t0 = Date.now();
    await Promise.all(users.map(async (u, i) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const timed = async (name: string, fn: () => Promise<void>) => {
        const s = performance.now();
        try { await fn(); (steps[name] ??= []).push(performance.now() - s); } catch (e) { failures.push(`session ${i} ${name}: ${String(e).slice(0, 120)}`); }
      };
      await timed('sign-in', () => loginUi(page, u, 'en'));
      await timed('home', async () => { await page.goto('/en'); await expect(page.locator('main')).toBeVisible(); });
      await timed('directory-search', async () => { await page.goto('/en/directory?q=packaging'); await expect(page.locator('main')).toBeVisible(); });
      await timed('catalogue', async () => { await page.goto('/en/catalogue'); await expect(page.locator('[data-product-id]').first()).toBeVisible(); });
      await timed('requests', async () => { await page.goto('/en/requests'); await expect(page.locator('main')).toBeVisible(); });
      await timed('notifications', async () => { await page.goto('/en/notifications'); await expect(page.locator('main')).toBeVisible(); });
      await ctx.close();
    }));
    const wall = (Date.now() - t0) / 1000;
    const perStep = Object.fromEntries(Object.entries(steps).map(([k, v]) => { const s = [...v].sort((a, b) => a - b); return [k, { n: s.length, p50: Math.round(pct(s, 50)), p95: Math.round(pct(s, 95)), max: Math.round(s.at(-1) ?? -1) }]; }));
    all.push({ concurrency: n, wallSeconds: +wall.toFixed(1), failures, perStep });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'load-test-browser.json'), JSON.stringify({ when: new Date().toISOString(), note: 'local production build, real browsers, one machine for server, database and clients', results: all }, null, 2));
    expect(failures, failures.join('\n')).toHaveLength(0);
  });
}
