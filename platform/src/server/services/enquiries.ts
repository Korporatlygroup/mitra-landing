import { failFrom, ok, type Db, type Result } from './result';

async function rpc<T>(db: Db, name: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await db.rpc(name, args);
  return error ? failFrom(error) : ok(data as T);
}

export interface MessageRow {
  id: string; enquiry_id: string; sender_user_id: string | null; sender_org_id: string; body: string; created_at: string;
}
export interface QuoteRow {
  id: string; enquiry_id: string; seller_org_id: string; buyer_org_id: string; status: string;
  current_version_id: string | null; accepted_version_id: string | null; version: number;
}
export interface QuoteVersionRow {
  id: string; quotation_id: string; version_number: number; currency: string; scope_text: string;
  exclusions: string | null; tax_treatment: string; delivery_timing: string; terms_text: string | null;
  valid_until: string; subtotal: string; delivery_fee: string; tax_amount: string; total: string; sent_at: string;
  booking_date: string | null; completion_by: string | null; deposit_terms: string | null; cancellation_option: string | null; cancellation_text: string | null;
}
export interface QuoteItemRow {
  id: string; quote_version_id: string; description: string; quantity: string; unit: string; unit_price: string; line_total: string; sort_order: number;
}
export interface LeadActivityRow {
  id: string; enquiry_id: string; seller_org_id: string; stage: string; note: string | null; next_follow_up_at: string | null; recorded_at: string;
}
export interface ReviewRow {
  id: string; enquiry_id: string; buyer_org_id: string; seller_org_id: string; rating: number;
  review_text: string; status: string; seller_response: string | null; seller_response_status: string | null; moderation_reason: string | null; created_at: string;
}
export interface ReferralRow {
  id: string; enquiry_id: string; proposed_seller_org_id: string; status: string;
  buyer_consented_at: string | null; recipient_accepted_at: string | null; created_at: string;
}

export const MESSAGE_PAGE_SIZE = 50;

/** `before` (an ISO time) loads the page of messages older than it. Older history is never dropped: the caller shows a link while `hasEarlier` is true. */
export async function getEnquiryWorkspace(db: Db, enquiryId: string, before?: string | null) {
  const [messages, quote, leads, reviews, referrals] = await Promise.all([
    (before ? db.from('enquiry_messages').select('id,enquiry_id,sender_user_id,sender_org_id,body,created_at').eq('enquiry_id', enquiryId).lt('created_at', before) : db.from('enquiry_messages').select('id,enquiry_id,sender_user_id,sender_org_id,body,created_at').eq('enquiry_id', enquiryId)).order('created_at', { ascending: false }).limit(MESSAGE_PAGE_SIZE + 1),
    db.from('quotations').select('id,enquiry_id,seller_org_id,buyer_org_id,status,current_version_id,accepted_version_id,version').eq('enquiry_id', enquiryId).maybeSingle(),
    db.from('lead_activities').select('id,enquiry_id,seller_org_id,stage,note,next_follow_up_at,recorded_at').eq('enquiry_id', enquiryId).order('recorded_at', { ascending: false }).limit(20),
    db.from('business_reviews').select('id,enquiry_id,buyer_org_id,seller_org_id,rating,review_text,status,seller_response,seller_response_status,moderation_reason,created_at').eq('enquiry_id', enquiryId).maybeSingle(),
    db.from('referral_suggestions').select('id,enquiry_id,proposed_seller_org_id,status,buyer_consented_at,recipient_accepted_at,created_at').eq('enquiry_id', enquiryId).order('created_at', { ascending: false }).limit(20),
  ]);
  const q = (quote.data as QuoteRow | null) ?? null;
  const draft = q ? await db.from('quotation_drafts').select('data').eq('quotation_id', q.id).maybeSingle() : null;
  const versions = q ? await db.from('quotation_versions').select('id,quotation_id,version_number,currency,scope_text,exclusions,tax_treatment,delivery_timing,terms_text,valid_until,subtotal,delivery_fee,tax_amount,total,sent_at,booking_date,completion_by,deposit_terms,cancellation_option,cancellation_text').eq('quotation_id', q.id).order('version_number', { ascending: false }) : null;
  const ids = ((versions?.data ?? []) as QuoteVersionRow[]).map((v) => v.id);
  const items = ids.length ? await db.from('quotation_line_items').select('id,quote_version_id,description,quantity,unit,unit_price,line_total,sort_order').in('quote_version_id', ids).order('sort_order') : null;
  return {
    messages: ((messages.data ?? []) as MessageRow[]).slice(0, MESSAGE_PAGE_SIZE).reverse(), hasEarlier: (messages.data ?? []).length > MESSAGE_PAGE_SIZE, quote: q, draft: (draft?.data?.data as Record<string, unknown> | undefined) ?? null,
    leads: (leads.data ?? []) as LeadActivityRow[],
    review: (reviews.data as ReviewRow | null) ?? null, referrals: (referrals.data ?? []) as ReferralRow[],
    versions: (versions?.data ?? []) as QuoteVersionRow[], items: (items?.data ?? []) as QuoteItemRow[],
  };
}

