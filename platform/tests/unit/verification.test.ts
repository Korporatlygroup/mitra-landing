import { describe, expect, it } from 'vitest';
import {
  CLAIM_DOC_TYPES,
  MY_STATES,
  SSM_PATTERN,
  businessStep1Schema,
  businessStep2Schema,
  businessStep3Schema,
  businessStep4Schema,
  decisionSchema,
  phoneSchema,
  postcodeSchema,
  ssmSchema,
  submitClaimSchema,
  uploadMetaSchema,
} from '@/lib/schemas';
import { ALLOWED_DOWNLOAD_MIME, bearerMatches, contentDispositionAttachment } from '@/lib/http-safety';
import { buildDecisionEmail } from '@/server/verification-email';
import {
  applicableClaims,
  recommendNextStep,
  type BusinessPrivate,
  type BusinessProfile,
  type Claim,
  type Representative,
} from '@/server/services/verification';
import { migrations } from './helpers';

const uuid = '3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34';
const base = { orgId: uuid, locale: 'en' };
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe('SSM number', () => {
  it.each(['202001012345', '1234567-A', '123456-X', '1234567A', '123456A'])('accepts %s', (v) => {
    expect(SSM_PATTERN.test(v)).toBe(true);
    expect(ssmSchema.safeParse(v).success).toBe(true);
  });
  it.each(['', '12345', '2020010123456', '1234567-a1', 'ABC123', '12345678-A', '1234567--A'])('rejects %j', (v) => {
    expect(ssmSchema.safeParse(v).success).toBe(false);
    expect(msg(ssmSchema.safeParse(v))).toBe('invalid_ssm');
  });
  it('normalises case and whitespace like the database', () => {
    expect(ssmSchema.parse(' 1234567-a ')).toBe('1234567-A');
  });
  it('uses exactly the pattern the database check uses', () => {
    const sql = migrations().find((m) => m.file.includes('seller_verification'))!.text;
    expect(sql).toContain('^([0-9]{12}|[0-9]{6,7}-?[A-Z])$');
    expect(SSM_PATTERN.source).toBe('^([0-9]{12}|[0-9]{6,7}-?[A-Z])$');
  });
});

describe('state list, postcode, phone', () => {
  it('has the 16 states and territories the database allows', () => {
    const sql = migrations().find((m) => m.file.includes('seller_verification'))!.text;
    const block = sql.match(/state text check \(state in \(([^)]*)\)/)![1];
    const dbStates = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...MY_STATES].sort()).toEqual(dbStates.sort());
    expect(MY_STATES).toHaveLength(16);
  });
  it('postcode is exactly 5 digits', () => {
    expect(postcodeSchema.safeParse('50450').success).toBe(true);
    for (const bad of ['5045', '504500', 'abcde', '50 450', '']) expect(msg(postcodeSchema.safeParse(bad))).toBe('invalid_postcode');
  });
  it('phone matches the database pattern', () => {
    for (const ok of ['0123456789', '+60 12-345 6789', '(03) 1234 5678']) expect(phoneSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['12345', 'call me', '+60123456789012345678901', '']) expect(msg(phoneSchema.safeParse(bad))).toBe('invalid_phone');
  });
});

