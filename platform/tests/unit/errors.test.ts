import { describe, expect, it } from 'vitest';
import { messagesFor } from '@/i18n/messages';
import { CODE_KEYS, FALLBACK_KEY, KNOWN_MESSAGE_KEYS, mapRpcError } from '@/lib/errors';
import { flatten, migrations } from './helpers';

// Merged messages (main file plus the Phase 5 area files), as the app loads them.
const fe = flatten(messagesFor('en'));
const exists = (k: string) => `errors.${k}` in fe;

describe('mapRpcError', () => {
  it('maps every machine key to an existing message', () => {
    for (const key of KNOWN_MESSAGE_KEYS) {
      const mapped = mapRpcError({ code: 'PT409', message: key });
      expect(mapped).toBe(key);
      expect(exists(mapped), key).toBe(true);
    }
  });

  it.each(Object.keys(CODE_KEYS))('maps bare code %s to an existing message', (code) => {
    const mapped = mapRpcError({ code, message: 'something the user must never see' });
    expect(mapped).toBe(CODE_KEYS[code]);
    expect(exists(mapped)).toBe(true);
  });

  it('prefers the machine key over the code', () => {
    expect(mapRpcError({ code: 'PT409', message: 'last_owner' })).toBe('last_owner');
    expect(mapRpcError({ code: 'PT403', message: 'cannot_grant_above_own_role' })).toBe('cannot_grant_above_own_role');
  });

  it('never leaks raw database text', () => {
    const raw = 'duplicate key value violates unique constraint "memberships_org_id_user_id_key"';
    expect(mapRpcError({ code: '23505', message: raw })).toBe(FALLBACK_KEY);
    expect(mapRpcError(null)).toBe(FALLBACK_KEY);
    expect(mapRpcError({})).toBe(FALLBACK_KEY);
  });

  it('treats Postgres insufficient_privilege as forbidden', () => {
    expect(mapRpcError({ code: '42501', message: 'permission denied for table x' })).toBe('forbidden');
  });
});

describe('contract with the migrations', () => {
  it('every message key raised in SQL is known to the mapper', () => {
    const raised = new Set<string>();
    for (const { text } of migrations()) {
      for (const m of text.matchAll(/raise_error\('(\w+)'\s*,\s*'(\w+)'\)/g)) raised.add(m[2]);
    }
    expect(raised.size).toBeGreaterThan(10);
    const unknown = [...raised].filter((k) => !(KNOWN_MESSAGE_KEYS as readonly string[]).includes(k));
    expect(unknown).toEqual([]);
  });

  it('every PTnnn code used in SQL has a default key', () => {
    const codes = new Set<string>();
    for (const { text } of migrations()) for (const m of text.matchAll(/errcode = '(PT\d{3})'/g)) codes.add(m[1]);
    expect(codes.size).toBeGreaterThan(0);
    for (const c of codes) expect(CODE_KEYS[c], c).toBeTruthy();
  });
});
