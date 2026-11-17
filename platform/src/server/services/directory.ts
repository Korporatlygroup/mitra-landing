import { failFrom, ok, type Db, type Result } from './result';

/** Services for Phase 3: directory listings, customer requests, matching, invitations, reports. Each call is one RPC. */

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await db.rpc(fn, args);
  return error ? failFrom(error) : ok(data as T);
}

// ------------------------------------------------------------------------------------------------ types

export interface ReviewedClaim {
  claim_type: 'business_registration' | 'business_location' | 'representative_authority';
  decided_at: string | null;
}

export interface ListingCard {
  slug: string;
  name: string;
  category: { slug: string; name_en: string; name_ta: string };
  state: string | null;
  district: string | null;
  headline: string | null;
  summary?: string | null;
  services: string[];
  serves_nationwide: boolean;
  serves_states: string[];
  reviewed: ReviewedClaim[];
  accepting_requests: boolean;
  published_at: string | null;
}

export interface ServiceDetail {
  name: string;
  description: string | null;
  category_slug: string;
  nationwide: boolean;
  areas: string[];
  min_order_qty: number | null;
  min_order_unit: string | null;
  lead_time_days: number | null;
  capacity_note: string | null;
}

export interface ListingDetail extends ListingCard {
  description: string | null;
  phone: string | null;
  email: string | null;
  links?: Partial<Record<'whatsapp' | 'website' | 'facebook' | 'instagram' | 'tiktok' | 'linkedin' | 'youtube' | 'google_maps', string>> | null;
  hours?: string | null;
  service_details: ServiceDetail[];
  portfolio: { title: string; description: string | null; category_slug?: string | null; project_date?: string | null }[];
}

export interface SearchResult {
  total: number;
  limit: number;
  offset: number;
  items: ListingCard[];
  categories: { slug: string; name_en: string; name_ta: string }[];
}

export const PAGE_SIZE = 12;

export interface DraftService {
  name: string;
  description: string | null;
  category_slug: string;
  nationwide: boolean;
  areas: string[];
  min_order_qty: number | null;
  min_order_unit: string | null;
  lead_time_days: number | null;
  capacity_note: string | null;
}

export interface ListingDraft {
  headline?: string | null;
  description?: string | null;
  show_phone?: boolean;
  show_email?: boolean;
  public_phone?: string | null;
  public_email?: string | null;
  links?: Record<string, string | null>;
  hours?: string | null;
  services?: DraftService[];
  portfolio?: { title: string; description: string | null; category_slug?: string | null; project_date?: string | null }[];
  profile?: { business_name: string; category_id: string; state: string | null; district: string | null };
}

export type ListingLiveStatus = 'unpublished' | 'published' | 'suspended';
export type ListingReviewStatus = 'editing' | 'pending_review' | 'changes_requested' | 'rejected' | 'approved';

export interface OwnerListing {
  org_id: string;
  slug: string | null;
  live_name: string | null;
  live_status: ListingLiveStatus;
  accepting_requests: boolean;
  live_version: number;
  draft: ListingDraft;
  draft_version: number;
  review_status: ListingReviewStatus;
  review_reason: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  suspended_reason: string | null;
  updated_at: string;
}

export type RequestStatus = 'draft' | 'open' | 'closed' | 'expired' | 'withdrawn' | 'removed';
export type MatchStatus = 'candidate' | 'invited' | 'interested' | 'question' | 'declined' | 'expired' | 'withdrawn';

export interface BuyerRequestRow {
  id: string;
  buyer_org_id: string;
  category_id: string | null;
  title: string | null;
  description: string | null;
  target_state: string | null;
  target_district: string | null;
  quantity: number | null;
  unit: string | null;
  needed_by: string | null;
  budget_min: number | null;
  budget_max: number | null;
  share_contact: boolean;
  visibility: 'private_invite' | 'eligible_sellers';
  status: RequestStatus;
  version: number;
  expires_at: string | null;
  closed_reason: string | null;
  created_at: string;
}