describe('onboarding step schemas', () => {
  it('step 1: name, category (mandatory) and registered flag', () => {
    const ok = businessStep1Schema.safeParse({ ...base, business_name: ' Kedai Ali ', category_slug: 'retail-shop', registered: 'yes' });
    expect(ok.success && ok.data.business_name).toBe('Kedai Ali');
    expect(msg(businessStep1Schema.safeParse({ ...base, business_name: 'Kedai', category_slug: '', registered: 'no' }))).toBe('category_required');
    expect(msg(businessStep1Schema.safeParse({ ...base, business_name: 'K', category_slug: 'retail-shop', registered: 'no' }))).toBe('invalid_name');
    expect(businessStep1Schema.safeParse({ ...base, business_name: 'Kedai', category_slug: 'retail-shop', registered: 'maybe' }).success).toBe(false);
    expect(msg(businessStep1Schema.safeParse({ ...base, business_name: 'Kedai', category_slug: 'Bad Slug!', registered: 'no' }))).toBe('invalid_category');
  });
  it('step 2: SSM number and business type', () => {
    expect(businessStep2Schema.safeParse({ ...base, ssm_number: '202001012345', business_type: 'sdn_bhd' }).success).toBe(true);
    expect(msg(businessStep2Schema.safeParse({ ...base, ssm_number: 'nope', business_type: 'sdn_bhd' }))).toBe('invalid_ssm');
    expect(businessStep2Schema.safeParse({ ...base, ssm_number: '202001012345', business_type: 'cooperative' }).success).toBe(false);
  });
  it('step 3: state required, address and postcode optional but validated, blanks ignored', () => {
    const ok = businessStep3Schema.safeParse({ ...base, state: 'Selangor', district: '', address_line: '', postcode: '' });
    expect(ok.success && ok.data.district).toBeUndefined();
    expect(msg(businessStep3Schema.safeParse({ ...base, state: 'Atlantis' }))).toBe('invalid_state');
    expect(msg(businessStep3Schema.safeParse({ ...base, state: 'Perak', postcode: '1234' }))).toBe('invalid_postcode');
    expect(msg(businessStep3Schema.safeParse({ ...base, state: 'Perak', address_line: 'x'.repeat(201) }))).toBe('invalid_address');
  });
  it('step 4: representative has no identity-card fields and validates optional contacts', () => {
    const ok = businessStep4Schema.safeParse({ ...base, rep_name: 'Ravi Kumar', rep_role: 'director', rep_email: ' R@X.test ', rep_phone: '' });
    expect(ok.success && ok.data.rep_email).toBe('r@x.test');
    expect(businessStep4Schema.safeParse({ ...base, rep_name: 'Ravi', rep_role: 'cashier' }).success).toBe(false);
    expect(msg(businessStep4Schema.safeParse({ ...base, rep_name: 'Ravi', rep_role: 'owner', rep_email: 'bad' }))).toBe('invalid_email');
    expect(Object.keys(businessStep4Schema.shape).join(' ')).not.toMatch(/ic|identity|nric|passport/i);
  });
  it('upload, submit and decision schemas', () => {
    expect(uploadMetaSchema.safeParse({ ...base, claimType: 'business_location', docType: 'address_proof' }).success).toBe(true);
    expect(uploadMetaSchema.safeParse({ ...base, claimType: 'nope', docType: 'address_proof' }).success).toBe(false);
    expect(msg(uploadMetaSchema.safeParse({ ...base, claimType: 'business_location', docType: 'passport_scan' }))).toBe('invalid_doc_type');
    expect(msg(submitClaimSchema.safeParse({ ...base, claimType: 'business_location', note: 'x'.repeat(1001) }))).toBe('invalid_note');
    const d = { locale: 'en', claimId: uuid, decision: 'reject', reason: 'Blurry document', expectedVersion: '2' };
    expect(decisionSchema.parse(d).expectedVersion).toBe(2);
    expect(msg(decisionSchema.safeParse({ ...d, reason: 'no' }))).toBe('reason_required');
    expect(msg(decisionSchema.safeParse({ ...d, reason: '    ' }))).toBe('reason_required');
    expect(msg(decisionSchema.safeParse({ ...d, decision: 'maybe' }))).toBe('invalid_decision');
  });
  it('document types per claim mirror the database rules', () => {
    expect(CLAIM_DOC_TYPES.business_registration).toEqual(['ssm_certificate', 'ssm_form', 'business_licence']);
    expect(CLAIM_DOC_TYPES.business_location).toEqual(['address_proof', 'business_licence', 'ssm_certificate']);
    expect(CLAIM_DOC_TYPES.representative_authority).toEqual(['authorisation_letter', 'ssm_form', 'other']);
  });
});

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  org_id: uuid,
  business_name: 'Kedai',
  category_id: 'c',
  registration_status: 'registered',
  ssm_number: '202001012345',
  business_type: 'sdn_bhd',
  state: 'Perak',
  district: null,
  ...over,
});
const priv: BusinessPrivate = { address_line: '1 Jalan A', postcode: '30000' };
const rep: Representative = { full_name: 'Ravi', role_title: 'owner', contact_email: null, contact_phone: null };
const claim = (claim_type: Claim['claim_type'], status: Claim['status']): Claim => ({
  id: claim_type,
  org_id: uuid,
  claim_type,
  status,
  version: 1,
  snapshot: null,
  owner_note: null,
  submitted_at: null,
  reviewer_id: null,
  decided_at: null,
  decision_reason: null,
  updated_at: '',
});

