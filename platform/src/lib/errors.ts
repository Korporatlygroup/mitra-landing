/**
 * Maps database/RPC errors to translated message keys (under the `errors` namespace in messages/*.json).
 * Raw database text is never shown to users.
 */

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

/** Machine keys raised by the migrations (private.raise_error second argument). */
export const KNOWN_MESSAGE_KEYS = [
  'last_owner',
  'invalid_invitation',
  'already_member',
  'invalid_org_type',
  'invalid_name',
  'org_limit_reached',
  'invalid_role',
  'invalid_email',
  'cannot_grant_above_own_role',
  'target_outranks_actor',
  'cannot_change_own_role',
  'invitation_not_pending',
  'immutable_columns',
  'role_not_allowed_for_org_type',
  'mitra_org_cannot_be_suspended',
  'unknown_action',
  'unknown_user',
  'details_too_large',
  'already_bootstrapped',
  'user_not_found_or_unconfirmed',
  'consent_required',
  'invalid_consent',
  'invalid_throttle',
  'invalid_ssm',
  'invalid_state',
  'invalid_postcode',
  'invalid_phone',
  'invalid_category',
  'category_required',
  'org_not_business',
  'profile_required',
  'details_incomplete',
  'documents_not_ready',
  'document_count',
  'claim_not_resubmittable',
  'claim_not_withdrawable',
  'claim_not_reviewable',
  'stale_version',
  'conflict_of_interest',
  'reason_required',
  'invalid_decision',
  'document_in_use',
  'document_not_available',
  'document_limit_reached',
  'invalid_doc_type',
  'infected_not_stored',
  'invalid_note',
  'invalid_data',
  'invalid_description',
  'invalid_registration_status',
  'invalid_business_type',
  'invalid_district',
  'invalid_address',
  'already_scanned',
  'invalid_status',
  'invalid_reason',
  'invalid_hash',
  'evidence_not_clean',
  'org_not_active',
  'invalid_headline', 'invalid_service_name', 'service_area_required', 'invalid_min_order', 'invalid_lead_time',
  'too_many_services', 'too_many_portfolio', 'invalid_portfolio', 'invalid_query', 'listing_incomplete', 'listing_under_review',
  'listing_not_pending', 'listing_not_live', 'nothing_to_submit', 'invalid_title', 'invalid_quantity', 'invalid_unit',
  'invalid_date', 'invalid_budget', 'request_incomplete', 'request_not_open', 'request_not_editable', 'duplicate_request',
  'contact_required', 'request_limit_reached', 'draft_limit_reached', 'invite_limit_reached', 'not_a_candidate',
  'seller_not_available', 'already_responded', 'invalid_response', 'seller_not_accepting', 'same_organisation',
  'already_reported', 'report_not_open',
  'enquiry_closed', 'invalid_message', 'quote_expired', 'invalid_referral', 'invalid_review',
  'review_not_eligible', 'invalid_quote', 'invalid_line', 'amount_too_large',
] as const;

/** Default machine keys per PTnnn code (private.raise_error default messages). */
export const CODE_KEYS: Record<string, string> = {
  PT401: 'unauthenticated',
  PT403: 'forbidden',
  PT404: 'not_found',
  PT409: 'conflict',
  PT422: 'invalid',
  PT429: 'rate_limited',
  PT500: 'internal',
};

export const FALLBACK_KEY = 'internal';

/** Returns a key inside the `errors` namespace (e.g. "last_owner"). Always a key that exists in the messages. */
export function mapRpcError(error: RpcErrorLike | null | undefined): string {
  if (!error) return FALLBACK_KEY;
  const msg = (error.message ?? '').trim();
  if ((KNOWN_MESSAGE_KEYS as readonly string[]).includes(msg)) return msg;
  const code = error.code ?? '';
  if (code in CODE_KEYS) return CODE_KEYS[code];
  // Postgres "insufficient privilege" / RLS denial surfaces as 42501 or 403-ish.
  if (code === '42501') return 'forbidden';
  return FALLBACK_KEY;
}

/** All keys this module can return (used by tests to check the message files). */
export function allErrorKeys(): string[] {
  return [...new Set([...KNOWN_MESSAGE_KEYS, ...Object.values(CODE_KEYS), FALLBACK_KEY])];
}
