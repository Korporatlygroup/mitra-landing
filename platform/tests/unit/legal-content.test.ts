import { describe, expect, it } from 'vitest';
import { LEGAL_CONTENT, getLegalContent } from '@/content/legal';
import { LEGAL_DOCS, LEGAL_STATUS, OPERATOR, fillDocument, fillTokens, type Block, type LegalDocument } from '@/lib/legal';
import { optionalCheckbox, signUpSchema } from '@/lib/schemas';

const textOf = (d: LegalDocument): string =>
  [d.title, d.intro, ...d.sections.flatMap((s) => [s.title, ...s.blocks.flatMap((b: Block) => ('p' in b ? [b.p] : 'note' in b ? [b.note] : 'ul' in b ? b.ul : [...b.table.head, ...b.table.rows.flat()]))])].join('\n');

describe('legal documents are management-review drafts', () => {
  it('are in draft status and never invent the operator identity', () => {
    expect(LEGAL_STATUS).toBe('draft');
    for (const k of ['company', 'ssm', 'address', 'privacyEmail', 'supportEmail', 'dpo', 'effective'] as const) {
      expect(OPERATOR[k], k).toMatch(/^\[.*to be provided by management\]$/);
    }
  });

  it('every document exists in English and Bahasa Melayu with the same section ids and block shapes', () => {
    for (const slug of LEGAL_DOCS) {
      const en = LEGAL_CONTENT.en[slug];
      const ms = LEGAL_CONTENT.ms[slug];
      expect(ms.sections.map((s) => s.id), slug).toEqual(en.sections.map((s) => s.id));
      en.sections.forEach((s, i) => {
        const shape = (blocks: Block[]) => blocks.map((b) => Object.keys(b)[0]).join(',');
        expect(shape(ms.sections[i]!.blocks), `${slug}/${s.id}`).toBe(shape(s.blocks));
        for (const b of s.blocks) if ('table' in b) {
          const mb = ms.sections[i]!.blocks.find((x, j) => 'table' in x && Object.keys(s.blocks[j]!)[0] === 'table' && j === s.blocks.indexOf(b)) as Extract<Block, { table: unknown }> | undefined;
          expect(mb?.table.head.length, `${slug}/${s.id} table columns`).toBe(b.table.head.length);
          expect(mb?.table.rows.length, `${slug}/${s.id} table rows`).toBe(b.table.rows.length);
        }
      });
    }
  });

  it('only uses known placeholders, and they all resolve to visible bracketed text', () => {
    for (const lang of ['en', 'ms'] as const) {
      for (const slug of LEGAL_DOCS) {
        const raw = textOf(LEGAL_CONTENT[lang][slug]);
        const unknown = [...raw.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !(k! in OPERATOR));
        expect(unknown, `${lang}/${slug}`).toEqual([]);
        expect(textOf(fillDocument(LEGAL_CONTENT[lang][slug]))).not.toMatch(/\{\w+\}/);
      }
    }
    expect(fillTokens('x {company}')).toContain('[Registered company name');
  });

  it('Tamil shows the English text with a notice instead of an unreviewed translation', () => {
    expect(getLegalContent('ta', 'privacy')).toMatchObject({ translated: false });
    expect(getLegalContent('en', 'privacy')).toMatchObject({ translated: true });
    expect(getLegalContent('ms', 'privacy')).toMatchObject({ translated: true });
  });
});

describe('legal text makes no claim the platform cannot back', () => {
  const all = (['en', 'ms'] as const).flatMap((l) => LEGAL_DOCS.map((s) => [`${l}/${s}`, textOf(LEGAL_CONTENT[l][s])] as const));
  it.each(all)('%s', (_name, text) => {
    const t = text.toLowerCase();
    for (const bad of [
      'fully compliant', 'we are compliant', 'fully operational malware', 'automatic backups are', 'never share', 'we never sell and never share',
      '100% secure', 'completely secure', 'guaranteed secure', 'iso 27001', 'soc 2', 'we guarantee', 'advertising cookies are used', 'google analytics',
    ]) expect(t.includes(bad), bad).toBe(false);
  });

  it('the privacy notice states the real limits', () => {
    const p = textOf(LEGAL_CONTENT.en.privacy).toLowerCase();
    expect(p).toContain('malware scanner is not yet operational');
    expect(p).toContain('without automatic backups');
    expect(p).toContain('tokyo');
    expect(p).toContain('not yet completed its transfer assessment');
    expect(p).toContain('marketing');
    expect(p).toContain('never pre-selected');
  });

  it('the terms deny escrow and outcome guarantees, and keep mandatory consumer rights', () => {
    const t = textOf(LEGAL_CONTENT.en.terms).toLowerCase();
    expect(t).toContain('does not provide escrow');
    expect(t).toContain('does not promise leads');
    expect(t).toContain('consumer protection act 1999');
    expect(t).toContain('cannot lawfully be excluded');
    expect(t).toContain('35. contact');
    expect(LEGAL_CONTENT.en.terms.sections).toHaveLength(35);
  });

  it('the government notice carries every required statement', () => {
    const g = textOf(LEGAL_CONTENT.en['government-disclaimer']).toLowerCase();
    for (const s of ['not a government agency', 'last verified', 'preliminary guidance', 'does not guarantee', 'official channel', 'final decision', 'does not approve grants', 'application fee', 'out of date']) {
      expect(g.includes(s) || g.includes(s.replace('does not guarantee', 'does not mean')), s).toBe(true);
    }
  });

  it('the cookie policy lists only what exists and no analytics', () => {
    const c = textOf(LEGAL_CONTENT.en.cookies);
    for (const n of ['sb-', 'inok_org', 'NEXT_LOCALE']) expect(c).toContain(n);
    expect(c.toLowerCase()).toContain('no analytics');
  });
});

describe('sign-up marketing consent', () => {
  const base = { email: 'a@example.test', password: 'Abcdefghi1', displayName: 'A', language: 'en', acceptTerms: 'on', acceptPrivacy: 'on' };
  it('is optional and false unless ticked', () => {
    expect(signUpSchema.parse(base).acceptMarketing).toBe(false);
    expect(signUpSchema.parse({ ...base, acceptMarketing: 'on' }).acceptMarketing).toBe(true);
    expect(optionalCheckbox.parse(undefined)).toBe(false);
  });
  it('terms and privacy stay required', () => {
    expect(signUpSchema.safeParse({ ...base, acceptTerms: undefined }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, acceptPrivacy: undefined }).success).toBe(false);
  });
});