export interface BuyerRequestSummary {
  id: string;
  title: string | null;
  status: RequestStatus;
  target_state: string | null;
  category_slug: string | null;
  created_at: string;
  expires_at: string | null;
  invited: number;
  interested: number;
  declined: number;
}

export interface MatchRow {
  seller_org_id: string;
  status: MatchStatus;
  reason_codes: string[];
  caution_codes: string[];
  invited_at: string | null;
  responded_at: string | null;
  response_note: string | null;
  enquiry_id: string | null;
  available: boolean;
  listing: Partial<ListingCard> & { name: string };
}

export interface SellerInboxRow {
  request_id: string;
  title: string | null;
  category_slug: string | null;
  target_state: string | null;
  quantity: number | null;
  unit: string | null;
  needed_by: string | null;
  match_status: MatchStatus;
  request_status: RequestStatus;
  invited_at: string | null;
  responded_at: string | null;
  enquiry_id: string | null;
  expires_at: string | null;
}

export interface SellerRequestView {
  request_id: string;
  request_status: RequestStatus;
  match_status: MatchStatus;
  invited_at: string | null;
  responded_at: string | null;
  response_note: string | null;
  enquiry_id: string | null;
  expires_at: string | null;
  from_board?: boolean;
  title?: string;
  description?: string;
  category_slug?: string;
  target_state?: string;
  target_district?: string | null;
  quantity?: number | null;
  unit?: string | null;
  needed_by?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  currency?: string;
  caution_codes?: string[];
  reason_codes?: string[];
  buyer_name?: string;
  contact_phone?: string | null;
  contact_email?: string | null;
}

export interface EnquiryRow {
  id: string;
  buyer_org_id: string;
  seller_org_id: string;
  buyer_request_id: string | null;
  origin: 'listing' | 'request_invitation' | 'referral';
  status: string;
  topic: string;
  opening_note: string | null;
  opened_by_org_id: string;
  created_at: string;
}

export interface ListingEvent {
  id: number;
  at: string;
  event: string;
  details: { reason?: string | null; draft_version?: number };
}

export interface ReportRow {
  id: string;
  target_type: 'listing' | 'request';
  listing_org_id: string | null;
  request_id: string | null;
  reason: string;
  note: string | null;
  status: 'open' | 'dismissed' | 'actioned';
  created_at: string;
}

// ------------------------------------------------------------------------------------------------ public directory

export function searchListings(
  db: Db,
  f: { q?: string; category?: string; state?: string; page?: number; limit?: number },
): Promise<Result<SearchResult>> {
  const page = Math.max(1, Math.min(f.page ?? 1, 80));
  const limit = Math.max(1, Math.min(f.limit ?? PAGE_SIZE, 24));
  return rpc<SearchResult>(db, 'search_listings', {
    p_q: f.q || null,
    p_category: f.category || null,
    p_state: f.state || null,
    p_limit: limit,
    p_offset: (page - 1) * limit,
  });
}

export function getListing(db: Db, slug: string): Promise<Result<ListingDetail>> {
  return rpc<ListingDetail>(db, 'get_listing', { p_slug: slug });
}

// ------------------------------------------------------------------------------------------------ seller: listing editor

export async function getOwnerListing(db: Db, orgId: string): Promise<OwnerListing | null> {
  const { data } = await db
    .from('business_listings')
    .select(
      'org_id, slug, live_name, live_status, accepting_requests, live_version, draft, draft_version, review_status, review_reason, submitted_at, decided_at, suspended_reason, updated_at',
    )
    .eq('org_id', orgId)
    .maybeSingle();
  return (data as OwnerListing | null) ?? null;
}

export async function listListingEvents(db: Db, orgId: string, limit = 10): Promise<ListingEvent[]> {
  const { data } = await db
    .from('listing_events')
    .select('id, at, event, details')
    .eq('org_id', orgId)
    .order('at', { ascending: false })
    .limit(limit);
  return (data ?? []) as ListingEvent[];
}

export const saveListingDraft = (db: Db, orgId: string, data: Record<string, unknown>, expectedVersion: number) =>
  rpc<{ version: number }>(db, 'save_listing_draft', { p_org: orgId, p_data: data, p_expected_version: expectedVersion });
