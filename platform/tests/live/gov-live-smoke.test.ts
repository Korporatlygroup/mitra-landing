import { describe, expect, it } from 'vitest';
import { robotsAllows } from '@/server/gov/robots';
import { safeFetch } from '@/server/gov/safe-fetch';
import { extractTekunScheme, findConditionsLink } from '@/server/gov/tekun';

// Live smoke test (opt-in): `GOV_LIVE=1 npx vitest run --project live`. Reads three public TEKUN pages with the real
// guarded fetcher and the real extractor. It writes nothing anywhere and publishes nothing. Not part of CI.
const LIVE = process.env.GOV_LIVE === '1';
const HOSTS = ['www.tekun.gov.my'];
const UA = 'INOK-GovNavigator/0.1 (smoke test)';
const SCHEME = 'https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi/';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIVE)('TEKUN live smoke', () => {
  it('robots, scheme page and conditions page are readable and extract cleanly', async () => {
    const robots = await safeFetch('https://www.tekun.gov.my/robots.txt', { allowedHosts: HOSTS, userAgent: UA });
    expect(robots.status).toBe(200);
    expect(robotsAllows(robots.text, 'inok-govnavigator', new URL(SCHEME).pathname)).toBe(true);
    await wait(10_000);
    const page = await safeFetch(SCHEME, { allowedHosts: HOSTS, userAgent: UA });
    expect(page.status).toBe(200);
    const link = findConditionsLink(page.text, page.finalUrl);
    expect(link).not.toBeNull();
    await wait(10_000);
    const cond = await safeFetch(link!, { allowedHosts: HOSTS, userAgent: UA });
    expect(cond.status).toBe(200);
    const r = extractTekunScheme({ schemeHtml: page.text, schemeUrl: page.finalUrl, conditionsHtml: cond.text });
    console.info('live extraction', { name: r.candidate.name, amount: `${r.candidate.amount_min}-${r.candidate.amount_max}`, rules: r.candidate.rules.length, status: r.candidate.extraction_status, conditionsUrl: cond.finalUrl });
    expect(r.candidate.amount_max).toMatch(/^\d+$/);
    expect(r.candidate.rules.length).toBeGreaterThan(0);
  }, 90_000);
});
