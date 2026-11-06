import { describe, expect, it } from 'vitest';
import {
  SCHEMA_ERROR_KEYS,
  createOrgSchema,
  emailSchema,
  inviteSchema,
  invitationTokenSchema,
  loginSchema,
  memberRoleSchema,
  orgTypeSchema,
  passwordSchema,
  profileSchema,
  setRoleSchema,
  signUpSchema,
  totpCodeSchema,
} from '@/lib/schemas';

const uuid = '3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34';
const good = {
  email: 'Asha@Example.com',
  password: 'Abcdefghi1',
  displayName: 'Asha',
  language: 'ta',
  acceptTerms: 'on',
  acceptPrivacy: 'on',
};

function firstMessage(r: { success: boolean; error?: { issues: { message: string }[] } }) {
  return r.error?.issues[0]?.message;
}

describe('emailSchema', () => {
  it('trims and lower-cases', () => {
    expect(emailSchema.parse('  Foo@Example.COM ')).toBe('foo@example.com');
  });
  it.each(['', 'no-at', 'a@b', 'a b@c.com', 'a'.repeat(250) + '@x.com'])('rejects %j', (bad) => {
    const r = emailSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe('invalid_email');
  });
});

describe('passwordSchema', () => {
  it('accepts a strong password', () => expect(passwordSchema.safeParse('Abcdefghi1').success).toBe(true));
  it.each(['Short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHereAtAll', 'A1a' + 'x'.repeat(80)])('rejects %j', (bad) => {
    expect(firstMessage(passwordSchema.safeParse(bad))).toBe('password_weak');
  });
});

describe('signUpSchema', () => {
  it('accepts a valid sign-up and normalises the email', () => {
    const r = signUpSchema.parse(good);
    expect(r.email).toBe('asha@example.com');
    expect(r.acceptTerms).toBe(true);
  });
  it('requires both consents', () => {
    expect(firstMessage(signUpSchema.safeParse({ ...good, acceptTerms: undefined }))).toBe('terms_required');
    expect(firstMessage(signUpSchema.safeParse({ ...good, acceptPrivacy: 'off' }))).toBe('terms_required');
  });
  it('rejects an unknown language and a bad name', () => {
    expect(firstMessage(signUpSchema.safeParse({ ...good, language: 'fr' }))).toBe('invalid_language');
    expect(firstMessage(signUpSchema.safeParse({ ...good, displayName: 'x'.repeat(121) }))).toBe('invalid_name');
    expect(firstMessage(signUpSchema.safeParse({ ...good, displayName: '   ' }))).toBe('invalid_name');
  });
});

describe('loginSchema', () => {
  it('needs an email and a non-empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('organisation and member schemas', () => {
  it('org name is 2..160 characters after trimming', () => {
    expect(createOrgSchema.safeParse({ type: 'business', name: ' A ' }).success).toBe(false);
    expect(createOrgSchema.safeParse({ type: 'business', name: 'Ab' }).success).toBe(true);
    expect(createOrgSchema.safeParse({ type: 'business', name: 'x'.repeat(161) }).success).toBe(false);
  });
  it('org type excludes mitra', () => {
    expect(orgTypeSchema.safeParse('mitra').success).toBe(false);
    for (const t of ['business', 'buyer', 'partner']) expect(orgTypeSchema.safeParse(t).success).toBe(true);
  });
  it('role enum has exactly the nine database roles', () => {
    expect(memberRoleSchema.options).toHaveLength(9);
    expect(memberRoleSchema.safeParse('root').success).toBe(false);
    expect(firstMessage(memberRoleSchema.safeParse('root'))).toBe('invalid_role');
  });
  it('invite and set-role validate ids, email and role', () => {
    expect(inviteSchema.parse({ orgId: uuid, email: ' X@Y.com ', role: 'viewer' }).email).toBe('x@y.com');
    expect(inviteSchema.safeParse({ orgId: 'nope', email: 'x@y.com', role: 'viewer' }).success).toBe(false);
    expect(setRoleSchema.safeParse({ orgId: uuid, userId: uuid, role: 'manager' }).success).toBe(true);
    expect(setRoleSchema.safeParse({ orgId: uuid, userId: uuid, role: 'god' }).success).toBe(false);
  });
  it('profile', () => {
    expect(profileSchema.safeParse({ displayName: 'Ravi', language: 'en' }).success).toBe(true);
    expect(profileSchema.safeParse({ displayName: '', language: 'en' }).success).toBe(false);
  });
});

describe('token and code', () => {
  it('invitation token is 64 lowercase hex characters', () => {
    expect(invitationTokenSchema.safeParse('a'.repeat(64)).success).toBe(true);
    expect(invitationTokenSchema.safeParse('A'.repeat(64)).success).toBe(false);
    expect(invitationTokenSchema.safeParse('a'.repeat(63)).success).toBe(false);
  });
  it('TOTP code is exactly 6 digits', () => {
    expect(totpCodeSchema.safeParse(' 123456 ').success).toBe(true);
    expect(totpCodeSchema.safeParse('12345').success).toBe(false);
    expect(totpCodeSchema.safeParse('12345a').success).toBe(false);
  });
});

describe('issue messages are declared error keys', () => {
  it('SCHEMA_ERROR_KEYS lists every message used by the schemas', () => {
    for (const key of ['invalid_email', 'password_weak', 'invalid_name', 'terms_required', 'invalid_role', 'invalid_code', 'invalid_language', 'invalid_input', 'invalid_org_type']) {
      expect(SCHEMA_ERROR_KEYS).toContain(key);
    }
  });
});
