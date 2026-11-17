import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { freshCode } from '../e2e/support/totp';
import { persona, type PersonaKey } from './store';

export type Category = 'hosting' | 'application' | 'database' | 'test-infra' | 'inconclusive';
export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
export type CovStatus = 'pass' | 'fail' | 'blocked' | 'disabled' | 'not-implemented' | 'observed';

const OUT = path.resolve(import.meta.dirname, '..', '..', 'test-results', 'agents');
fs.mkdirSync(path.join(OUT, 'evidence'), { recursive: true });
export const TARGET = process.env.AGENT_TARGET === 'control' ? 'control' : 'worker';
const append = (f: string, o: unknown) => fs.appendFileSync(path.join(OUT, f), JSON.stringify({ ts: new Date().toISOString(), target: TARGET, ...(o as object) }) + '\n');

export const RUN = process.env.AGENT_RUN ?? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

/** A defect or observation. Severity: P0 security/data integrity, P1 broken business workflow, P2 functional/usability, P3 minor. */
export function finding(f: { id: string; sev: Severity; cat: Category; area: string; title: string; steps: string; expected: string; actual: string; evidence?: string }): void {
  append('findings.jsonl', { run: RUN, ...f });
}
/** One line of the coverage matrix. */
export function cover(scenario: string, item: string, status: CovStatus, note = '', cat?: Category): void {
  append('coverage.jsonl', { run: RUN, scenario, item, status, note, cat });
}
export function hostingEvent(e: { who: string; method: string; url: string; status: number; ray?: string | null; note?: string; recovered?: boolean }): void {
  append('hosting-events.jsonl', { run: RUN, ...e });
}

export class Agent {
  readonly events: { status: number; method: string; url: string; ray: string | null; at: number }[] = [];
  constructor(readonly key: PersonaKey, readonly ctx: BrowserContext, readonly page: Page) {
    const origin = new URL(process.env.HOSTED_BASE_URL!).origin;
    page.on('response', (r) => {
      const s = r.status();
      if (s >= 500 && new URL(r.url()).origin === origin) {
        const ev = { status: s, method: r.request().method(), url: new URL(r.url()).pathname, ray: r.headers()['cf-ray'] ?? null, at: Date.now() };
        this.events.push(ev);
        hostingEvent({ who: key, ...ev, note: 'observed 5xx from the Worker' });
      }
    });
  }

