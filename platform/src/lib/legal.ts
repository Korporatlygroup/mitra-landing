/**
 * Legal policy configuration. EVERY legal page is a management-review DRAFT until `LEGAL_STATUS` is changed to 'approved' AND the
 * operator details below are filled in by management. Nothing here is invented: unknown details are visible placeholders.
 *
 * Publishing checklist (management): fill `OPERATOR`, set dates, have the text reviewed by a Malaysian lawyer, then set
 * LEGAL_STATUS to 'approved'. If the approved text changes what users agreed to, also bump CONSENT_VERSION (src/lib/consent.ts) and
 * private.current_consent_version() together in a migration so existing users are asked to accept again (the re-acceptance screen exists).
 */
export const LEGAL_STATUS: 'draft' | 'approved' = 'draft';

const TBD = (what: string) => `[${what}: to be provided by management]`;

export const OPERATOR = {
  company: TBD('Registered company name'),
  ssm: TBD('SSM registration number'),
  address: TBD('Registered business address'),
  privacyEmail: TBD('Privacy contact email'),
  supportEmail: TBD('Customer support contact'),
  dpo: TBD('Data Protection Officer contact (if appointment is required)'),
  effective: TBD('Effective date'),
  updated: '2026-11-16 (draft)',
} as const;

export const LEGAL_DOCS = ['privacy', 'terms', 'marketplace-policy', 'cookies', 'government-disclaimer', 'complaints'] as const;
export type LegalSlug = (typeof LEGAL_DOCS)[number];

export type Block = { p: string } | { ul: string[] } | { table: { head: string[]; rows: string[][] } } | { note: string };
export interface LegalSection {
  id: string;
  title: string;
  blocks: Block[];
}
export interface LegalDocument {
  title: string;
  intro: string;
  sections: LegalSection[];
}

const TOKENS: Record<string, string> = {
  company: OPERATOR.company,
  ssm: OPERATOR.ssm,
  address: OPERATOR.address,
  privacyEmail: OPERATOR.privacyEmail,
  supportEmail: OPERATOR.supportEmail,
  dpo: OPERATOR.dpo,
  effective: OPERATOR.effective,
  updated: OPERATOR.updated,
};

/** Replaces {company}, {ssm}, {address}, {privacyEmail}, {supportEmail}, {dpo}, {effective}, {updated} with the operator details or their visible placeholders. */
export function fillTokens(text: string): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => TOKENS[k] ?? m);
}

export function fillDocument(doc: LegalDocument): LegalDocument {
  const f = (b: Block): Block =>
    'p' in b ? { p: fillTokens(b.p) }
    : 'note' in b ? { note: fillTokens(b.note) }
    : 'ul' in b ? { ul: b.ul.map(fillTokens) }
    : { table: { head: b.table.head.map(fillTokens), rows: b.table.rows.map((r) => r.map(fillTokens)) } };
  return { title: doc.title, intro: fillTokens(doc.intro), sections: doc.sections.map((s) => ({ id: s.id, title: s.title, blocks: s.blocks.map(f) })) };
}
