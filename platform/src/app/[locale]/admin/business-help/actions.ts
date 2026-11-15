'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { formToObject, nonSecretValues } from '@/lib/form';
import { mapRpcError } from '@/lib/errors';
import { failure, success, type FormState } from '@/lib/form-state';
import { localeSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { decideGovProposal, decideGovSourceChange, proposeGovSourceChange, registerGovSource, requestGovRecheck, reviewGovPageChange, setGovProgrammeState, setGovSetting } from '@/server/services/gov';

const reason = z.string().trim().min(5).max(1000);

const decisionSchema = z.object({ proposalId: z.uuid(), decision: z.enum(['approve', 'reject', 'needs_info']), expectedStatus: z.enum(['pending', 'needs_info']).default('pending'), reason });
const stateSchema = z.object({ programmeId: z.uuid(), state: z.enum(['published', 'paused', 'archived']), reason });
const settingSchema = z.object({ key: z.enum(['monitoring_enabled', 'publishing_enabled', 'notifications_enabled']), enabled: z.enum(['true', 'false']), reason });

/** Every action validates, re-reads the signed-in user from the Auth server and calls one database function. The database decides who may. */
export async function decideProposalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = decisionSchema.safeParse(raw);
  if (!p.success) return failure(p.error.issues.some((i) => i.path[0] === 'reason') ? 'reason' : 'decision', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await decideGovProposal(supabase, p.data.proposalId, p.data.decision, p.data.reason, p.data.expectedStatus);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.admin.decided');
}

export async function setProgrammeStateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = stateSchema.safeParse(raw);
  if (!p.success) return failure(p.error.issues.some((i) => i.path[0] === 'reason') ? 'reason' : 'state', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await setGovProgrammeState(supabase, p.data.programmeId, p.data.state, p.data.reason);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.admin.decided');
}

export async function setSettingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = settingSchema.safeParse(raw);
  if (!p.success) return failure(p.error.issues.some((i) => i.path[0] === 'reason') ? 'reason' : 'key', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await setGovSetting(supabase, p.data.key, p.data.enabled === 'true', p.data.reason);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.admin.decided');
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 7 completion: hand-entered programmes, page changes, sources. The database decides who may do what.
// ---------------------------------------------------------------------------------------------------------------

const adminFailure = (key: string, values?: Record<string, string>, data?: Record<string, string>): FormState => ({
  status: 'error',
  messageKey: `gov.admin.err.${key}`,
  values,
  data,
});

const CATEGORIES = ['grants_funding', 'business_financing', 'training', 'advisory', 'entrepreneurship', 'digital', 'other'] as const;
const RULE_FIELDS = ['business_size', 'sector', 'state', 'registration', 'employees_min', 'employees_max', 'years_operating_min', 'citizenship', 'community', 'age_min', 'age_max', 'note'] as const;
const RULE_OPS = ['eq', 'in', 'gte', 'lte', 'note'] as const;
const NUMERIC_RULE_FIELDS = new Set(['employees_min', 'employees_max', 'years_operating_min', 'age_min', 'age_max']);
const MAX_RULE_ROWS = 40;

const httpsUrl = z.string().trim().max(500).regex(/^https:\/\/[A-Za-z0-9.-]+(:443)?\/\S*$/);
const optional = <T extends z.ZodType>(s: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s.optional());
const amount = optional(z.string().trim().regex(/^[0-9]{1,12}(\.[0-9]{1,2})?$/));
const day = optional(z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/));
const lines = (v: string | undefined, sep: RegExp, max: number) =>
  (v ?? '').split(sep).map((x) => x.trim()).filter(Boolean).slice(0, max);

const manualSchema = z.object({
  sourceId: z.uuid(),
  programmeId: optional(z.uuid()),
  name: z.string().trim().min(3).max(200),
  category: z.enum(CATEGORIES),
  beneficiary_type: optional(z.enum(['entrepreneur', 'organisation', 'both'])),
  description: optional(z.string().trim().max(4000)),
  funding_type: optional(z.enum(['grant', 'financing', 'subsidy', 'training', 'other'])),
  amount_min: amount,
  amount_max: amount,
  application_channel: optional(z.enum(['online', 'branch', 'form', 'enquiry', 'unknown'])),
  application_url: optional(httpsUrl),
  info_url: httpsUrl,
  application_status: z.enum(['unknown', 'open', 'upcoming', 'closed']).default('unknown'),
  opens_on: day,
  closes_on: day,
  documents: optional(z.string().max(8000)),
  sectors: optional(z.string().max(2000)),
  states: optional(z.string().max(2000)),
  reason,
});

type RuleOut = { field: string; op: string; value?: string | number | string[]; quote: string };

function ruleRows(raw: Record<string, string>): RuleOut[] | 'rule' {
  const out: RuleOut[] = [];
  for (let i = 0; i < MAX_RULE_ROWS; i += 1) {
    const field = (raw[`rule_${i}_field`] ?? '').trim();
    const op = (raw[`rule_${i}_op`] ?? '').trim();
    const value = (raw[`rule_${i}_value`] ?? '').trim();
    const quote = (raw[`rule_${i}_quote`] ?? '').trim();
    if (!value && !quote) continue; // an untouched row
    const isNote = field === 'note' || op === 'note';
    if (!(RULE_FIELDS as readonly string[]).includes(field) || !(RULE_OPS as readonly string[]).includes(op) || !quote || quote.length > 600) return 'rule';
    if (isNote) {
      out.push({ field: 'note', op: 'note', quote });
      continue;
    }
    if (!value) return 'rule';
    if (NUMERIC_RULE_FIELDS.has(field)) {
      const n = Number(value);
      if (!Number.isFinite(n) || op === 'in') return 'rule';
      out.push({ field, op, value: n, quote });
    } else {
      out.push({ field, op, value: op === 'in' ? lines(value, /,/, 20) : value, quote });
    }
  }
  return out;
}

async function adminTranslator(formData: FormData) {
  const locale = localeSchema.catch('en').parse(formData.get('locale'));
  return getTranslations({ locale, namespace: 'gov.admin' });
}

const DB_FIELD_PROBLEMS = new Set([
  'name', 'info_url', 'funding_type', 'application_status', 'application_channel', 'application_url', 'currency', 'amount_min', 'amount_max',
  'currency_missing', 'opens_on', 'closes_on', 'description', 'terms', 'category', 'beneficiary_type', 'sectors', 'states', 'documents',
]);

type RpcError = { code?: string; message?: string };

function manualRpcFailure(error: RpcError, t: Awaited<ReturnType<typeof adminTranslator>>, values: Record<string, string>): FormState {
  const msg = (error.message ?? '').trim();
  if (error.code === 'PT422') {
    if (msg === 'dates_contradict' || msg === 'amount_range') return adminFailure(msg, values);
    if (msg === 'rule' || msg === 'rules') return adminFailure('rule', values);
    if (msg === 'reason') return failure('reason', values);
    if (DB_FIELD_PROBLEMS.has(msg)) return adminFailure('field', values, { field: t.has(`fields.${msg}`) ? t(`fields.${msg}`) : msg });
  }
  if (error.code === 'PT409' && ['programme_exists', 'no_change', 'duplicate'].includes(msg)) return adminFailure(msg, values);
  return failure(mapRpcError(error), values);
}

/** Proposes a new programme or a change to one. Publishing needs a different administrator (the database enforces it). */
export async function proposeManualAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const values = nonSecretValues(raw);
  const t = await adminTranslator(formData);
  const p = manualSchema.safeParse(raw);
  if (!p.success) {
    const key = String(p.error.issues[0]?.path[0] ?? '');
    if (key === 'reason') return failure('reason', values);
    if (key === 'sourceId') return adminFailure('source', values);
    return adminFailure('field', values, { field: t.has(`fields.${key}`) ? t(`fields.${key}`) : key });
  }
  const d = p.data;
  if (d.opens_on && d.closes_on && d.opens_on > d.closes_on) return adminFailure('dates_contradict', values);
  if (d.amount_min && d.amount_max && Number(d.amount_min) > Number(d.amount_max)) return adminFailure('amount_range', values);
  const rules = ruleRows(raw);
  if (rules === 'rule') return adminFailure('rule', values);

  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  // A change starts from the published version: fields this form does not edit (terms, extraction notes) are carried over, never dropped.
  const carried: Record<string, unknown> = {};
  if (d.programmeId) {
    const { data: pr } = await supabase.from('gov_programmes').select('current_version_id').eq('id', d.programmeId).maybeSingle();
    const { data: ver } = pr?.current_version_id ? await supabase.from('gov_programme_versions').select('data').eq('id', pr.current_version_id).maybeSingle() : { data: null };
    const old = (ver?.data ?? {}) as Record<string, unknown>;
    for (const k of ['terms', 'review_notes', 'extraction_status']) if (old[k] !== undefined) carried[k] = old[k];
  }
  const candidate: Record<string, unknown> = { ...carried, name: d.name, info_url: d.info_url, category: d.category, application_status: d.application_status };
  if (d.beneficiary_type) candidate.beneficiary_type = d.beneficiary_type;
  // Browsers send line breaks as CRLF; the stored text uses LF, so an unedited description is never reported as changed.
  if (d.description) candidate.description = d.description.replace(/\r\n/g, '\n');
  if (d.funding_type) candidate.funding_type = d.funding_type;
  if (d.amount_min) candidate.amount_min = d.amount_min;
  if (d.amount_max) candidate.amount_max = d.amount_max;
  if (d.amount_min || d.amount_max) candidate.currency = 'MYR';
  if (d.application_channel) candidate.application_channel = d.application_channel;
  if (d.application_url) candidate.application_url = d.application_url;
  if (d.opens_on) candidate.opens_on = d.opens_on;
  if (d.closes_on) candidate.closes_on = d.closes_on;
  const docs = lines(d.documents, /\r?\n/, 40);
  if (docs.length) candidate.documents = docs;
  const sectors = lines(d.sectors, /,|\r?\n/, 40);
  if (sectors.length) candidate.sectors = sectors;
  const states = lines(d.states, /,|\r?\n/, 40);
  if (states.length) candidate.states = states;
  if (rules.length) candidate.rules = rules;

  const { error } = await supabase.rpc('gov_propose_manual', { p_source: d.sourceId, p_programme: d.programmeId ?? null, p_candidate: candidate, p_reason: d.reason });
  if (error) return manualRpcFailure(error, t, values);
  revalidatePath('/', 'layout');
  return success('gov.admin.manual.proposed');
}

