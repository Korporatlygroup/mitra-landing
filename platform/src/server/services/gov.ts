import { failFrom, ok, type Db, type Result } from './result';
import type { MatchRule, AssistanceProfile } from '@/lib/gov-matching';

/** Phase 7 service wrappers for the government-assistance RPCs (public reads work without a session). */

export interface GovProgrammeRow {
  id: string;
  slug: string;
  name: string;
  agency_name: string;
  funding_type: string | null;
  amount_min: string | null;
  amount_max: string | null;
  currency: string | null;
  application_status: 'open' | 'closed' | 'upcoming' | 'unknown';
  opens_on: string | null;
  closes_on: string | null;
  last_checked_at: string | null;
  last_verified_at: string | null;
  info_url: string | null;
  application_url: string | null;
  application_channel: string | null;
  summary: string | null;
  is_stale: boolean;
  rules: MatchRule[];
  verification_status: string;
}

export interface GovProgrammeDetail {
  id: string;
  slug: string;
  name: string;
  agency: string;
  agency_domain: string;
  version_no: number;
  verification_status: string;
  application_status: 'open' | 'closed' | 'upcoming' | 'unknown';
  is_stale: boolean;
  last_checked_at: string | null;
  last_verified_at: string | null;
  data: {
    name: string;
    description?: string;
    funding_type?: string;
    amount_min?: string;
    amount_max?: string;
    currency?: string;
    application_channel?: string;
    application_url?: string;
    info_url: string;
    opens_on?: string;
    closes_on?: string;
    documents?: string[];
    terms?: { label: string; text: string }[];
    rules?: MatchRule[];
  };
}

export interface GovSavedRow {
  programme_id: string;
  slug: string;
  name: string;
  agency_name: string;
  funding_type: string | null;
  application_status: string;
  closes_on: string | null;
  last_checked_at: string | null;
  last_verified_at: string | null;
  publication_state: string;
  tracking_status: string;
  note: string | null;
  applied_on: string | null;
  outcome: string | null;
  reminder_on: string | null;
  version: number;
  rules_changed: boolean;
  is_stale: boolean;
}

export type GovProfile = AssistanceProfile & { org_id: string; version: number };

export interface GovPrefs {
  new_match: boolean;
  opens: boolean;
  deadline: boolean;
  rule_change: boolean;
  unavailable: boolean;
  reminder: boolean;
  channel_in_app: boolean;
  channel_email: boolean;
  paused_until: string | null;
  frequency: 'immediate' | 'daily' | 'weekly';
}

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await db.rpc(fn, args);
  return error ? failFrom(error) : ok(data as T);
}

export const GOV_PAGE_SIZE = 30;

export const listGovProgrammes = (db: Db, p: { fundingType?: string | null; q?: string; offset?: number; limit?: number } = {}) =>
  rpc<GovProgrammeRow[]>(db, 'gov_list_programmes', {
    p_funding_type: p.fundingType || null,
    p_query: p.q?.trim() || null,
    p_limit: p.limit ?? GOV_PAGE_SIZE,
    p_offset: p.offset ?? 0,
  });

export const getGovProgramme = (db: Db, slug: string) => rpc<GovProgrammeDetail>(db, 'gov_get_programme', { p_slug: slug });
export const getGovProfile = (db: Db, org: string) => rpc<GovProfile>(db, 'gov_get_profile', { p_org: org });
export const saveGovProfile = (db: Db, org: string, data: Record<string, unknown>, expectedVersion: number) =>
  rpc<number>(db, 'gov_save_profile', { p_org: org, p_data: data, p_expected_version: expectedVersion });
export const saveGovProgramme = (db: Db, org: string, programme: string) => rpc<null>(db, 'gov_save_programme', { p_org: org, p_programme: programme });
export const unsaveGovProgramme = (db: Db, org: string, programme: string) => rpc<null>(db, 'gov_unsave_programme', { p_org: org, p_programme: programme });
export const updateGovTracking = (db: Db, org: string, programme: string, data: Record<string, unknown>, expectedVersion: number) =>
  rpc<number>(db, 'gov_update_tracking', { p_org: org, p_programme: programme, p_data: data, p_expected_version: expectedVersion });
export const listGovSaved = (db: Db, org: string) => rpc<GovSavedRow[]>(db, 'gov_list_saved', { p_org: org });
export const getGovPrefs = (db: Db) => rpc<GovPrefs>(db, 'gov_get_prefs');
export const setGovPrefs = (db: Db, data: Record<string, unknown>) => rpc<null>(db, 'gov_set_prefs', { p_data: data });

// Staff
export const decideGovProposal = (db: Db, proposal: string, decision: 'approve' | 'reject' | 'needs_info', reason: string, expectedStatus: 'pending' | 'needs_info' = 'pending') =>
  rpc<string | null>(db, 'gov_decide_proposal', { p_proposal: proposal, p_decision: decision, p_reason: reason, p_expected_status: expectedStatus });
export const setGovProgrammeState = (db: Db, programme: string, state: 'published' | 'paused' | 'archived', reason: string) =>
  rpc<null>(db, 'gov_set_programme_state', { p_programme: programme, p_state: state, p_reason: reason });
export const setGovSetting = (db: Db, key: string, enabled: boolean, reason: string) => rpc<null>(db, 'gov_set_setting', { p_key: key, p_enabled: enabled, p_reason: reason });
