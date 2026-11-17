import { z } from 'zod';
import { CATEGORY_SLUGS, CURRENCIES, UNITS } from '@/server/import/rules';
import { parseDecimal } from '@/server/import/decimal';
import { MEMBER_ROLES } from './permissions';

/**
 * All input schemas. Issue messages are KEYS in the `errors` namespace of messages/*.json,
 * never display text. See SCHEMA_ERROR_KEYS.
 */
/** Phase 5 message keys the schemas above can emit (all have messages under `errors.*`). Part of SCHEMA_ERROR_KEYS. */
export const P5_SCHEMA_ERROR_KEYS = [
  'invalid_description', 'invalid_sku', 'invalid_price', 'invalid_moq', 'invalid_currency', 'invalid_price_mode', 'invalid_availability',
  'invalid_tier', 'invalid_tier_qty', 'invalid_variant', 'invalid_variant_moq', 'invalid_lead_time', 'invalid_spec', 'too_many_specs',
  'too_many_tiers', 'too_many_variants', 'unit_required', 'invalid_capabilities', 'invalid_website', 'invalid_alt', 'invalid_mode',
  'invalid_action', 'invalid_checks', 'invalid_quantity', 'items_required', 'too_many_items', 'invalid_date', 'invalid_description',
] as const;

export const SCHEMA_ERROR_KEYS = [
  'invalid_input',
  'invalid_email',
  'password_weak',
  'invalid_name',
  'terms_required',
  'invalid_role',
  'invalid_code',
  'invalid_org_type',
  'invalid_language',
  'invalid_ssm',
  'invalid_state',
  'invalid_postcode',
  'invalid_phone',
  'invalid_category',
  'category_required',
  'invalid_district',
  'invalid_address',
  'invalid_note',
  'reason_required',
  'invalid_decision',
  'invalid_doc_type',
  ...P5_SCHEMA_ERROR_KEYS,
] as const;

export const LOCALES = ['en', 'ta', 'ms'] as const;
export const localeSchema = z.enum(LOCALES, 'invalid_language');

export const emailSchema = z
  .string('invalid_email')
  .trim()
  .toLowerCase()
  .max(254, 'invalid_email')
  .pipe(z.email('invalid_email'));

/** At least 10 chars with upper, lower and a digit (matches supabase/config.toml). Max 72 = bcrypt input limit. */
export const passwordSchema = z
  .string('password_weak')
  .min(10, 'password_weak')
  .max(72, 'password_weak')
  .regex(/[a-z]/, 'password_weak')
  .regex(/[A-Z]/, 'password_weak')
  .regex(/[0-9]/, 'password_weak');

export const displayNameSchema = z.string('invalid_name').trim().min(1, 'invalid_name').max(120, 'invalid_name');
export const orgNameSchema = z.string('invalid_name').trim().min(2, 'invalid_name').max(160, 'invalid_name');

const checkbox = z
  .union([z.literal('on'), z.literal('true')], 'terms_required')
  .transform(() => true as const);

/** An optional tick box (marketing): absent or unticked is false, ticked is true. Never required. */
export const optionalCheckbox = z
  .union([z.literal('on'), z.literal('true'), z.literal('')])
  .optional()
  .transform((v) => v === 'on' || v === 'true');

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  language: localeSchema,
  acceptTerms: checkbox,
  acceptPrivacy: checkbox,
  acceptMarketing: optionalCheckbox,
  /** What the person came to do (from "List your business"). Only used to route them after email verification; grants nothing. */
  intent: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.enum(['sell']).optional()),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string('invalid_input').min(1, 'invalid_input').max(200, 'invalid_input'),
});

export const memberRoleSchema = z.enum(MEMBER_ROLES, 'invalid_role');
export const orgTypeSchema = z.enum(['business', 'buyer', 'partner'], 'invalid_org_type');
export const uuidSchema = z.uuid('invalid_input');

export const createOrgSchema = z.object({ type: orgTypeSchema, name: orgNameSchema });
export const inviteSchema = z.object({ orgId: uuidSchema, email: emailSchema, role: memberRoleSchema });
export const setRoleSchema = z.object({ orgId: uuidSchema, userId: uuidSchema, role: memberRoleSchema });
export const removeMemberSchema = z.object({ orgId: uuidSchema, userId: uuidSchema });
export const revokeInvitationSchema = z.object({ orgId: uuidSchema, invitationId: uuidSchema });

