/**
 * Phase 7 eligibility matching. Pure, deterministic and explainable.
 * Every check comes from a condition the agency actually published (a quoted rule on the verified programme version).
 * Unknown information is never treated as satisfied; a published condition we cannot check is reported as "needs the
 * agency's assessment". There is no score and no probability: only four labels and the reasons for them.
 * Ethnicity or nationality are never inferred and never used as a hidden ranking input: a community or citizenship
 * rule is evaluated only from what the business owner voluntarily declared, and only because the agency published it.
 */

export type MatchLabel = 'potential_match' | 'more_information_needed' | 'known_requirement_not_met' | 'unconfirmed_programme' | 'for_organisations';
export type RuleStatus = 'met' | 'not_met' | 'unknown' | 'agency';

export interface MatchRule {
  field: string;
  op: 'eq' | 'in' | 'gte' | 'lte' | 'note';
  value?: string | number | string[];
  quote: string;
}

export interface AssistanceProfile {
  needs?: string[];
  business_size?: string | null;
  employees?: number | null;
  years_operating?: number | null;
  registration?: string | null;
  sector?: string | null;
  state?: string | null;
  community?: string | null;
  citizenship?: string | null;
  owner_age?: number | null;
}

export interface MatchProgramme {
  verification_status: string;
  application_status: string;
  is_stale: boolean;
  funding_type: string | null;
  closes_on?: string | null;
  /** Who the programme is for. Programmes meant for associations, NGOs or training providers are never matched to a shop owner. */
  beneficiary_type?: string | null;
  /** The official page the rules were read from (shown as the source of every conclusion). */
  info_url?: string | null;
  data: { rules?: MatchRule[] };
}

export interface RuleResult {
  field: string;
  status: RuleStatus;
  quote: string;
  /** The profile field that was compared (never a value for community or citizenship, which are voluntary declarations). */
  used: string | null;
  /** The profile value that was compared, when it is not sensitive. */
  usedValue: string | number | null;
  /** Why: the comparison in words the interface can translate. */
  reason: 'meets' | 'does_not_meet' | 'not_answered' | 'agency_only';
  /** The official page this requirement was read from. */
  sourceUrl: string | null;
}

export interface MatchResult {
  label: MatchLabel;
  rules: RuleResult[];
  met: string[];
  notMet: string[];
  missing: string[];
  needsAgency: string[];
  needRelevant: boolean;
}

const NEED_FOR_FUNDING: Record<string, string> = { financing: 'financing', grant: 'grant', subsidy: 'grant', training: 'training', other: 'growth' };

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

function list(v: MatchRule['value']): string[] {
  return (Array.isArray(v) ? v : [v]).map(norm).filter(Boolean);
}

function declared(v: string | null | undefined): string | null {
  const n = norm(v);
  return n === '' || n === 'prefer_not' ? null : n;
}

export function evaluateRule(rule: MatchRule, p: AssistanceProfile): RuleStatus {
  if (rule.op === 'note' || rule.field === 'note') return 'agency';
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const cmp = (have: number | null, want: unknown): RuleStatus => {
    const w = Number(want);
    if (have === null) return 'unknown';
    if (!Number.isFinite(w)) return 'agency';
    return rule.op === 'gte' ? (have >= w ? 'met' : 'not_met') : rule.op === 'lte' ? (have <= w ? 'met' : 'not_met') : have === w ? 'met' : 'not_met';
  };
  switch (rule.field) {
    case 'age_min':
    case 'age_max':
      return cmp(num(p.owner_age), rule.value);
    case 'employees_min':
    case 'employees_max':
      return cmp(num(p.employees), rule.value);
    case 'years_operating_min':
      return cmp(num(p.years_operating), rule.value);
    case 'registration': {
      const have = declared(p.registration);
      if (!have) return 'unknown';
      if (list(rule.value).includes('licensed_or_registered')) return have === 'registered' || have === 'licensed' ? 'met' : 'not_met';
      return list(rule.value).includes(have) ? 'met' : 'not_met';
    }
    case 'community':
    case 'citizenship':
    case 'business_size':
    case 'sector':
    case 'state': {
      const have = declared(p[rule.field as keyof AssistanceProfile] as string | null | undefined);
      if (!have) return 'unknown';
      const want = list(rule.value);
      if (want.length === 0) return 'agency';
      return want.includes(have) ? 'met' : 'not_met';
    }
    default:
      return 'agency';
  }
}

