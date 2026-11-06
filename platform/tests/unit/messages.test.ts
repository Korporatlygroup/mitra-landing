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
  const banned = ['guaranteed', 'certified by mitra', 'approved for funding', 'you are eligible'];
  it.each(banned)('en.json never contains "%s"', (phrase) => {
    expect(JSON.stringify(en).toLowerCase()).not.toContain(phrase);
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

  it('audit actions list is unique', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});