/** Invitation tokens are 32 random bytes hex-encoded (public.create_invitation). */
export const invitationTokenSchema = z.string('invalid_input').regex(/^[0-9a-f]{64}$/, 'invalid_input');

export const totpCodeSchema = z
  .string('invalid_code')
  .trim()
  .regex(/^[0-9]{6}$/, 'invalid_code');

export const profileSchema = z.object({ displayName: displayNameSchema, language: localeSchema });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const consentSchema = z.object({ acceptTerms: checkbox, acceptPrivacy: checkbox, locale: localeSchema, next: z.string().optional() });
export const emailNotificationsSchema = z.object({ notify: optionalCheckbox, locale: localeSchema });
export const marketingSchema = z.object({ marketing: optionalCheckbox, locale: localeSchema });
export const privacyRequestSchema = z.object({
  type: z.enum(['access', 'correction', 'deletion', 'portability', 'consent_withdrawal', 'complaint', 'other'], 'invalid_request_type'),
  details: z.string('invalid_details').trim().min(1, 'invalid_details').max(2000, 'invalid_details'),
  locale: localeSchema,
});
export const privacyHandleSchema = z.object({
  id: uuidSchema,
  status: z.enum(['in_progress', 'completed', 'rejected'], 'invalid_status'),
  note: z.string().trim().max(2000, 'invalid_note').default(''),
  locale: localeSchema,
});
export const changePasswordSchema = z.object({ password: passwordSchema });

export const auditFilterSchema = z.object({
  action: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)?$/)
    .max(80)
    .optional(),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Phase 2: seller onboarding and verification
// ---------------------------------------------------------------------------------------------------------------

export const SSM_PATTERN = /^([0-9]{12}|[0-9]{6,7}-?[A-Z])$/;
export const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;

