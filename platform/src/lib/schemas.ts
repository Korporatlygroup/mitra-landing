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
] as const;

export const LOCALES = ['en', 'ta'] as const;
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
