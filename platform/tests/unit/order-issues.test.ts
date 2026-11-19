import { describe, expect, it } from 'vitest';
import en from '../../messages/deals/en.json';
import ms from '../../messages/deals/ms.json';
import ta from '../../messages/deals/ta.json';
import { decodeIssueNote, encodeIssueNote, ISSUE_REASONS } from '../../src/lib/issue-note';

// WP5: an order problem is an "issue" between two businesses. The words that belong to payments (dispute, refund, chargeback, escrow release)
// must not appear anywhere a user can read about an agreement, because INOK holds and moves no money.
const VALUES = (o: unknown): string[] => (typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(VALUES) : []);

describe('order issue wording', () => {
  const banned: Record<string, RegExp> = {
    en: /dispute|refund|chargeback|escrow (release|hold)|money back|compensat/i,
    ms: /pertikaian|bayaran balik|tuntutan balik|pulangan wang|pampasan/i,
    ta: /தகராறு|பணத்தைத் திருப்பி|பணத்தைத் திரும்ப|இழப்பீடு/,
  };
  for (const [lang, file] of [['en', en], ['ms', ms], ['ta', ta]] as const) {
    it(`no payment-dispute wording in the ${lang} deals messages`, () => {
      const hits = VALUES(file).filter((v) => banned[lang]!.test(v));
      expect(hits).toEqual([]);
    });
    it(`the ${lang} issue reasons and admin list labels exist`, () => {
      const d = (file as unknown as { deals: Record<string, string> }).deals;
      for (const r of ISSUE_REASONS) expect(d[`ir_${r}`], `${lang} ir_${r}`).toBeTruthy();
      for (const k of ['issueHelp', 'issueReason', 'issuesTitle', 'issuesIntro', 'issuesEmpty', 'issuesNoAccess', 'reportedBy', 'act_dispute', 'os_disputed']) expect(d[k], `${lang} ${k}`).toBeTruthy();
    });
  }
  it('the issue help text states that INOK holds no money and decides nothing', () => {
    expect((en as unknown as { deals: Record<string, string> }).deals.issueHelp).toMatch(/does not decide.*does not hold or move money/i);
  });
});

describe('issue note encoding', () => {
  it('round-trips every reason', () => {
    for (const r of ISSUE_REASONS) expect(decodeIssueNote(encodeIssueNote(r, '  The photos never arrived  '))).toEqual({ reason: r, details: 'The photos never arrived' });
  });
  it('older notes without a reason read as plain text', () => {
    expect(decodeIssueNote('Never arrived')).toEqual({ reason: null, details: 'Never arrived' });
    expect(decodeIssueNote('[unknown_code] text')).toEqual({ reason: null, details: '[unknown_code] text' });
    expect(decodeIssueNote(null)).toEqual({ reason: null, details: '' });
  });
});
