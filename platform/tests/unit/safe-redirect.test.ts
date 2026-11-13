import { describe, expect, it } from 'vitest';
import { retargetLocale, safeRedirectPath } from '@/lib/safe-redirect';

describe('safeRedirectPath', () => {
  it.each([
    '//evil.com',
    'https://evil.com',
    'http://evil.com/x',
    '/\\evil.com',
    '/\\/evil.com',
    '\\evil.com',
    'javascript:alert(1)',
    'evil.com',
    '',
    '/\t/evil.com',
    '/\n/evil.com',
    '/ok\r\nSet-Cookie: x=1',
    '///evil.com',
  ])('rejects %j', (bad) => {
    expect(safeRedirectPath(bad)).toBe('/');
    expect(safeRedirectPath(bad, '/en')).toBe('/en');
  });

  it('rejects null, undefined and absurdly long values', () => {
    expect(safeRedirectPath(null)).toBe('/');
    expect(safeRedirectPath(undefined)).toBe('/');
    expect(safeRedirectPath('/' + 'a'.repeat(3000))).toBe('/');
  });

  it.each(['/', '/en', '/en/orgs/123/members', '/ta/invite/abc?x=1#top'])('accepts %s', (good) => {
    expect(safeRedirectPath(good)).toBe(good);
  });
});

describe('retargetLocale', () => {
  it('rewrites only the leading locale segment', () => {
    expect(retargetLocale('/en/orgs/x', 'ta')).toBe('/ta/orgs/x');
    expect(retargetLocale('/ta', 'en')).toBe('/en');
    expect(retargetLocale('/english/x', 'ta')).toBe('/english/x');
    expect(retargetLocale('/orgs/en/x', 'ta')).toBe('/orgs/en/x');
  });
});
