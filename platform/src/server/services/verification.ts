import type { ClaimType } from '@/lib/schemas';
import { failFrom, ok, type Db, type Result } from './result';

export type ClaimStatus = 'draft' | 'submitted' | 'in_review' | 'needs_info' | 'approved' | 'rejected' | 'stale' | 'withdrawn';

export interface Category {
  id: string;
  slug: string;
  name_en: string;
  name_ta: string;
}

export interface BusinessProfile {
  org_id: string;
  business_name: string;
  category_id: string;
  registration_status: 'registered' | 'unregistered';
  ssm_number: string | null;
  business_type: string | null;
  state: string | null;
  district: string | null;
}

export interface BusinessPrivate {
  address_line: string | null;
  postcode: string | null;
}

export interface Representative {
  full_name: string;
  role_title: string;
  contact_email: string | null;
  contact_phone: string | null;
}

export interface Claim {
  id: string;
  org_id: string;
  claim_type: ClaimType;
  status: ClaimStatus;
  version: number;
  snapshot: Record<string, string | null> | null;
  owner_note: string | null;
  submitted_at: string | null;
  reviewer_id: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  claim_id: string;
  doc_type: string;
  display_name: string;
  mime_type: string;
  size_bytes: number;
  scan_status: 'pending' | 'clean' | 'infected' | 'failed';
  created_at: string;
}

export interface EventRow {
  id: number;
  at: string;
  claim_id: string;
  event: string;
  details: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  org_id: string | null;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  read_at: string | null;
}

const CLAIM_COLUMNS =
  'id, org_id, claim_type, status, version, snapshot, owner_note, submitted_at, reviewer_id, decided_at, decision_reason, updated_at';
const DOC_COLUMNS = 'id, claim_id, doc_type, display_name, mime_type, size_bytes, scan_status, created_at';

export async function listCategories(db: Db): Promise<Category[]> {
  const { data } = await db.from('business_categories').select('id, slug, name_en, name_ta').order('sort');
  return (data ?? []) as Category[];
}

export async function getBusinessProfile(db: Db, orgId: string): Promise<BusinessProfile | null> {
  const { data } = await db
    .from('business_profiles')
    .select('org_id, business_name, category_id, registration_status, ssm_number, business_type, state, district')
    .eq('org_id', orgId)
    .maybeSingle();
  return (data as BusinessProfile | null) ?? null;
}

/** Readable only with business:edit (RLS); null for everyone else. */
export async function getBusinessPrivate(db: Db, orgId: string): Promise<BusinessPrivate | null> {
  const { data } = await db.from('business_private').select('address_line, postcode').eq('org_id', orgId).maybeSingle();
  return (data as BusinessPrivate | null) ?? null;
}

export async function getRepresentative(db: Db, orgId: string): Promise<Representative | null> {
  const { data } = await db
    .from('business_representatives')
    .select('full_name, role_title, contact_email, contact_phone')
    .eq('org_id', orgId)
    .maybeSingle();
  return (data as Representative | null) ?? null;
}

export async function saveBusinessProfile(db: Db, orgId: string, data: Record<string, string | undefined>): Promise<Result<null>> {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  const { error } = await db.rpc('save_business_profile', { p_org: orgId, p_data: clean });
  return error ? failFrom(error) : ok(null);
}

export async function saveRepresentative(
  db: Db,
  orgId: string,
  r: { name: string; role: string; email?: string; phone?: string },
): Promise<Result<null>> {
  const { error } = await db.rpc('save_representative', {
    p_org: orgId,
    p_name: r.name,
    p_role: r.role,
    p_email: r.email ?? null,
    p_phone: r.phone ?? null,
  });
  return error ? failFrom(error) : ok(null);
}

export interface ClaimSummary {
  claim_type: ClaimType;
  status: ClaimStatus;
  decided_at: string | null;
}

/** Status of every claim, readable by ANY member of the organisation (RPC get_verification_summary): no reasons, notes or documents. */
export async function getVerificationSummary(db: Db, orgId: string): Promise<ClaimSummary[]> {
  const { data, error } = await db.rpc('get_verification_summary', { p_org: orgId });
  if (error) return [];
  return (data ?? []) as ClaimSummary[];
}