export const MY_STATES = [
  'Johor',
  'Kedah',
  'Kelantan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Perak',
  'Perlis',
  'Pulau Pinang',
  'Sabah',
  'Sarawak',
  'Selangor',
  'Terengganu',
  'W.P. Kuala Lumpur',
  'W.P. Labuan',
  'W.P. Putrajaya',
] as const;
export const BUSINESS_TYPES = ['sole_proprietorship', 'partnership', 'sdn_bhd', 'llp', 'other'] as const;
export const REP_ROLES = ['owner', 'director', 'partner', 'authorised_person'] as const;
export const CLAIM_TYPES = ['business_registration', 'business_location', 'representative_authority'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export const DOC_TYPES = ['ssm_certificate', 'ssm_form', 'business_licence', 'address_proof', 'authorisation_letter', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Document types the database accepts per claim type (mirrors service_register_document). */
export const CLAIM_DOC_TYPES: Record<ClaimType, readonly DocType[]> = {
  business_registration: ['ssm_certificate', 'ssm_form', 'business_licence'],
  business_location: ['address_proof', 'business_licence', 'ssm_certificate'],
  representative_authority: ['authorisation_letter', 'ssm_form', 'other'],
};

/** Blank optional form fields become undefined. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const ssmSchema = z
  .string('invalid_ssm')
  .transform((v) => v.replace(/\s/g, '').toUpperCase())
  .pipe(z.string().regex(SSM_PATTERN, 'invalid_ssm'));
export const postcodeSchema = z.string('invalid_postcode').trim().regex(/^[0-9]{5}$/, 'invalid_postcode');
export const phoneSchema = z.string('invalid_phone').trim().regex(PHONE_PATTERN, 'invalid_phone');

const formBase = { orgId: uuidSchema, locale: localeSchema };

export const businessStep1Schema = z.object({
  ...formBase,
  business_name: orgNameSchema,
  category_slug: z.string('category_required').trim().min(1, 'category_required').regex(/^[a-z0-9-]{2,40}$/, 'invalid_category'),
  registered: z.enum(['yes', 'no'], 'invalid_input'),
});
export const businessStep2Schema = z.object({
  ...formBase,
  ssm_number: ssmSchema,
  business_type: z.enum(BUSINESS_TYPES, 'invalid_input'),
});
export const businessStep3Schema = z.object({
  ...formBase,
  state: z.enum(MY_STATES, 'invalid_state'),
  district: optional(z.string().trim().max(80, 'invalid_district')),
  address_line: optional(z.string().trim().max(200, 'invalid_address')),
  postcode: optional(postcodeSchema),
});
export const businessStep4Schema = z.object({
  ...formBase,
  rep_name: z.string('invalid_name').trim().min(2, 'invalid_name').max(120, 'invalid_name'),
  rep_role: z.enum(REP_ROLES, 'invalid_role'),
  rep_email: optional(emailSchema),
  rep_phone: optional(phoneSchema),
});

export const claimTypeSchema = z.enum(CLAIM_TYPES, 'invalid_input');
export const docTypeSchema = z.enum(DOC_TYPES, 'invalid_doc_type');
export const uploadMetaSchema = z.object({ ...formBase, claimType: claimTypeSchema, docType: docTypeSchema });
export const submitClaimSchema = z.object({
  ...formBase,
  claimType: claimTypeSchema,
  note: optional(z.string().trim().max(1000, 'invalid_note')),
});
export const withdrawClaimSchema = z.object({ ...formBase, claimId: uuidSchema });
export const removeDocumentSchema = z.object({ ...formBase, docId: uuidSchema });
export const startReviewSchema = z.object({ locale: localeSchema, claimId: uuidSchema });
export const decisionSchema = z.object({
  locale: localeSchema,
  claimId: uuidSchema,
  decision: z.enum(['approve', 'reject', 'request_info'], 'invalid_decision'),
  reason: z.string('reason_required').trim().min(5, 'reason_required').max(1000, 'reason_required'),
  expectedVersion: z.coerce.number('invalid_input').int('invalid_input').min(0, 'invalid_input'),
});
export const markReadSchema = z.object({ locale: localeSchema, id: uuidSchema });
export const claimStatusFilterSchema = z.enum([
  'open',
  'all',
  'submitted',
  'in_review',
  'needs_info',
  'approved',
  'rejected',
  'stale',
  'withdrawn',
]);

// ---------------------------------------------------------------------------------------------------------------
// Phase 3: directory, customer requests, matching. Field-level validation is repeated in the database (RPCs);
// these schemas only guard the shape of the form so the RPC always receives well-typed input.
// ---------------------------------------------------------------------------------------------------------------

const intField = z.coerce.number('invalid_input').int('invalid_input').min(0, 'invalid_input').max(1_000_000, 'invalid_input');
const checkboxOrEmpty = z.preprocess((v) => v === 'on' || v === 'true', z.boolean());
const shortText = (max: number) => optional(z.string().trim().max(max, 'invalid_input'));

export const listingSaveSchema = z.object({
  ...formBase,
  expectedVersion: intField,
  headline: shortText(160),
  description: shortText(2000),
  public_phone: shortText(20),
  public_email: shortText(254),
  show_phone: checkboxOrEmpty,
  show_email: checkboxOrEmpty,
  // Public links and hours: only the shape is checked here; the database validates hosts, schemes and numbers.
  link_whatsapp: shortText(30),
  link_website: shortText(300),
  link_facebook: shortText(300),
  link_instagram: shortText(300),
  link_tiktok: shortText(300),
  link_linkedin: shortText(300),
  link_youtube: shortText(300),
  link_google_maps: shortText(300),
  hours: shortText(300),
});
export const listingVersionSchema = z.object({ ...formBase, expectedVersion: intField });
export const listingOrgSchema = z.object(formBase);
export const acceptingSchema = z.object({ ...formBase, value: z.enum(['true', 'false'], 'invalid_input') });

export const REQUEST_STEPS = [1, 2, 3, 4, 5] as const;
export const requestStepSchema = z.object({
  locale: localeSchema,
  step: z.coerce.number('invalid_input').int('invalid_input').min(1, 'invalid_input').max(4, 'invalid_input'),
  key: z.string('invalid_input').min(8, 'invalid_input').max(80, 'invalid_input').regex(/^[A-Za-z0-9-]+$/, 'invalid_input'),
  requestId: optional(uuidSchema),
  orgId: optional(uuidSchema),
  expectedVersion: intField,
  title: shortText(140),
  category_slug: shortText(40),
  target_state: shortText(40),
  target_district: shortText(80),
  quantity: shortText(20),
  unit: shortText(30),
  needed_by: shortText(10),
  budget_min: shortText(20),
  budget_max: shortText(20),
  description: shortText(2000),
  contact_phone: shortText(20),
  contact_email: shortText(254),
  share_contact: checkboxOrEmpty,
});
export const requestVersionSchema = z.object({ locale: localeSchema, requestId: uuidSchema, expectedVersion: intField });
export const submitRequestSchema = z.object({
  locale: localeSchema,
  requestId: uuidSchema,
  expectedVersion: intField,
  visibility: z.enum(['private_invite', 'eligible_sellers'], 'invalid_input'),
});
export const requestIdSchema = z.object({ locale: localeSchema, requestId: uuidSchema });
export const findMoreSchema = z.object({ locale: localeSchema, requestId: uuidSchema, broaden: z.enum(['true', 'false'], 'invalid_input') });
export const inviteSellerSchema = z.object({ locale: localeSchema, requestId: uuidSchema, sellerOrgId: uuidSchema });
export const endRequestSchema = z.object({
  locale: localeSchema,
  requestId: uuidSchema,
  status: z.enum(['closed', 'withdrawn'], 'invalid_input'),
  reason: shortText(500),
});
export const respondSchema = z.object({
  ...formBase,
  requestId: uuidSchema,
  response: z.enum(['interested', 'question', 'declined'], 'invalid_input'),
  note: shortText(500),
});
export const sendEnquirySchema = z.object({
  locale: localeSchema,
  slug: z.string('invalid_input').regex(/^[a-z0-9-]{3,80}$/, 'invalid_input'),
  buyerOrgId: optional(uuidSchema),
  topic: z.string('invalid_input').trim().min(3, 'invalid_input').max(200, 'invalid_input'),
  note: z.string('invalid_input').trim().min(10, 'invalid_note').max(1000, 'invalid_note'),
});
export const REPORT_REASONS = ['misleading', 'offensive', 'spam', 'scam', 'other'] as const;
export const reportSchema = z.object({
  locale: localeSchema,
  type: z.enum(['listing', 'request'], 'invalid_input'),
  target: z.string('invalid_input').min(3, 'invalid_input').max(80, 'invalid_input'),
  reason: z.enum(REPORT_REASONS, 'invalid_input'),
  note: shortText(500),
  back: shortText(200),
});
export const reviewListingSchema = z.object({
  ...formBase,
  decision: z.enum(['approve', 'reject', 'request_changes'], 'invalid_decision'),
  reason: shortText(1000),
  expectedVersion: intField,
});
export const suspendListingSchema = z.object({
  ...formBase,
  mode: z.enum(['suspend', 'reinstate'], 'invalid_decision'),
  reason: z.string('reason_required').trim().min(5, 'reason_required').max(1000, 'reason_required'),
});
export const handleReportSchema = z.object({
  locale: localeSchema,
  reportId: uuidSchema,
  action: z.enum(['dismiss', 'suspend', 'remove'], 'invalid_decision'),
  note: z.string('reason_required').trim().min(5, 'reason_required').max(1000, 'reason_required'),
});
export const directoryFilterSchema = z.object({
  q: shortText(80),
  category: optional(z.string().regex(/^[a-z0-9-]{2,40}$/)),
  state: optional(z.enum(MY_STATES)),
  page: z.coerce.number().int().min(1).max(80).catch(1),
});

// ---------------------------------------------------------------------------------------------------------------
// Phase 5: partner suppliers, products, sourcing requests, reports. Shared by the partner, catalogue and admin UIs.
// Field-level validation is repeated in the database (the authority); these schemas guard the shape and normalise input.
// Money is ALWAYS a decimal string (never a float): `moneySchema` returns a canonical string with at most 2 decimals.
// ---------------------------------------------------------------------------------------------------------------

export const PRODUCT_CATEGORY_SLUGS = CATEGORY_SLUGS;
export const PRODUCT_CURRENCIES = CURRENCIES;
export const PRODUCT_PRICE_MODES = ['tiers', 'fixed', 'request'] as const;
export const PRODUCT_AVAILABILITY = ['available', 'made_to_order', 'limited', 'unavailable'] as const;
export const PRODUCT_UNITS = UNITS;
export const SUPPLIER_DOC_TYPE_LIST = ['business_registration', 'tax_registration', 'export_licence', 'trade_reference', 'catalogue', 'other'] as const;
export const REPORT_PRODUCT_REASON_LIST = ['misleading', 'counterfeit', 'prohibited', 'wrong_price', 'offensive', 'spam', 'other'] as const;
export const SUPPLIER_CHECK_LIST = [
  'contact_reachable',
  'registration_document_seen',
  'address_consistent',
  'catalogue_consistent',
  'trade_reference',
  'identity_document_seen',
] as const;

const dropBlank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const sku = z.string('invalid_sku').trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/, 'invalid_sku');
const intFrom = (key: string, min: number, max: number) => z.preprocess(dropBlank, z.coerce.number(key).int(key).min(min, key).max(max, key));

/**
 * Money as a decimal string: "250", "250.5", "1,250.50" (thousands grouping accepted), at most 2 decimals, greater than 0,
 * at most 11 integer digits (the database limit). The output is the canonical plain string without grouping.
 */
export const moneySchema = (key = 'invalid_price') =>
  z.string(key).transform((v, ctx) => {
    const r = parseDecimal(v, { maxScale: 2, maxIntDigits: 11, fixedScale: true });
    if (!r.ok || r.scaled <= BigInt(0)) {
      ctx.addIssue({ code: 'custom', message: key });
      return z.NEVER;
    }
    return r.text;
  });

/** Blank means "not set" (and "not sure" where the form offers it). */
const optionalMoney = z.preprocess(dropBlank, moneySchema().optional());

const dateOnly = (key: string) =>
  z.preprocess(
    dropBlank,
    z
      .string(key)
      .regex(/^\d{4}-\d{2}-\d{2}$/, key)
      .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, key)
      .optional(),
  );

/** Accepts an array/object or a JSON string (a hidden form field). Bad JSON becomes null, which the inner schema rejects. */
const jsonField = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    if (v.trim() === '') return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }, schema.optional());

