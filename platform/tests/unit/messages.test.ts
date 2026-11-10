import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ta from '../../messages/ta.json';
import { KNOWN_MESSAGE_KEYS, allErrorKeys } from '@/lib/errors';
import { MEMBER_ROLES } from '@/lib/permissions';
import { SCHEMA_ERROR_KEYS } from '@/lib/schemas';
import { AUDIT_ACTIONS } from '@/server/services/audit';
import { flatten } from './helpers';

const fe = flatten(en);
const ft = flatten(ta);

describe('message files', () => {
  it('EN and TA have identical key sets', () => {
    expect(Object.keys(ft).sort()).toEqual(Object.keys(fe).sort());
  });

  it('no value is empty', () => {
    for (const [k, v] of [...Object.entries(fe), ...Object.entries(ft)]) {
      expect(typeof v === 'string' && v.trim().length > 0, k).toBe(true);
    }
  });

  it('flags Tamil as needing native review', () => {
    expect(String(en._meta)).toMatch(/native/i);
    expect(String(ta._meta)).toMatch(/native/i);
  });

  it('Tamil strings contain Tamil script', () => {
    const exempt = new Set(['_meta', 'common.appName', 'common.langEn']);
    for (const [k, v] of Object.entries(ft)) {
      if (exempt.has(k)) continue;
      expect(/[஀-௿]/.test(String(v)), k).toBe(true);
    }
  });

  it('placeholders match between languages', () => {
    const ph = (s: unknown) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(fe)) expect(ph(ft[k]), k).toEqual(ph(fe[k]));
  });
});

describe('wording lint', () => {
  // Never imply an official, SSM, government or guaranteed check. MITRA only reviews documents.
  const bannedEn = [
    'guaranteed',
    'certified by mitra',
    'approved for funding',
    'you are eligible',
    'verified by ssm',
    'ssm verified',
    'ssm-verified',
    'officially verified',
    'government verified',
    'government-verified',
    'verified by the government',
  ];
  it.each(bannedEn)('en.json never contains "%s"', (phrase) => {
    expect(JSON.stringify(en).toLowerCase()).not.toContain(phrase);
  });

  const bannedTa = ['உத்தரவாத', 'அரசு சரிபார்', 'அதிகாரப்பூர்வமாகச் சரிபார்', 'எஸ்எஸ்எம் சரிபார்', 'ssm சரிபார்க்கப்பட்ட', 'ssm-ஆல் சரிபார்'];
  it.each(bannedTa)('ta.json never contains "%s"', (phrase) => {
    expect(JSON.stringify(ta).toLowerCase()).not.toContain(phrase.toLowerCase());
  });

  it('the preview wording is "Documents reviewed by MITRA ... for:" and the unregistered label is exact', () => {
    expect(en.preview.reviewedOn).toBe('Documents reviewed by MITRA on {date} for: {scope}');
    expect(en.preview.unregistered).toBe('Not registered with SSM. Limited, unverified profile.');
  });

  it('no message says a business is "verified" without qualification', () => {
    for (const [k, v] of Object.entries(fe)) {
      if (k === '_meta') continue;
      const text = String(v).toLowerCase().replace(/unverified/g, '');
      expect(text, k).not.toMatch(/\bverified\b/);
    }
  });
});

describe('message coverage', () => {
  it('has a label for every role and org type', () => {
    for (const r of MEMBER_ROLES) expect(fe[`roles.${r}`], r).toBeTruthy();
    for (const t of ['business', 'buyer', 'partner', 'mitra']) expect(fe[`orgTypes.${t}`], t).toBeTruthy();
  });

  it('has an error message for every error key the code can produce', () => {
    for (const k of [...allErrorKeys(), ...KNOWN_MESSAGE_KEYS, ...SCHEMA_ERROR_KEYS, 'login_failed', 'password_same', 'email_failed']) {
      expect(fe[`errors.${k}`], k).toBeTruthy();
    }
  });

  it('has messages for the success keys returned by actions', () => {
    for (const k of ['members.invited', 'members.revoked', 'members.roleChanged', 'members.removed', 'account.passwordChanged']) {
      expect(fe[k], k).toBeTruthy();
    }
  });

  it('has a message for every status, event, document type, role, claim type and notification kind', () => {
    const groups: Record<string, string[]> = {
      claimStatus: ['none', 'draft', 'submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'stale', 'withdrawn'],
      events: ['claim_created', 'document_uploaded', 'document_removed', 'document_viewed', 'scan_result', 'submitted', 'resubmitted', 'withdrawn', 'review_started', 'approved', 'rejected', 'info_requested', 'marked_stale'],
      docTypes: ['ssm_certificate', 'ssm_form', 'business_licence', 'address_proof', 'authorisation_letter', 'other'],
      repRoles: ['owner', 'director', 'partner', 'authorised_person'],
      businessTypes: ['sole_proprietorship', 'partnership', 'sdn_bhd', 'llp', 'other'],
      claimTypes: ['business_registration', 'business_location', 'representative_authority'],
      claimScope: ['business_registration', 'business_location', 'representative_authority'],
      'notifications.kinds': ['verification_approved', 'verification_rejected', 'verification_info_requested', 'other'],
      'email.decision': ['approve', 'reject', 'request_info'],
    };
    for (const [ns, keys] of Object.entries(groups)) for (const k of keys) expect(fe[`${ns}.${k}`], `${ns}.${k}`).toBeTruthy();
  });

  it('has an error message for the file pipeline keys', () => {
    for (const k of ['file_empty', 'file_too_large', 'file_type_not_allowed', 'file_unsafe_content', 'file_infected', 'upload_failed', 'stale_version', 'consent_required', 'last_admin', 'evidence_not_clean', 'org_not_active']) {
      expect(fe[`errors.${k}`], k).toBeTruthy();
    }
  });

  it('has messages for the success keys returned by Phase 2 actions', () => {
    for (const k of ['documents.received', 'documents.pendingScan', 'documents.removed', 'ver.withdrawnDone', 'adminVer.decided', 'adminVer.reviewStarted', 'adminVer.scanDone', 'adminVer.evidenceWarning', 'preview.notReviewedYet']) {
      expect(fe[k], k).toBeTruthy();
    }
  });

  it('audit actions list is unique', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});
