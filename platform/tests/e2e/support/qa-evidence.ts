import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

// Screenshot evidence for the QA report. Real browser captures only (page.screenshot); nothing is edited afterwards.
// Files: docs/qa-evidence/<role>/<journey>/<step>__<lang>__<width>.png and one line per file in docs/qa-evidence/index.jsonl.
export const EVIDENCE_DIR = path.join(import.meta.dirname, '..', '..', '..', 'docs', 'qa-evidence');
export const ENABLED = process.env.QA === '1';
export const WIDTHS_ALL = [360, 390, 768, 1024, 1280, 1440, 1920];
export const WIDTHS_PAIR = [390, 1280];

export interface Meta {
  role: string;
  journey: string;
  step: string;
  title: string;
  expected: string;
  observed: string;
  lang?: 'en' | 'ms' | 'ta';
  widths?: number[];
  commit?: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function shot(page: Page, m: Meta): Promise<void> {
  if (!ENABLED) return;
  const widths = m.widths ?? WIDTHS_PAIR;
  const dir = path.join(EVIDENCE_DIR, slug(m.role), slug(m.journey));
  fs.mkdirSync(dir, { recursive: true });
  const original = page.viewportSize() ?? { width: 1280, height: 800 };
  const route = (() => { try { const u = new URL(page.url()); return u.pathname + u.search; } catch { return page.url(); } })();
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 500 ? 844 : w >= 1920 ? 1080 : 900 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const file = `${slug(m.step)}__${m.lang ?? 'en'}__${w}.png`;
    await page.screenshot({ path: path.join(dir, file) });
    fs.appendFileSync(path.join(EVIDENCE_DIR, 'index.jsonl'), JSON.stringify({ ...m, widths: undefined, width: w, lang: m.lang ?? 'en', route, file: `${slug(m.role)}/${slug(m.journey)}/${file}` }) + '\n');
  }
  await page.setViewportSize(original);
}