/** Textarea lines or a comma list -> string[] (each 2-60 characters, at most `max`). */
const lineList = (max: number, key: string) =>
  z.preprocess(
    (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v !== 'string' || v.trim() === '') return undefined;
      return v
        .split(/[\n,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    },
    z.array(z.string().min(2, key).max(60, key), key).max(max, key).optional(),
  );

// ---- supplier (steps 1-4: Basics, Business details, Contact and registration, Documents and submit)

const supplierRef = { orgId: uuidSchema, locale: localeSchema, supplierId: optional(uuidSchema) };
const categorySlug = z.string('category_required').trim().min(1, 'category_required').regex(/^[a-z0-9-]{2,40}$/, 'invalid_category');

export const supplierStep1Schema = z.object({
  ...supplierRef,
  /** Only on create. Letters, digits, . _ - (2-30). */
  code: optional(z.string('invalid_code').trim().regex(/^[A-Za-z0-9._-]{2,30}$/, 'invalid_code')),
  name: z.string('invalid_name').trim().min(2, 'invalid_name').max(160, 'invalid_name'),
  country: z.string('invalid_input').trim().min(2, 'invalid_input').max(60, 'invalid_input'),
  state_city: optional(z.string('invalid_input').trim().max(100, 'invalid_input')),
  main_category: categorySlug,
  /** The supplier's draft_version when editing; ignored on create. */
  expectedVersion: optional(intField),
});
export const supplierStep2Schema = z.object({
  ...supplierRef,
  description: z.string('invalid_description').trim().min(20, 'invalid_description').max(2000, 'invalid_description'),
  capabilities: lineList(10, 'invalid_capabilities'),
  expectedVersion: intField,
});
export const supplierStep3Schema = z.object({
  ...supplierRef,
  contact_name: optional(z.string('invalid_name').trim().min(2, 'invalid_name').max(120, 'invalid_name')),
  contact_email: optional(emailSchema),
  contact_phone: optional(phoneSchema),
  /** Registration number. Blank, or the "not sure" checkbox, is allowed (see supplierDraftData). */
  registration_id: optional(z.string('invalid_input').trim().max(60, 'invalid_input')),
  registration_not_sure: checkboxOrEmpty,
  website: optional(z.string('invalid_website').trim().max(200, 'invalid_website').regex(/^https?:\/\/\S+$/, 'invalid_website')),
  expectedVersion: intField,
});
export const supplierSubmitSchema = z.object({ orgId: uuidSchema, locale: localeSchema, supplierId: uuidSchema, expectedVersion: intField });
export const supplierWithdrawSchema = z.object({ orgId: uuidSchema, locale: localeSchema, supplierId: uuidSchema });
export const supplierDocUploadMetaSchema = z.object({
  docType: z.enum(SUPPLIER_DOC_TYPE_LIST, 'invalid_doc_type'),
});

/**
 * Maps a validated supplier step to the keys of save_supplier_draft's p_data. Form-only fields are dropped and undefined keys omitted
 * (so they stay untouched). "Not sure" about the registration number sends an empty string, which removes a stored value.
 */
export function supplierDraftData(d: Record<string, unknown>): Record<string, unknown> {
  const keys = ['code', 'name', 'country', 'state_city', 'main_category', 'description', 'capabilities', 'contact_name', 'contact_email', 'contact_phone', 'registration_id', 'website'];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (d[k] !== undefined) out[k] = d[k];
  if (d.registration_not_sure === true) out.registration_id = '';
  return out;
}

// ---- product (draft form). Strict checks run in the database on submit; this keeps the shape and money format right.

const tierSchema = z.object({
  min_qty: z.coerce.number('invalid_tier').int('invalid_tier_qty').min(1, 'invalid_tier_qty').max(1_000_000_000, 'invalid_tier_qty'),
  max_qty: z
    .preprocess(dropBlank, z.coerce.number('invalid_tier_qty').int('invalid_tier_qty').min(1, 'invalid_tier_qty').max(1_000_000_000, 'invalid_tier_qty').nullable().optional())
    .transform((v) => v ?? null),
  unit_price: moneySchema('invalid_price'),
  variant_sku: optional(sku),
});
const variantSchema = z.object({
  sku,
  label: z.string('invalid_variant').trim().min(1, 'invalid_variant').max(80, 'invalid_variant'),
  attributes: z.record(z.string(), z.string().max(80, 'invalid_variant'), 'invalid_variant').default({}),
  moq: z.preprocess(dropBlank, z.coerce.number('invalid_variant_moq').int('invalid_variant_moq').min(1, 'invalid_variant_moq').max(1_000_000_000, 'invalid_variant_moq').optional()),
});

/** "key: value" per line (or a JSON object) -> Record<string,string>, at most 20 entries. */
const specsField = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (t === '') return undefined;
    if (t.startsWith('{')) {
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    }
    const out: Record<string, string> = {};
    for (const line of t.split(/\n|;/)) {
      if (line.trim() === '') continue;
      const i = line.indexOf(':');
      if (i <= 0) return null;
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  },
  z
    .record(z.string().min(1).max(60), z.string().max(200), 'invalid_spec')
    .refine((o) => Object.keys(o).length <= 20, 'too_many_specs')
    .optional(),
);