export const submitListing = (db: Db, orgId: string, expectedVersion: number) =>
  rpc<null>(db, 'submit_listing', { p_org: orgId, p_expected_version: expectedVersion });
export const withdrawListingSubmission = (db: Db, orgId: string) => rpc<null>(db, 'withdraw_listing_submission', { p_org: orgId });
export const unpublishListing = (db: Db, orgId: string) => rpc<null>(db, 'unpublish_listing', { p_org: orgId });
export const republishListing = (db: Db, orgId: string) => rpc<null>(db, 'republish_listing', { p_org: orgId });
export const setAcceptingRequests = (db: Db, orgId: string, value: boolean) =>
  rpc<null>(db, 'set_accepting_requests', { p_org: orgId, p_value: value });

// ------------------------------------------------------------------------------------------------ buyer: requests

export const saveRequestDraft = (db: Db, orgId: string, requestId: string | null, key: string, data: Record<string, unknown>, expectedVersion: number) =>
  rpc<{ id: string; version: number; status: RequestStatus }>(db, 'save_request_draft', {
    p_org: orgId,
    p_request: requestId,
    p_key: key,
    p_data: data,
    p_expected_version: expectedVersion,
  });
export const submitRequest = (db: Db, requestId: string, expectedVersion: number) =>
  rpc<{ id: string; status: RequestStatus; candidates: number }>(db, 'submit_request', { p_request: requestId, p_expected_version: expectedVersion });
export const findCandidates = (db: Db, requestId: string, broaden: boolean) =>
  rpc<number>(db, 'find_candidates', { p_request: requestId, p_broaden: broaden });
export const inviteSeller = (db: Db, requestId: string, sellerOrgId: string) =>
  rpc<null>(db, 'invite_seller', { p_request: requestId, p_seller_org: sellerOrgId });
export const endRequest = (db: Db, requestId: string, status: 'closed' | 'withdrawn', reason: string | null) =>
  rpc<null>(db, 'end_request', { p_request: requestId, p_status: status, p_reason: reason });

export async function listBuyerRequests(db: Db, orgId: string): Promise<BuyerRequestSummary[]> {
  const r = await rpc<BuyerRequestSummary[]>(db, 'list_buyer_requests', { p_org: orgId });
  return r.ok ? r.data : [];
}

export async function getBuyerRequest(db: Db, id: string): Promise<BuyerRequestRow | null> {
  const { data } = await db
    .from('buyer_requests')
    .select(
      'id, buyer_org_id, category_id, title, description, target_state, target_district, quantity, unit, needed_by, budget_min, budget_max, share_contact, visibility, status, version, expires_at, closed_reason, created_at',
    )
    .eq('id', id)
    .maybeSingle();
  return (data as BuyerRequestRow | null) ?? null;
}

export async function getRequestContact(db: Db, id: string): Promise<{ contact_phone: string | null; contact_email: string | null } | null> {
  const { data } = await db.from('buyer_request_private').select('contact_phone, contact_email').eq('request_id', id).maybeSingle();
  return (data as { contact_phone: string | null; contact_email: string | null } | null) ?? null;
}

export async function listRequestMatches(db: Db, requestId: string): Promise<MatchRow[]> {
  const r = await rpc<MatchRow[]>(db, 'list_request_matches', { p_request: requestId });
  return r.ok ? r.data : [];
}

// ------------------------------------------------------------------------------------------------ seller: inbox

export async function listSellerRequests(db: Db, orgId: string, filter: 'all' | 'new' | 'replied' | 'closed'): Promise<SellerInboxRow[]> {
  const r = await rpc<SellerInboxRow[]>(db, 'list_seller_requests', { p_seller_org: orgId, p_filter: filter });
  return r.ok ? r.data : [];
}

export interface BoardRow {
  request_id: string;
  title: string;
  category_slug: string;
  target_state: string;
  target_district: string | null;
  quantity: number | null;
  unit: string | null;
  needed_by: string | null;
  budget_min: number | null;
  budget_max: number | null;
  created_at: string;
  expires_at: string;
  my_status: MatchStatus | null;
}

export const BOARD_PAGE_SIZE = 20;