  static async create(browser: Browser, key: PersonaKey, opts: { mobile?: boolean; locale?: string } = {}): Promise<Agent> {
    const ctx = await browser.newContext(
      opts.mobile
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: opts.locale ?? 'en-US' }
        : { viewport: { width: 1280, height: 800 }, locale: opts.locale ?? 'en-US' },
    );
    ctx.setDefaultTimeout(25_000);
    ctx.setDefaultNavigationTimeout(45_000);
    return new Agent(key, ctx, await ctx.newPage());
  }

  /** Navigates. A Worker 5xx/1102 is retried (each failed attempt is logged as a hosting event) so one cold isolate does not hide application behaviour. */
  async goto(p: string, expectOk = true): Promise<Response | null> {
    let last: Response | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        last = await this.page.goto(p, { waitUntil: 'domcontentloaded' });
      } catch (e) {
        hostingEvent({ who: this.key, method: 'GET', url: p, status: 0, note: `navigation error attempt ${attempt}: ${String(e).slice(0, 120)}` });
        await this.page.waitForTimeout(3000 * attempt);
        continue;
      }
      const s = last?.status() ?? 0;
      if (s < 500) {
        if (attempt > 1) hostingEvent({ who: this.key, method: 'GET', url: p, status: s, note: `recovered on attempt ${attempt}`, recovered: true });
        return last;
      }
      hostingEvent({ who: this.key, method: 'GET', url: p, status: s, ray: last?.headers()['cf-ray'], note: `attempt ${attempt} failed` });
      await this.page.waitForTimeout(3000 * attempt);
    }
    if (expectOk) throw new Error(`HOSTING?: ${p} still ${last?.status() ?? 'unreachable'} after 4 attempts`);
    return last;
  }

  async login(loginPath = '/en/login'): Promise<void> {
    const p = persona(this.key);
    let rate = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.goto(loginPath);
      await this.page.locator('#email').fill(p.email);
      await this.page.locator('#password').fill(p.password);
      const from = this.events.length;
      await this.page.locator('main form button[type=submit]').click();
      try {
        await this.page.waitForURL((u) => !/\/login(\?|$)/.test(u.pathname + u.search), { timeout: 20_000 });
        await this.mfaIfAsked();
        return;
      } catch (e) {
        // The Auth service rate-limits sign-ins per source address; every agent shares one address, so wait the window out (test infrastructure, not a defect).
        if (await this.page.getByText(/too many tries/i).count()) {
          cover('infra', `sign-in rate limit reached for ${this.key}; waited 150 s (attempt ${attempt})`, 'observed', 'shared source address for all agents', 'test-infra');
          await this.page.waitForTimeout(150_000);
          attempt--;
          if (++rate > 8) throw e;
          continue;
        }
        // Sign-in is idempotent, so a Worker 5xx on the form post may be retried (each failure stays in hosting-events.jsonl).
        if (this.events.length > from && attempt < 3) {
          await this.page.waitForTimeout(4000 * attempt);
          continue;
        }
        throw e;
      }
    }
  }

  async mfaIfAsked(): Promise<void> {
    const p = persona(this.key);
    if (p.totpSecret && /\/mfa\/verify/.test(this.page.url())) {
      await this.page.locator('#code').fill(freshCode(p.totpSecret));
      await this.page.locator('form:has(#code) button[type=submit]').click();
      await this.page.waitForURL((u) => !/\/mfa\//.test(u.pathname), { timeout: 40_000 });
    }
  }

  /** Opens a protected page, completing the second step when a privileged session is asked for it. */
  async open(p: string): Promise<Response | null> {
    const r = await this.goto(p);
    if (/\/mfa\/verify/.test(this.page.url())) {
      await this.mfaIfAsked();
      return this.goto(p);
    }
    return r;
  }

  async shot(name: string): Promise<string> {
    const f = path.join(OUT, 'evidence', `${RUN}-${this.key}-${name}.png`.replace(/[^\w.-]/g, '_'));
    await this.page.screenshot({ path: f, fullPage: true }).catch(() => undefined);
    return f;
  }

  /** Soft check: records pass/fail in the coverage matrix and carries on. A failure in a window that saw Worker 5xx is classified as hosting. */
  async check(scenario: string, item: string, fn: () => Promise<void>): Promise<boolean> {
    const from = Date.now();
    try {
      await fn();
      cover(scenario, item, 'pass');
      return true;
    } catch (e) {
      const hosted = this.events.filter((x) => x.at >= from);
      const cat: Category = hosted.length && TARGET === 'worker' ? 'hosting' : /HOSTING\?/.test(String(e)) ? 'inconclusive' : 'application';
      const ev = await this.shot(`${scenario}-${item}`.slice(0, 80));
      cover(scenario, item, 'fail', String(e).split('\n')[0]!.slice(0, 300), cat);
      append('failures.jsonl', { run: RUN, who: this.key, scenario, item, cat, error: String(e).slice(0, 800), url: this.page.url(), evidence: path.basename(ev), worker5xx: hosted.map((h) => `${h.method} ${h.url} ${h.status}`) });
      return false;
    }
  }

  /** Hard step: same record, then throws so dependent steps do not run on a broken state. */
  async must(scenario: string, item: string, fn: () => Promise<void>): Promise<void> {
    if (!(await this.check(scenario, item, fn))) throw new Error(`Blocked: ${scenario} / ${item}`);
  }

  async a11y(scenario: string, label: string): Promise<number> {
    const r = await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    cover(scenario, `a11y: ${label}`, r.violations.length ? 'fail' : 'pass', r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', '));
    if (r.violations.length) append('a11y.jsonl', { run: RUN, who: this.key, scenario, label, url: this.page.url(), violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) });
    return r.violations.length;
  }

  async close(): Promise<void> {
    await this.ctx.close();
  }
}

export const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