const productFields = {
  name: optional(z.string('invalid_name').trim().min(2, 'invalid_name').max(160, 'invalid_name')),
  description: optional(z.string('invalid_description').trim().max(2000, 'invalid_description')),
  category_slug: optional(categorySlug),
  unit: optional(z.string('unit_required').trim().min(1, 'unit_required').max(30, 'unit_required')),
  moq: optional(z.coerce.number('invalid_moq').int('invalid_moq').min(1, 'invalid_moq').max(1_000_000_000, 'invalid_moq')),
  currency: optional(z.enum(PRODUCT_CURRENCIES, 'invalid_currency')),
  price_mode: optional(z.enum(PRODUCT_PRICE_MODES, 'invalid_price_mode')),
  /** Fixed price (price_mode = fixed). Decimal string. */
  unit_price: optionalMoney,
  tiers: jsonField(z.array(tierSchema, 'invalid_tier').max(60, 'too_many_tiers')),
  variants: jsonField(z.array(variantSchema, 'invalid_variant').max(50, 'too_many_variants')),
  lead_time_min_days: optional(intFrom('invalid_lead_time', 0, 3650)),
  lead_time_max_days: optional(intFrom('invalid_lead_time', 0, 3650)),
  availability_status: optional(z.enum(PRODUCT_AVAILABILITY, 'invalid_availability')),
  availability_confirmed_on: dateOnly('invalid_date'),
  price_confirmed_on: dateOnly('invalid_date'),
  specs: specsField,
  packaging: optional(z.string('invalid_input').trim().max(300, 'invalid_input')),
};