const PROFILE_FIELD: Record<string, keyof AssistanceProfile> = {
  age_min: 'owner_age', age_max: 'owner_age', employees_min: 'employees', employees_max: 'employees', years_operating_min: 'years_operating',
  registration: 'registration', community: 'community', citizenship: 'citizenship', business_size: 'business_size', sector: 'sector', state: 'state',
};
const VOLUNTARY = new Set(['community', 'citizenship']);

function describe(rule: MatchRule, status: RuleStatus, p: AssistanceProfile, sourceUrl: string | null): RuleResult {
  const key = PROFILE_FIELD[rule.field];
  const raw = key ? p[key] : null;
  const present = key !== undefined && raw !== null && raw !== undefined && String(raw).trim() !== '' && norm(raw) !== 'prefer_not';
  return {
    field: rule.field,
    status,
    quote: rule.quote,
    used: key && present ? String(key) : null,
    usedValue: key && present && !VOLUNTARY.has(rule.field) ? (raw as string | number) : null,
    reason: status === 'met' ? 'meets' : status === 'not_met' ? 'does_not_meet' : status === 'unknown' ? 'not_answered' : 'agency_only',
    sourceUrl,
  };
}

export function matchProgramme(programme: MatchProgramme, profile: AssistanceProfile): MatchResult {
  const sourceUrl = programme.info_url ?? null;
  const rules = (programme.data.rules ?? []).map((r) => describe(r, evaluateRule(r, profile), profile, sourceUrl));
  const pick = (s: RuleStatus) => rules.filter((r) => r.status === s);
  // Nothing checkable (no rules, or only conditions the agency alone can assess) is not a match: we have not compared anything.
  const checkable = rules.filter((r) => r.status !== 'agency').length;
  const unconfirmed = programme.verification_status !== 'verified' || programme.is_stale || checkable === 0;
  const notMet = pick('not_met');
  const unknown = pick('unknown');
  const label: MatchLabel = programme.beneficiary_type === 'organisation'
    ? 'for_organisations'
    : unconfirmed
    ? 'unconfirmed_programme'
    : notMet.length > 0
      ? 'known_requirement_not_met'
      : unknown.length > 0
        ? 'more_information_needed'
        : 'potential_match';
  const need = programme.funding_type ? NEED_FOR_FUNDING[programme.funding_type] : undefined;
  return {
    label,
    rules,
    met: [...new Set(pick('met').map((r) => r.quote))],
    notMet: notMet.map((r) => r.quote),
    missing: [...new Set(unknown.map((r) => r.field))],
    needsAgency: [...new Set(pick('agency').map((r) => r.quote))],
    needRelevant: Boolean(need && (profile.needs ?? []).includes(need)),
  };
}

const LABEL_RANK: Record<MatchLabel, number> = { potential_match: 0, more_information_needed: 1, unconfirmed_programme: 2, known_requirement_not_met: 3, for_organisations: 4 };

/** Sort key: label, then relevance to the declared need, then open before others, then nearest published deadline. */
export function rankMatches<T extends { match: MatchResult; programme: MatchProgramme }>(items: T[], today = new Date()): T[] {
  const statusRank = (s: string) => (s === 'open' ? 0 : s === 'upcoming' ? 1 : s === 'unknown' ? 2 : 3);
  const days = (d?: string | null) => {
    if (!d) return Number.MAX_SAFE_INTEGER;
    const t = Date.parse(d) - today.getTime();
    return t < 0 ? Number.MAX_SAFE_INTEGER - 1 : t;
  };
  return [...items].sort(
    (a, b) =>
      LABEL_RANK[a.match.label] - LABEL_RANK[b.match.label] ||
      Number(b.match.needRelevant) - Number(a.match.needRelevant) ||
      statusRank(a.programme.application_status) - statusRank(b.programme.application_status) ||
      days(a.programme.closes_on) - days(b.programme.closes_on),
  );
}
