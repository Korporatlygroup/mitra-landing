import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper without types
import { analyse } from '../../scripts/client-namespaces.mjs';
import { ACTION_PATHS, AREA_PATHS, BASE_PATHS } from '../../src/i18n/client-namespaces';
import { MESSAGES } from '../../src/i18n/messages';
import { mergeMessages, pickMessages } from '../../src/i18n/pick-messages';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const get = (tree: unknown, path: string) => path.split('.').reduce<unknown>((t, p) => (t && typeof t === 'object' ? (t as Record<string, unknown>)[p] : undefined), tree);

describe('client message scoping (keeps each page small enough for the Free-plan CPU budget)', () => {
  const result = analyse();

  it('the committed path lists match what the client components use (run `node scripts/client-namespaces.mjs --write` after adding client translations)', () => {
    expect(BASE_PATHS).toEqual(result.base);
    const nonEmpty = Object.fromEntries(Object.entries(result.areas).filter(([, v]) => (v as string[]).length));
    expect(AREA_PATHS).toEqual(nonEmpty);
    expect(ACTION_PATHS).toEqual(result.actions);
  });

  it('forms get the messages server actions answer with (errors, documents.pendingScan, ...)', () => {
    expect(ACTION_PATHS).toContain('errors');
    expect(ACTION_PATHS).toContain('documents.pendingScan');
    for (const area of ['login', 'signup', 'forgot-password', 'reset-password', 'account', 'orgs', 'sourcing']) expect(AREA_PATHS[area], area).toContain('@actions');
  });

  it('has no client translation call that the analysis cannot follow', () => {
    expect(result.dynamic).toEqual([]);
  });

  it('every area that needs messages is wrapped by a layout using ScopedMessages', () => {
    for (const area of Object.keys(AREA_PATHS)) {
      const f = join(process.cwd(), 'src/app/[locale]', area, 'layout.tsx');
      expect(readFileSync(f, 'utf8'), area).toContain(`area="${area}"`);
    }
  });

  it.each(['en', 'ms', 'ta'] as const)('every listed path exists in the %s catalogue', (loc) => {
    const missing = [...BASE_PATHS, ...ACTION_PATHS, ...Object.values(AREA_PATHS).flat()].filter((p) => p !== '@actions' && get(MESSAGES[loc], p) === undefined);
    expect(missing).toEqual([]);
  });

  it('the base set is small', () => {
    expect(JSON.stringify(pickMessages(MESSAGES.en, BASE_PATHS)).length).toBeLessThan(4000);
  });

  it('pickMessages and mergeMessages keep nested keys', () => {
    const a = pickMessages({ x: { y: { z: 'a', w: 'b' }, q: 'c' } }, ['x.y.z', 'x.q']);
    expect(a).toEqual({ x: { y: { z: 'a' }, q: 'c' } });
    expect(mergeMessages(a, { x: { y: { w: 'b' } } })).toEqual({ x: { y: { z: 'a', w: 'b' }, q: 'c' } });
    expect(readdirSync(join(process.cwd(), 'src/i18n'))).toContain('pick-messages.ts');
  });
});