export const postMessage = (db: Db, enquiryId: string, body: string, key: string) =>
  rpc<string>(db, 'post_enquiry_message', { p_enquiry: enquiryId, p_body: body, p_key: key });
export const saveQuoteDraft = (db: Db, enquiryId: string, draft: Record<string, unknown>, expectedVersion: number) =>
  rpc<string>(db, 'save_quote_draft', { p_enquiry: enquiryId, p_draft: draft, p_expected_version: expectedVersion });
export const sendQuoteVersion = (db: Db, quotationId: string, expectedVersion: number) =>
  rpc<string>(db, 'send_quote_version', { p_quotation: quotationId, p_expected_version: expectedVersion });
export const respondToQuote = (db: Db, quotationId: string, versionId: string, action: string, reason: string | null, expectedVersion: number) =>
  rpc<string>(db, 'respond_to_quote', { p_quotation: quotationId, p_version: versionId, p_action: action, p_reason: reason, p_expected_version: expectedVersion });
export const withdrawQuote = (db: Db, quotationId: string, expectedVersion: number) =>
  rpc<null>(db, 'withdraw_quote', { p_quotation: quotationId, p_expected_version: expectedVersion });
export const recordLead = (db: Db, enquiryId: string, stage: string, note: string | null, followUpAt: string | null) =>
  rpc<string>(db, 'record_lead_activity', { p_enquiry: enquiryId, p_stage: stage, p_note: note, p_follow_up: followUpAt });
export const proposeReferral = (db: Db, enquiryId: string, sellerOrgId: string) =>
  rpc<string>(db, 'propose_referral', { p_enquiry: enquiryId, p_proposed_seller: sellerOrgId });
export const respondToReferral = (db: Db, referralId: string, accept: boolean) =>
  rpc<string>(db, 'respond_to_referral', { p_referral: referralId, p_accept: accept });
export const submitReview = (db: Db, enquiryId: string, rating: number, text: string) =>
  rpc<string>(db, 'submit_business_review', { p_enquiry: enquiryId, p_rating: rating, p_text: text });
export const respondToReview = (db: Db, reviewId: string, text: string) =>
  rpc<null>(db, 'respond_to_business_review', { p_review: reviewId, p_text: text });

export interface SellerLeadMetrics {
  enquiries_received: number; enquiries_answered: number; quotes_sent: number; median_response_minutes: number | null;
  follow_ups_due: number; reported_wins: number; reported_losses: number; published_reviews: number;
}
export const sellerLeadMetrics = (db: Db, orgId: string) =>
  rpc<SellerLeadMetrics>(db, 'seller_lead_metrics', { p_seller_org: orgId });