/** Requests an organisation may see on the board. The database decides eligibility; nothing here filters for privacy. */
export async function listBoardRequests(
  db: Db,
  orgId: string,
  filters: { category?: string | null; state?: string | null; offset?: number },
): Promise<{ ok: true; total: number; items: BoardRow[] } | { ok: false; errorKey: string }> {
  const r = await rpc<{ total: number; items: BoardRow[] }>(db, 'list_board_requests', {
    p_seller_org: orgId,
    p_category: filters.category || null,
    p_state: filters.state || null,
    p_offset: filters.offset ?? 0,
  });
  return r.ok ? { ok: true, total: r.data.total, items: r.data.items } : { ok: false, errorKey: r.errorKey };
}

export const setRequestVisibility = (db: Db, requestId: string, visibility: 'private_invite' | 'eligible_sellers') =>
  rpc<null>(db, 'set_request_visibility', { p_request: requestId, p_visibility: visibility });

export const getRequestForSeller = (db: Db, requestId: string, orgId: string) =>
  rpc<SellerRequestView>(db, 'get_request_for_seller', { p_request: requestId, p_seller_org: orgId });
export const respondToInvitation = (db: Db, requestId: string, orgId: string, response: 'interested' | 'question' | 'declined', note: string | null) =>
  rpc<{ status: MatchStatus; enquiry_id: string | null }>(db, 'respond_to_invitation', {
    p_request: requestId,
    p_seller_org: orgId,
    p_response: response,
    p_note: note,
  });

// ------------------------------------------------------------------------------------------------ enquiries (P3 seam: identity only)

export const openListingEnquiry = (db: Db, buyerOrgId: string, slug: string, topic: string, note: string) =>
  rpc<{ id: string; created: boolean }>(db, 'open_listing_enquiry', { p_buyer_org: buyerOrgId, p_slug: slug, p_topic: topic, p_note: note });

/** Phase 3 seam for Phase 4 referrals: the accepted recipient opens the enquiry with the customer (idempotent). */
export const openReferralEnquiry = (db: Db, referralId: string) =>
  rpc<{ id: string; created: boolean }>(db, 'open_referral_enquiry', { p_referral: referralId });

export async function getEnquiry(db: Db, id: string): Promise<EnquiryRow | null> {
  const { data } = await db
    .from('enquiries')
    .select('id, buyer_org_id, seller_org_id, buyer_request_id, origin, status, topic, opening_note, opened_by_org_id, created_at')
    .eq('id', id)
    .maybeSingle();
  return (data as EnquiryRow | null) ?? null;
}

// ------------------------------------------------------------------------------------------------ reports and moderation

export const reportContent = (db: Db, type: 'listing' | 'request', target: string, reason: string, note: string | null) =>
  rpc<null>(db, 'report_content', { p_type: type, p_target: target, p_reason: reason, p_note: note });
export const reviewListing = (db: Db, orgId: string, decision: 'approve' | 'reject' | 'request_changes', reason: string | null, expectedVersion: number) =>
  rpc<null>(db, 'review_listing', { p_org: orgId, p_decision: decision, p_reason: reason, p_expected_version: expectedVersion });
export const suspendListing = (db: Db, orgId: string, reason: string) => rpc<null>(db, 'suspend_listing', { p_org: orgId, p_reason: reason });
export const reinstateListing = (db: Db, orgId: string, reason: string) => rpc<null>(db, 'reinstate_listing', { p_org: orgId, p_reason: reason });
export const handleReport = (db: Db, reportId: string, action: 'dismiss' | 'suspend' | 'remove', note: string) =>
  rpc<null>(db, 'handle_report', { p_report: reportId, p_action: action, p_note: note });

export async function listListingQueue(db: Db, filter: 'pending' | 'live' | 'suspended'): Promise<OwnerListing[]> {
  let q = db
    .from('business_listings')
    .select(
      'org_id, slug, live_name, live_status, accepting_requests, live_version, draft, draft_version, review_status, review_reason, submitted_at, decided_at, suspended_reason, updated_at',
    );
  if (filter === 'pending') q = q.eq('review_status', 'pending_review').order('submitted_at', { ascending: true });
  else q = q.eq('live_status', filter === 'live' ? 'published' : 'suspended').order('updated_at', { ascending: false });
  const { data } = await q.limit(100);
  return (data ?? []) as OwnerListing[];
}

