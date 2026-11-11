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
  'already_reported', 'report_not_open', 'contact_in_public_text', 'request_response_limit',
  'enquiry_closed', 'invalid_message', 'quote_expired', 'invalid_referral', 'invalid_review',
  'review_not_eligible', 'invalid_quote', 'invalid_line', 'amount_too_large',
  // Phase 5 static keys (private.raise_error second argument; see docs/contracts/phase5-rpc-reference.md)
  'below_moq', 'code_exists', 'currency_required', 'duplicate_item', 'empty_file', 'file_too_large', 'formula_text',
  'idempotency_key_reused', 'invalid_action', 'invalid_alt', 'invalid_capabilities', 'invalid_checks', 'invalid_code', 'invalid_currency',
  'invalid_file_hash', 'invalid_file_name', 'invalid_mode', 'invalid_moq', 'invalid_path', 'invalid_price', 'invalid_row_number',
  'invalid_sku', 'invalid_sort', 'invalid_variant', 'invalid_website', 'items_required', 'job_not_previewed', 'media_limit_reached',
  'mixed_suppliers', 'no_valid_rows', 'org_not_partner', 'overwrite_confirmation_required', 'partner_not_approved',
  'product_limit_reached', 'product_not_pending', 'product_not_publishable', 'product_not_published', 'product_not_suspendable',
  'product_not_suspended', 'product_suspended', 'product_under_review', 'reference_unavailable', 'saved_limit_reached', 'sku_exists',
  'supplier_incomplete', 'supplier_limit_reached', 'supplier_not_approved', 'supplier_not_available', 'supplier_not_pending',
  'supplier_not_suspended', 'supplier_suspended', 'supplier_under_review', 'too_many_items', 'too_many_rows', 'unknown_field',
  'revision_immutable',
] as const;

/**
 * Phase 5 validator keys (private.validate_product_data and the import staging). They may carry a detail after the first ':'
 * (a field name or a 1-based index), for example `too_long:description` or `invalid_tier:3`. They map by the part before ':'.
 * Each has a message under `errors.*`.
 */
export const P5_VALIDATOR_KEYS = [
  'invalid_data', 'name_required', 'unit_required', 'category_required', 'moq_required', 'price_mode_required',
  'availability_required', 'availability_date_required', 'price_date_required', 'currency_required', 'price_required',
  'tiers_required', 'tiers_not_allowed', 'unit_price_not_allowed', 'price_not_allowed', 'invalid_name', 'invalid_sku',
  'invalid_category', 'invalid_moq', 'invalid_currency', 'invalid_price', 'invalid_price_mode', 'invalid_availability',
  'invalid_spec', 'too_many_specs', 'too_many_variants', 'too_many_tiers', 'tier_not_ascending', 'tier_overlap', 'tier_gap',
  'tier_last_not_open', 'tier_does_not_cover_moq',
  // families that carry a detail
  'unknown_field', 'formula_text', 'too_long', 'invalid_text', 'invalid_date', 'future_date', 'invalid_lead_time',
  'invalid_variant', 'invalid_variant_sku', 'duplicate_variant_sku', 'invalid_variant_moq', 'invalid_tier', 'invalid_tier_qty',
  'tier_unknown_variant',
  // import staging
  'client_validation_failed', 'invalid_row', 'row_too_large', 'duplicate_sku_in_file', 'sku_exists', 'product_suspended',
  'product_under_review',
] as const;

/** Generic keys for any other `<field>_required` / `invalid_<field>` (PT422) validator key without its own message. */
export const FIELD_REQUIRED_KEY = 'field_required';
export const FIELD_INVALID_KEY = 'field_invalid';

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
  // Phase 5 validator keys: map by the part before the first ':' (the detail is a field name or an index).
  const base = msg.split(':')[0];
  if ((P5_VALIDATOR_KEYS as readonly string[]).includes(base)) return base;
  if (/^[a-z][a-z_]{1,40}_required$/.test(base)) return FIELD_REQUIRED_KEY;
  if (error.code === 'PT422' && /^invalid_[a-z_]{1,40}$/.test(base)) return FIELD_INVALID_KEY;
  const code = error.code ?? '';
  if (code in CODE_KEYS) return CODE_KEYS[code];
  // Postgres "insufficient privilege" / RLS denial surfaces as 42501 or 403-ish.
  if (code === '42501') return 'forbidden';
  return FALLBACK_KEY;
}

/**
 * Detail after the first ':' of a validator key (a field name or 1-based index), or the field of `<field>_required`.
 * Only returned when it is short and made of [A-Za-z0-9_[].], so it is safe to use as a label hint.
 */
export function rpcErrorDetail(error: RpcErrorLike | null | undefined): string | null {
  const msg = (error?.message ?? '').trim();
  const i = msg.indexOf(':');
  if (i > 0) {
    const d = msg.slice(i + 1);
    return /^[\w[\].]{1,40}$/.test(d) ? d : null;
  }
  const m = msg.match(/^([a-z][a-z_]{1,40})_required$/);
  return m ? m[1] : null;
}

/** All keys this module can return (used by tests to check the message files). */
export function allErrorKeys(): string[] {
  return [
    ...new Set([...KNOWN_MESSAGE_KEYS, ...P5_VALIDATOR_KEYS, ...Object.values(CODE_KEYS), FALLBACK_KEY, FIELD_REQUIRED_KEY, FIELD_INVALID_KEY]),
  ];
}