const productRef = { orgId: uuidSchema, locale: localeSchema, supplierId: uuidSchema };

/** Create: SKU required (immutable afterwards). */
export const productCreateSchema = z.object({ ...productRef, sku, ...productFields });
/** Update a draft: SKU is not editable. `expectedVersion` is the product's draft_version. */
export const productUpdateSchema = z.object({ ...productRef, productId: uuidSchema, expectedVersion: intField, ...productFields });
/** `expectedVersion` is the product's draft_version. */
export const productSubmitSchema = z.object({ orgId: uuidSchema, locale: localeSchema, productId: uuidSchema, expectedVersion: intField });
/** `expectedVersion` is products.version. */
export const productPublishSchema = z.object({ orgId: uuidSchema, locale: localeSchema, productId: uuidSchema, expectedVersion: intField });
export const productUnpublishSchema = z.object({ orgId: uuidSchema, locale: localeSchema, productId: uuidSchema });
export const productMediaUpdateSchema = z.object({
  orgId: uuidSchema,
  locale: localeSchema,
  mediaId: uuidSchema,
  alt: z.string('invalid_alt').trim().min(1, 'invalid_alt').max(200, 'invalid_alt'),
  sort: intField,
});
export const productMediaRemoveSchema = z.object({ orgId: uuidSchema, locale: localeSchema, mediaId: uuidSchema });