export async function listClaims(db: Db, orgId: string): Promise<Claim[]> {
  const { data } = await db.from('verification_claims').select(CLAIM_COLUMNS).eq('org_id', orgId);
  return (data ?? []) as Claim[];
}

export async function getClaim(db: Db, claimId: string): Promise<Claim | null> {
  const { data } = await db.from('verification_claims').select(CLAIM_COLUMNS).eq('id', claimId).maybeSingle();
  return (data as Claim | null) ?? null;
}

/** Documents that have not been removed, for one organisation (owner view) or one claim. */
export async function listDocuments(db: Db, scope: { orgId?: string; claimIds?: string[] }): Promise<DocumentRow[]> {
  let q = db.from('verification_documents').select(DOC_COLUMNS).is('removed_at', null).order('created_at');
  if (scope.orgId) q = q.eq('org_id', scope.orgId);
  if (scope.claimIds) q = q.in('claim_id', scope.claimIds);
  const { data } = await q;
  return (data ?? []) as DocumentRow[];
}

/** Documents attached to a given submitted version of a claim. */
export async function listAttachedDocuments(db: Db, claimId: string, version: number): Promise<DocumentRow[]> {
  const { data: links } = await db.from('verification_claim_documents').select('document_id').eq('claim_id', claimId).eq('version', version);
  const ids = ((links ?? []) as { document_id: string }[]).map((l) => l.document_id);
  if (!ids.length) return [];
  const { data } = await db.from('verification_documents').select(DOC_COLUMNS).in('id', ids).order('created_at');
  return (data ?? []) as DocumentRow[];
}

export async function listEvents(db: Db, claimIds: string[]): Promise<EventRow[]> {
  if (!claimIds.length) return [];
  const { data } = await db
    .from('verification_events')
    .select('id, at, claim_id, event, details')
    .in('claim_id', claimIds)
    .order('at', { ascending: true })
    .order('id', { ascending: true });
  return (data ?? []) as EventRow[];
}

export async function submitClaim(db: Db, orgId: string, type: ClaimType, documentIds: string[], note?: string): Promise<Result<null>> {
  const { error } = await db.rpc('submit_claim', { p_org: orgId, p_type: type, p_document_ids: documentIds, p_note: note ?? null });
  return error ? failFrom(error) : ok(null);
}

export async function withdrawClaim(db: Db, claimId: string): Promise<Result<null>> {
  const { error } = await db.rpc('withdraw_claim', { p_claim: claimId });
  return error ? failFrom(error) : ok(null);
}

/** Returns the storage path the caller must delete. */
export async function removeDocument(db: Db, docId: string): Promise<Result<string>> {
  const { data, error } = await db.rpc('remove_document', { p_doc: docId });
  return error ? failFrom(error) : ok(String(data));
}

export async function startReview(db: Db, claimId: string): Promise<Result<null>> {
  const { error } = await db.rpc('start_review', { p_claim: claimId });
  return error ? failFrom(error) : ok(null);
}

export async function decideClaim(
  db: Db,
  claimId: string,
  decision: 'approve' | 'reject' | 'request_info',
  reason: string,
  expectedVersion: number,
): Promise<Result<null>> {
  const { error } = await db.rpc('decide_claim', {
    p_claim: claimId,
    p_decision: decision,
    p_reason: reason,
    p_expected_version: expectedVersion,
  });
  return error ? failFrom(error) : ok(null);
}