export async function listOpenReports(db: Db): Promise<ReportRow[]> {
  const { data } = await db
    .from('content_reports')
    .select('id, target_type, listing_org_id, request_id, reason, note, status, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(100);
  return (data ?? []) as ReportRow[];
}

export async function getRequestForModeration(db: Db, id: string): Promise<Pick<BuyerRequestRow, 'id' | 'title' | 'description' | 'target_state' | 'status'> | null> {
  const { data } = await db.from('buyer_requests').select('id, title, description, target_state, status').eq('id', id).maybeSingle();
  return (data as Pick<BuyerRequestRow, 'id' | 'title' | 'description' | 'target_state' | 'status'> | null) ?? null;
}

export interface EnquiryParties {
  buyer_name: string | null;
  seller_name: string | null;
  seller_slug: string | null;
  you_are: 'buyer' | 'seller';
}

export const getEnquiryParties = (db: Db, id: string) => rpc<EnquiryParties>(db, 'enquiry_parties', { p_enquiry: id });

/** Enquiries the signed-in user can see (RLS), narrowed to the buyer organisations or the seller organisation given. */
export async function listEnquiries(db: Db, f: { buyerOrgIds?: string[]; sellerOrgId?: string }): Promise<EnquiryRow[]> {
  let q = db
    .from('enquiries')
    .select('id, buyer_org_id, seller_org_id, buyer_request_id, origin, status, topic, opening_note, opened_by_org_id, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (f.buyerOrgIds) q = q.in('buyer_org_id', f.buyerOrgIds);
  if (f.sellerOrgId) q = q.eq('seller_org_id', f.sellerOrgId);
  const { data } = await q;
  return (data ?? []) as EnquiryRow[];
}

// ------------------------------------------------------------------------------------------------ duplicates and join requests

export interface PublishedDuplicate {
  slug: string;
  name: string;
  reason: 'ssm' | 'name';
}

/** Published businesses (public information only) that match this registration number or name. */
export function findPublishedDuplicates(db: Db, ssm: string | null, name: string | null): Promise<Result<PublishedDuplicate[]>> {
  return rpc<PublishedDuplicate[]>(db, 'find_published_duplicates', { p_ssm: ssm, p_name: name });
}

export function requestOrgMembership(db: Db, slug: string, message: string | null): Promise<Result<string>> {
  return rpc<string>(db, 'request_org_membership', { p_slug: slug, p_message: message });
}

export interface JoinRequestRow {
  id: string;
  requester_name: string;
  requester_email: string;
  message: string | null;
  status: 'pending' | 'invited' | 'declined';
  created_at: string;
}

export function listJoinRequests(db: Db, org: string): Promise<Result<JoinRequestRow[]>> {
  return rpc<JoinRequestRow[]>(db, 'list_join_requests', { p_org: org });
}

export function resolveJoinRequest(db: Db, request: string, decision: 'invited' | 'declined'): Promise<Result<null>> {
  return rpc<null>(db, 'resolve_join_request', { p_request: request, p_decision: decision });
}

export interface DuplicateFlagRow {
  id: string;
  status: 'open' | 'dismissed' | 'confirmed';
  reason: 'ssm' | 'name';
  created_at: string;
  org_id: string;
  org_name: string;
  other_org_id: string;
  other_org_name: string;
  note: string | null;
}

export function listDuplicateFlags(db: Db, status: DuplicateFlagRow['status'] = 'open'): Promise<Result<DuplicateFlagRow[]>> {
  return rpc<DuplicateFlagRow[]>(db, 'list_duplicate_flags', { p_status: status });
}

export function resolveDuplicateFlag(db: Db, flag: string, decision: 'dismiss' | 'confirm', note: string): Promise<Result<null>> {
  return rpc<null>(db, 'resolve_duplicate_flag', { p_flag: flag, p_decision: decision, p_note: note });
}