/** The p_data part of a validated product form (routing fields and undefined values removed). */
export function productDraftData(d: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set(['orgId', 'locale', 'supplierId', 'productId', 'expectedVersion']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!skip.has(k) && v !== undefined) out[k] = v;
  return out;
}

// ---- import

export const importModeSchema = z.enum(['create_only', 'create_or_update'], 'invalid_mode');
export const importStageMetaSchema = z.object({ orgId: uuidSchema, locale: localeSchema, supplierId: uuidSchema, mode: importModeSchema });
export const importCommitSchema = z.object({ orgId: uuidSchema, locale: localeSchema, jobId: uuidSchema, confirmOverwrite: checkboxOrEmpty });
export const importCancelSchema = z.object({ orgId: uuidSchema, locale: localeSchema, jobId: uuidSchema });

// ---- sourcing request (buyer) and partner response

const requestKey = z.string('invalid_input').min(8, 'invalid_input').max(80, 'invalid_input').regex(/^[A-Za-z0-9-]+$/, 'invalid_input');
export const sourcingLineSchema = z.object({
  product_id: uuidSchema,
  variant_sku: optional(sku),
  quantity: z.coerce.number('invalid_quantity').int('invalid_quantity').min(1, 'invalid_quantity').max(1_000_000_000, 'invalid_quantity'),
});
export const sourcingRequestSchema = z.object({
  locale: localeSchema,
  buyerOrgId: uuidSchema,
  /** Generated once per form instance (idempotency key). */
  key: requestKey,
  /** JSON array of lines (hidden field) or an array: 1-20 lines. */
  items: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    },
    z.array(sourcingLineSchema, 'items_required').min(1, 'items_required').max(20, 'too_many_items'),
  ),
  destinationState: z.enum(MY_STATES, 'invalid_state'),
  destinationCity: optional(z.string('invalid_input').trim().max(80, 'invalid_input')),
  neededBy: dateOnly('invalid_date'),
  notes: optional(z.string('invalid_note').trim().max(1000, 'invalid_note')),
});
export const sourcingReplySchema = z.object({
  locale: localeSchema,
  requestId: uuidSchema,
  note: z.string('invalid_note').trim().min(5, 'invalid_note').max(1000, 'invalid_note'),
});
export const sourcingWithdrawSchema = z.object({ locale: localeSchema, requestId: uuidSchema });
export const sourcingRespondSchema = z.object({
  locale: localeSchema,
  orgId: uuidSchema,
  requestId: uuidSchema,
  action: z.enum(['acknowledge', 'clarify'], 'invalid_action'),
  note: optional(z.string('invalid_note').trim().max(1000, 'invalid_note')),
  expectedVersion: optional(intField),
});
export const sourcingCloseSchema = z.object({
  locale: localeSchema,
  orgId: uuidSchema,
  requestId: uuidSchema,
  note: optional(z.string('invalid_note').trim().max(1000, 'invalid_note')),
});