describe('recommendNextStep', () => {
  it('walks the owner through the steps', () => {
    expect(recommendNextStep({ profile: null, priv: null, rep: null, claims: [] })).toMatchObject({ key: 'start', step: 1 });
    expect(recommendNextStep({ profile: profile({ ssm_number: null }), priv, rep, claims: [] })).toMatchObject({ key: 'registration', step: 2 });
    expect(recommendNextStep({ profile: profile({ state: null }), priv, rep, claims: [] })).toMatchObject({ key: 'location', step: 3 });
    expect(recommendNextStep({ profile: profile(), priv: { address_line: null, postcode: null }, rep, claims: [] })).toMatchObject({ key: 'location' });
    expect(recommendNextStep({ profile: profile(), priv, rep: null, claims: [] })).toMatchObject({ key: 'representative', step: 4 });
    expect(recommendNextStep({ profile: profile(), priv, rep, claims: [] })).toMatchObject({ key: 'documents', step: 5 });
  });
  it('unregistered businesses are not asked for SSM details or a registration claim', () => {
    const p = profile({ registration_status: 'unregistered', ssm_number: null });
    expect(applicableClaims(p)).toEqual(['business_location', 'representative_authority']);
    const claims = [claim('business_location', 'approved'), claim('representative_authority', 'approved')];
    expect(recommendNextStep({ profile: p, priv, rep, claims })).toMatchObject({ key: 'preview' });
  });
  it('points at the reviewer message, then waiting, then preview', () => {
    const all = (s: Claim['status']) => (['business_registration', 'business_location', 'representative_authority'] as const).map((t) => claim(t, s));
    expect(recommendNextStep({ profile: profile(), priv, rep, claims: [...all('approved').slice(0, 2), claim('representative_authority', 'needs_info')] })).toMatchObject({ key: 'fix' });
    expect(recommendNextStep({ profile: profile(), priv, rep, claims: all('submitted') })).toMatchObject({ key: 'wait' });
    expect(recommendNextStep({ profile: profile(), priv, rep, claims: all('approved') })).toMatchObject({ key: 'preview' });
  });
});

describe('http safety helpers', () => {
  it('bearerMatches is strict and disabled without a secret', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(bearerMatches('Bearer s3cret ', 's3cret')).toBe(false);
    expect(bearerMatches('bearer s3cret', 's3cret')).toBe(false);
    expect(bearerMatches('Bearer wrong', 's3cret')).toBe(false);
    expect(bearerMatches('s3cret', 's3cret')).toBe(false);
    expect(bearerMatches(null, 's3cret')).toBe(false);
    expect(bearerMatches('Bearer ', 's3cret')).toBe(false);
    expect(bearerMatches('Bearer anything', undefined)).toBe(false);
    expect(bearerMatches('Bearer ', '')).toBe(false);
  });
  it('Content-Disposition is an attachment with an RFC 5987 filename*', () => {
    expect(contentDispositionAttachment('ssm cert (1).pdf')).toBe("attachment; filename*=UTF-8''ssm%20cert%20%281%29.pdf");
    expect(contentDispositionAttachment('சான்று.pdf')).toMatch(/^attachment; filename\*=UTF-8''%E0%AE/);
    expect(contentDispositionAttachment("o'brien*.pdf")).toBe("attachment; filename*=UTF-8''o%27brien%2A.pdf");
    expect(contentDispositionAttachment('a\r\nb.pdf')).not.toMatch(/[\r\n]/);
  });
  it('only the three bucket types may be served', () => {
    expect([...ALLOWED_DOWNLOAD_MIME].sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
  });
});

describe('decision email', () => {
  const mail = (reason: string) =>
    buildDecisionEmail({ to: 'o@x.test', claimType: 'business_location', decision: 'request_info', reason, siteUrl: 'http://127.0.0.1:3000/', orgId: uuid });
  it('has a fixed subject and puts the sanitised reason in the body only', () => {
    const m = mail('Please send a clearer scan\r\nBcc: evil@x.test');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).not.toContain('clearer');
    expect(m.text).toContain('“Please send a clearer scan Bcc: evil@x.test”');
    expect(m.text).toContain(`http://127.0.0.1:3000/en/orgs/${uuid}/business/verification`);
    expect(m.text).toContain(`/ta/orgs/${uuid}/business/verification`);
    expect(/[஀-௿]/.test(m.text)).toBe(true);
  });
  it('escapes HTML in the reason and rejects a bad recipient', () => {
    expect(mail('<script>alert(1)</script>').html).not.toContain('<script>');
    expect(() => buildDecisionEmail({ to: 'a@b.test\r\nBcc: x@y.test', claimType: 'business_location', decision: 'approve', reason: 'ok ok ok', siteUrl: 'http://x', orgId: uuid })).toThrow();
  });
  it('truncates very long reasons', () => {
    expect(mail('r'.repeat(900)).text.length).toBeLessThan(1500);
  });
});