export async function listNotifications(db: Db, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationRow[]> {
  let q = db
    .from('notifications')
    .select('id, org_id, kind, entity_type, entity_id, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.unreadOnly) q = q.is('read_at', null);
  const { data } = await q;
  return (data ?? []) as NotificationRow[];
}

export async function markNotificationRead(db: Db, id: string): Promise<Result<null>> {
  const { error } = await db.rpc('mark_notification_read', { p_id: id });
  return error ? failFrom(error) : ok(null);
}

// ---------------------------------------------------------------------------------------------------------------
// Review queue (platform reviewers; RLS limits what comes back)
// ---------------------------------------------------------------------------------------------------------------

export interface QueueItem extends Claim {
  org_name: string;
  age_days: number | null;
}

export async function queueCounts(db: Db): Promise<Record<string, number>> {
  const { data } = await db.from('verification_claims').select('status').limit(5000);
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as { status: string }[]) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

export async function listQueue(db: Db, filter: string, now = Date.now()): Promise<QueueItem[]> {
  let q = db.from('verification_claims').select(CLAIM_COLUMNS).not('submitted_at', 'is', null).order('submitted_at', { ascending: true }).limit(200);
  if (filter === 'open') q = q.in('status', ['submitted', 'in_review']);
  else if (filter !== 'all') q = q.eq('status', filter);
  const { data } = await q;
  const claims = (data ?? []) as Claim[];
  const orgIds = [...new Set(claims.map((c) => c.org_id))];
  const names = new Map<string, string>();
  if (orgIds.length) {
    const { data: orgs } = await db.from('organisations').select('id, name').in('id', orgIds);
    for (const o of (orgs ?? []) as { id: string; name: string }[]) names.set(o.id, o.name);
  }
  return claims.map((c) => ({
    ...c,
    org_name: names.get(c.org_id) ?? '',
    age_days: c.submitted_at ? Math.max(0, Math.floor((now - new Date(c.submitted_at).getTime()) / 86_400_000)) : null,
  }));
}

export async function getOrgName(db: Db, orgId: string): Promise<string> {
  const { data } = await db.from('organisations').select('name').eq('id', orgId).maybeSingle();
  return ((data as { name: string } | null)?.name) ?? '';
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------

export type NextStep =
  | { key: 'start'; href: 'onboarding'; step: 1 }
  | { key: 'registration'; href: 'onboarding'; step: 2 }
  | { key: 'location'; href: 'onboarding'; step: 3 }
  | { key: 'representative'; href: 'onboarding'; step: 4 }
  | { key: 'documents'; href: 'onboarding'; step: 5 }
  | { key: 'fix'; href: 'verification' }
  | { key: 'wait'; href: 'verification' }
  | { key: 'preview'; href: 'preview' };

/** Claim types that apply to a profile (registration only when the business says it is registered). */
export function applicableClaims(profile: Pick<BusinessProfile, 'registration_status'> | null): ClaimType[] {
  if (!profile) return [];
  return profile.registration_status === 'registered'
    ? ['business_registration', 'business_location', 'representative_authority']
    : ['business_location', 'representative_authority'];
}

/** The single recommended next action for the owner. */
export function recommendNextStep(args: {
  profile: BusinessProfile | null;
  priv: BusinessPrivate | null;
  rep: Representative | null;
  claims: Pick<Claim, 'claim_type' | 'status'>[];
}): NextStep {
  const { profile, priv, rep, claims } = args;
  if (!profile) return { key: 'start', href: 'onboarding', step: 1 };
  if (profile.registration_status === 'registered' && !profile.ssm_number) return { key: 'registration', href: 'onboarding', step: 2 };
  if (!profile.state || (priv && !priv.address_line)) return { key: 'location', href: 'onboarding', step: 3 };
  if (!rep) return { key: 'representative', href: 'onboarding', step: 4 };

  const byType = new Map(claims.map((c) => [c.claim_type, c]));
  const needing = applicableClaims(profile).map((t) => byType.get(t));
  if (needing.some((c) => c && ['needs_info', 'rejected', 'stale'].includes(c.status))) return { key: 'fix', href: 'verification' };
  if (needing.some((c) => !c || ['draft', 'withdrawn'].includes(c.status))) return { key: 'documents', href: 'onboarding', step: 5 };
  if (needing.some((c) => c && ['submitted', 'in_review'].includes(c.status))) return { key: 'wait', href: 'verification' };
  return { key: 'preview', href: 'preview' };
}

/** Statuses in which the owner may add documents and (re)submit. */
export const EDITABLE_STATUSES: readonly (ClaimStatus | 'none')[] = ['none', 'draft', 'needs_info', 'rejected', 'stale', 'withdrawn'];
export const WITHDRAWABLE_STATUSES: readonly ClaimStatus[] = ['submitted', 'in_review', 'needs_info'];
