import { z } from 'zod';
import { MEMBER_ROLES } from './permissions';

/**
 * All input schemas. Issue messages are KEYS in the `errors` namespace of messages/*.json,
 * never display text. See SCHEMA_ERROR_KEYS.
 */
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

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  language: localeSchema,
  acceptTerms: checkbox,
  acceptPrivacy: checkbox,
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
