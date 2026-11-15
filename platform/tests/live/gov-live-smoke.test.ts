import { describe, expect, it } from 'vitest';
import { robotsAllows } from '@/server/gov/robots';
import { safeFetch } from '@/server/gov/safe-fetch';
import { normalizePage } from '@/server/gov/page-monitor';
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
    console.info('live validators', { schemeEtag: page.etag ?? null, schemeLastModified: page.lastModified ?? null, conditionsEtag: cond.etag ?? null, conditionsLastModified: cond.lastModified ?? null });
    expect(r.candidate.amount_max).toMatch(/^\d+$/);
    expect(r.candidate.rules.length).toBeGreaterThan(0);
  }, 90_000);
});

// Page-monitor candidates: the same page read twice must normalise to the same hash (otherwise every run would raise a false
// "changed" item), robots must allow it, and the answer headers show whether conditional requests can work. Two requests per host,
// ten seconds apart. Writes nothing.
const MONITORED = [
  { host: 'www.mitra.gov.my', url: 'https://www.mitra.gov.my/ms/modal-insan' },
  { host: 'myassist-msme.gov.my', url: 'https://myassist-msme.gov.my/faq/' },
];
describe.skipIf(!LIVE)('page monitor candidates (live)', () => {
  for (const m of MONITORED) {
    it(`${m.host}: robots, headers and a stable normalised hash`, async () => {
      const hosts = [m.host];
      const robots = await safeFetch(`https://${m.host}/robots.txt`, { allowedHosts: hosts, userAgent: UA }).catch((e: Error) => ({ status: 0, text: '', error: e.message }));
      await wait(10_000);
      const allowed = robots.status === 200 ? robotsAllows(robots.text, 'inok-govnavigator', new URL(m.url).pathname) : robots.status === 404;
      const a = await safeFetch(m.url, { allowedHosts: hosts, userAgent: UA });
      await wait(10_000);
      const b = await safeFetch(m.url, { allowedHosts: hosts, userAgent: UA });
      const na = normalizePage(a.text, a.finalUrl);
      const nb = normalizePage(b.text, b.finalUrl);
      console.info('live page monitor', { host: m.host, robotsStatus: robots.status, robotsAllows: allowed, status: a.status, etag: a.etag ?? null, lastModified: a.lastModified ?? null, links: na.links.length, textChars: na.text.length, stable: na.hash === nb.hash });
      expect(a.status).toBe(200);
      expect(allowed).toBe(true);
    }, 90_000);
  }
});
