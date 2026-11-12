import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateRule, matchProgramme, rankMatches, type AssistanceProfile, type MatchProgramme } from '@/lib/gov-matching';
import { extractTekunScheme } from '@/server/gov/tekun';

const dir = path.join(import.meta.dirname, '..', 'fixtures', 'tekun');
const spumi = extractTekunScheme({
  schemeHtml: fs.readFileSync(path.join(dir, 'skim-pembangunan-usahawan-masyarakat-india-spumi.html'), 'utf8'),
  schemeUrl: 'https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi/',
  conditionsHtml: fs.readFileSync(path.join(dir, 'skim-pembangunan-usahawan-masyarakat-india-spumi-syarat-syarat.html'), 'utf8'),
}).candidate;

const programme = (over: Partial<MatchProgramme> = {}): MatchProgramme => ({
  verification_status: 'verified', application_status: 'unknown', is_stale: false, funding_type: 'financing',
  data: { rules: spumi.rules as never }, ...over,
});

const full: AssistanceProfile = { needs: ['financing'], registration: 'registered', community: 'indian', citizenship: 'malaysian', owner_age: 40 };

describe('Journey C: matching against the real published SPUMI conditions', () => {
  it('compatible profile: potential match, still needs the agency (notes remain)', () => {
    const r = matchProgramme(programme(), full);
    expect(r.label).toBe('potential_match');
    expect(r.notMet).toEqual([]);
    expect(r.met.length).toBeGreaterThanOrEqual(4);
    expect(r.needsAgency.length).toBeGreaterThan(0); // e.g. bankruptcy, paid-up capital: official assessment
    expect(r.needRelevant).toBe(true);
  });
  it('unknown information is never treated as satisfied', () => {
    const r = matchProgramme(programme(), { needs: ['financing'] });
    expect(r.label).toBe('more_information_needed');
    expect(r.missing).toEqual(expect.arrayContaining(['community', 'citizenship', 'age_min', 'age_max', 'registration']));
  });
  it('"prefer not to say" is unknown, not a failure and not a pass', () => {
    const r = matchProgramme(programme(), { ...full, community: 'prefer_not' });
    expect(r.label).toBe('more_information_needed');
    expect(r.missing).toContain('community');
  });
  it('a published condition that is clearly not met is shown as such', () => {
    expect(matchProgramme(programme(), { ...full, owner_age: 70 }).label).toBe('known_requirement_not_met');
    expect(matchProgramme(programme(), { ...full, community: 'other' }).label).toBe('known_requirement_not_met');
    expect(matchProgramme(programme(), { ...full, registration: 'none' }).label).toBe('known_requirement_not_met');
    expect(matchProgramme(programme(), { ...full, citizenship: 'other' }).notMet.length).toBeGreaterThan(0);
  });
  it('an unverified or stale programme is unconfirmed whatever the profile says', () => {
    expect(matchProgramme(programme({ verification_status: 'unconfirmed' }), full).label).toBe('unconfirmed_programme');
    expect(matchProgramme(programme({ is_stale: true }), full).label).toBe('unconfirmed_programme');
  });
  it('a programme without a community rule never filters or boosts by community', () => {
    const noCommunity = programme({ data: { rules: [{ field: 'age_min', op: 'gte', value: 18, quote: 'Umur 18+' }] } });
    const a = matchProgramme(noCommunity, { owner_age: 30, community: 'indian' });
    const b = matchProgramme(noCommunity, { owner_age: 30, community: 'other' });
    expect(a).toEqual(b);
  });
});

describe('rule evaluation', () => {
  it.each([
    [{ field: 'employees_max', op: 'lte', value: 5, quote: 'q' }, { employees: 3 }, 'met'],
    [{ field: 'employees_max', op: 'lte', value: 5, quote: 'q' }, { employees: 9 }, 'not_met'],
    [{ field: 'employees_max', op: 'lte', value: 5, quote: 'q' }, {}, 'unknown'],
    [{ field: 'years_operating_min', op: 'gte', value: 2, quote: 'q' }, { years_operating: 2 }, 'met'],
    [{ field: 'state', op: 'in', value: ['Selangor', 'Johor'], quote: 'q' }, { state: 'johor' }, 'met'],
    [{ field: 'state', op: 'in', value: ['Selangor'], quote: 'q' }, { state: 'Perak' }, 'not_met'],
    [{ field: 'business_size', op: 'eq', value: 'micro', quote: 'q' }, { business_size: 'small' }, 'not_met'],
    [{ field: 'note', op: 'note', quote: 'q' }, { employees: 1 }, 'agency'],
    [{ field: 'mystery', op: 'eq', value: 'x', quote: 'q' }, { employees: 1 }, 'agency'],
    [{ field: 'age_min', op: 'gte', value: 'abc', quote: 'q' }, { owner_age: 40 }, 'agency'],
  ] as const)('%j with %j is %s', (rule, profile, expected) => {
    expect(evaluateRule(rule as never, profile as never)).toBe(expected);
  });
});

describe('ranking', () => {
  it('orders by label, then declared need, then open status, then nearest deadline; never by community', () => {
    const R = [{ field: 'age_min', op: 'gte' as const, value: 18, quote: 'Umur 18+' }];
    const mk = (id: string, p: MatchProgramme, prof: AssistanceProfile) => ({ id, programme: p, match: matchProgramme(p, prof) });
    const open = mk('open', programme({ application_status: 'open', data: { rules: R }, closes_on: '2027-06-01' }), full);
    const soon = mk('soon', programme({ application_status: 'open', data: { rules: R }, closes_on: '2027-01-01' }), full);
    const notNeeded = mk('grant', programme({ funding_type: 'grant', application_status: 'open', data: { rules: R } }), full);
    const fails = mk('fails', programme({ data: { rules: spumi.rules as never } }), { ...full, owner_age: 80 });
    const unconf = mk('unconf', programme({ verification_status: 'unconfirmed', data: { rules: R } }), full);
    expect(rankMatches([fails, unconf, notNeeded, open, soon], new Date('2026-11-12')).map((x) => x.id)).toEqual(['soon', 'open', 'grant', 'unconf', 'fails']);
  });
});

describe('banned claims', () => {
  it('matching output has no approval or probability wording', () => {
    const m = matchProgramme(programme(), full);
    const r = JSON.stringify({ label: m.label, statuses: m.rules.map((x) => x.status), missing: m.missing });
    expect(r).not.toMatch(/guarantee|100%|approved by government|probability|score/i);
  });
});

describe('nothing checkable', () => {
  it('a programme with no rules, or only agency-assessed notes, is not a match', () => {
    expect(matchProgramme(programme({ data: { rules: [] } }), full).label).toBe('unconfirmed_programme');
    expect(matchProgramme(programme({ data: { rules: [{ field: 'note', op: 'note', quote: 'Syarat lain' }] } }), full).label).toBe('unconfirmed_programme');
  });
});
