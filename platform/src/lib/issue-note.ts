/**
 * "Report an issue" on an agreement stores one note on the existing order event. The reason is kept as a code in square brackets at the start
 * of the note, for example "[not_delivered] The photos never arrived", so no database change is needed and older notes without a code still read normally.
 */
export const ISSUE_REASONS = ['not_delivered', 'not_as_agreed', 'no_show', 'other'] as const;
export type IssueReason = (typeof ISSUE_REASONS)[number];

export const isIssueReason = (v: string): v is IssueReason => (ISSUE_REASONS as readonly string[]).includes(v);

export const encodeIssueNote = (reason: IssueReason, details: string): string => `[${reason}] ${details.trim()}`;

export function decodeIssueNote(note: string | null): { reason: IssueReason | null; details: string } {
  if (!note) return { reason: null, details: '' };
  const m = /^\[([a-z_]+)\]\s*([\s\S]*)$/.exec(note);
  if (m && isIssueReason(m[1]!)) return { reason: m[1], details: m[2]!.trim() };
  return { reason: null, details: note };
}