const pageChangeSchema = z.object({ changeId: z.uuid(), status: z.enum(['reviewed', 'dismissed']), note: reason });
export async function reviewPageChangeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = pageChangeSchema.safeParse(raw);
  if (!p.success) return failure(p.error.issues.some((i) => i.path[0] === 'note') ? 'reason' : 'decision', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await reviewGovPageChange(supabase, p.data.changeId, p.data.status, p.data.note);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.admin.pc.saved');
}

const hostName = z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9.-]{0,120})\.[a-z]{2,}$/);
const registerSchema = z.object({
  agencyCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,30}$/),
  agencyName: z.string().trim().min(2).max(200),
  domain: hostName,
  name: z.string().trim().min(2).max(160),
  type: z.enum(['api', 'feed', 'website', 'manual']),
  adapter: z.enum(['tekun', 'page_monitor', 'manual']),
  hosts: z.string().max(2000),
  urls: z.string().max(20000).default(''),
  method: z.enum(['public_pages', 'official_api', 'official_feed', 'manual_entry']),
  restrictions: optional(z.string().trim().max(2000)),
});

export async function registerSourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const values = nonSecretValues(raw);
  const p = registerSchema.safeParse(raw);
  if (!p.success) {
    const key = String(p.error.issues[0]?.path[0] ?? '');
    return adminFailure(['agencyCode', 'agencyName', 'domain'].includes(key) ? 'agency' : key === 'hosts' ? 'hosts' : 'field', values, { field: key });
  }
  const d = p.data;
  const hosts = [...new Set(lines(d.hosts, /,|\r?\n/, 6).map((h) => h.toLowerCase()))];
  const urls = lines(d.urls, /\r?\n/, 200);
  if (hosts.length < 1 || hosts.length > 5 || !hosts.every((h) => hostName.safeParse(h).success)) return adminFailure('hosts', values);
  // Every page must be https on an approved site; the database and the fetcher check this again.
  const urlOk = (u: string) => {
    const m = /^https:\/\/([a-z0-9.-]+)(?::443)?\/\S*$/i.exec(u);
    return Boolean(m && hosts.includes(m[1]!.toLowerCase()));
  };
  if (!urls.every(urlOk)) return adminFailure('field', values, { field: 'urls' });
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await registerGovSource(supabase, {
    agencyCode: d.agencyCode, agencyName: d.agencyName, domain: d.domain, name: d.name, type: d.type, adapter: d.adapter, hosts, urls, method: d.method, restrictions: d.restrictions ?? null,
  });
  if (!r.ok) return failure(r.errorKey, values);
  revalidatePath('/', 'layout');
  return success('gov.admin.src.registered');
}