// ---- saved products, product reports, search

export const savedProductSchema = z.object({ locale: localeSchema, productId: uuidSchema, back: shortText(200) });
export const productReportSchema = z.object({
  locale: localeSchema,
  productId: uuidSchema,
  reason: z.enum(REPORT_PRODUCT_REASON_LIST, 'invalid_reason'),
  note: shortText(500),
});

/** Catalogue search query string (tolerant: bad values are dropped, never an error page). Prices are decimal strings. */
export const catalogueSearchSchema = z.object({
  q: optional(z.string().trim().max(80)).catch(undefined),
  category: optional(z.enum(CATEGORY_SLUGS)).catch(undefined),
  supplier: optional(z.uuid()).catch(undefined),
  currency: optional(z.enum(CURRENCIES)).catch(undefined),
  price_min: optionalMoney.catch(undefined),
  price_max: optionalMoney.catch(undefined),
  moq_max: z.preprocess(dropBlank, z.coerce.number().int().min(1).max(1_000_000_000).optional()).catch(undefined),
  page: z.coerce.number().int().min(1).max(500).catch(1),
});

// ---- admin decisions

export const supplierDecisionSchema = z
  .object({
    locale: localeSchema,
    supplierId: uuidSchema,
    decision: z.enum(['approve', 'reject', 'request_info'], 'invalid_decision'),
    reason: optional(z.string('reason_required').trim().max(1000, 'reason_required')),
    /** Read repeated `checks` checkbox fields with formData.getAll('checks') and pass the array. 1-6 distinct checks to approve. */
    checks: z.array(z.enum(SUPPLIER_CHECK_LIST, 'invalid_checks'), 'invalid_checks').max(6, 'invalid_checks').default([]),
    /** The supplier's draft_submitted_version. */
    expectedVersion: intField,
  })
  .superRefine((d, ctx) => {
    if (d.decision === 'approve') {
      if (new Set(d.checks).size !== d.checks.length || d.checks.length < 1) ctx.addIssue({ code: 'custom', message: 'invalid_checks', path: ['checks'] });
    } else if (!d.reason || d.reason.length < 5) {
      ctx.addIssue({ code: 'custom', message: 'reason_required', path: ['reason'] });
    }
  });
export const productDecisionSchema = z
  .object({
    locale: localeSchema,
    productId: uuidSchema,
    decision: z.enum(['approve', 'reject', 'request_changes'], 'invalid_decision'),
    reason: optional(z.string('reason_required').trim().max(1000, 'reason_required')),
    /** products.version */
    expectedVersion: intField,
  })
  .superRefine((d, ctx) => {
    if (d.decision !== 'approve' && (!d.reason || d.reason.length < 5)) ctx.addIssue({ code: 'custom', message: 'reason_required', path: ['reason'] });
  });
export const catalogueSuspendSchema = z.object({
  locale: localeSchema,
  target: z.enum(['supplier', 'product'], 'invalid_decision'),
  id: uuidSchema,
  mode: z.enum(['suspend', 'reinstate'], 'invalid_decision'),
  reason: z.string('reason_required').trim().min(5, 'reason_required').max(1000, 'reason_required'),
});
export const productReportDecisionSchema = z.object({
  locale: localeSchema,
  reportId: uuidSchema,
  action: z.enum(['dismiss', 'suspend_product'], 'invalid_decision'),
  note: z.string('reason_required').trim().min(5, 'reason_required').max(1000, 'reason_required'),
});
export const partnerProvisionSchema = z.object({
  locale: localeSchema,
  name: orgNameSchema,
  displayName: z.string('invalid_name').trim().min(2, 'invalid_name').max(120, 'invalid_name'),
  ownerEmail: emailSchema,
});
export const partnerDecisionSchema = z.object({
  locale: localeSchema,
  orgId: uuidSchema,
  mode: z.enum(['approve', 'suspend'], 'invalid_decision'),
  reason: optional(z.string('reason_required').trim().max(1000, 'reason_required')),
});
export const partnerProfileSchema = z.object({
  locale: localeSchema,
  orgId: uuidSchema,
  displayName: z.string('invalid_name').trim().min(2, 'invalid_name').max(120, 'invalid_name'),
  contactEmail: emailSchema,
});