const intField = (min: number, max: number) => optional(z.coerce.number().int().min(min).max(max));
const sourceChangeSchema = z.object({
  sourceId: z.uuid(),
  refresh: intField(15, 43200),
  rate: intField(1, 60),
  freshness: intField(1, 8760),
  enable: z.enum(['keep', 'on', 'off']).default('keep'),
  reason,
});

/** Proposes only what differs from the stored source; a different administrator must approve it before it takes effect. */
export async function proposeSourceChangeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const values = nonSecretValues(raw);
  const t = await adminTranslator(formData);
  const p = sourceChangeSchema.safeParse(raw);
  if (!p.success) {
    const key = String(p.error.issues[0]?.path[0] ?? '');
    if (key === 'reason') return failure('reason', values);
    const label = { refresh: 'src.refresh', rate: 'src.rate', freshness: 'src.freshness' }[key];
    return adminFailure('field', values, { field: label ? t(label) : key });
  }
  const d = p.data;
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const { data: cur } = await supabase.from('gov_sources').select('enabled, refresh_interval_minutes, rate_per_minute, freshness_hours').eq('id', d.sourceId).maybeSingle();
  if (!cur) return failure('not_found', values);
  const change: Record<string, unknown> = {};
  if (d.refresh !== undefined && d.refresh !== cur.refresh_interval_minutes) change.refresh_interval_minutes = d.refresh;
  if (d.rate !== undefined && d.rate !== cur.rate_per_minute) change.rate_per_minute = d.rate;
  if (d.freshness !== undefined && d.freshness !== cur.freshness_hours) change.freshness_hours = d.freshness;
  if (d.enable !== 'keep' && (d.enable === 'on') !== cur.enabled) change.enabled = d.enable === 'on';
  if (Object.keys(change).length === 0) return adminFailure('no_source_change', values);
  const r = await proposeGovSourceChange(supabase, d.sourceId, change, d.reason);
  if (!r.ok) return failure(r.errorKey, values);
  revalidatePath('/', 'layout');
  return success('gov.admin.src.proposed');
}

const sourceDecisionSchema = z.object({ changeId: z.uuid(), approve: z.enum(['true', 'false']), reason });
export async function decideSourceChangeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const p = sourceDecisionSchema.safeParse(raw);
  if (!p.success) return failure(p.error.issues.some((i) => i.path[0] === 'reason') ? 'reason' : 'decision', nonSecretValues(raw));
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await decideGovSourceChange(supabase, p.data.changeId, p.data.approve === 'true', p.data.reason);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(raw));
  revalidatePath('/', 'layout');
  return success('gov.admin.src.decided');
}

const recheckSchema = z.object({ sourceId: z.uuid(), reason });

export async function requestRecheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formToObject(formData);
  const values = nonSecretValues(raw);
  const p = recheckSchema.safeParse(raw);
  if (!p.success) return failure('reason', values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await requestGovRecheck(supabase, p.data.sourceId, p.data.reason);
  if (!r.ok) return failure(r.errorKey, values);
  revalidatePath('/', 'layout');
  return success(r.data > 0 ? 'gov.admin.src.recheckQueued' : 'gov.admin.src.recheckNone');
}
