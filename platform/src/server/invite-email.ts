import en from '../../messages/en.json';
import ta from '../../messages/ta.json';
import type { MailMessage } from './mailer';

interface InviteCopy {
  subject: string;
  intro: string;
  roleLine: string;
  action: string;
  ignore: string;
  expires: string;
}

const copies: Record<'en' | 'ta', { copy: InviteCopy; roles: Record<string, string> }> = {
  en: { copy: en.email.invite, roles: en.roles },
  ta: { copy: ta.email.invite, roles: ta.roles },
};

const MAX_ORG_NAME = 80;
// C0/C1 controls (incl. CR, LF, NEL) plus the Unicode line and paragraph separators (built from code points so
// no raw separator characters appear in this source file).
const CONTROL_RUN = new RegExp(`[\u0000-\u001f\u007f-\u009f${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, 'g');

/**
 * Removes control characters (including CR/LF, NEL and the Unicode line/paragraph separators), collapses
 * whitespace and truncates. Applied to every user-controlled value before it is used in an email.
 */
export function cleanText(value: string, max: number): string {
  const stripped = value.replace(CONTROL_RUN, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...stripped];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : stripped;
}

/** Org names appear only as quoted data in the body, never in the subject or any header. */
export const quoteName = (name: string) => `“${cleanText(name, MAX_ORG_NAME)}”`;

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Only a plain single address is accepted as the recipient (no CR/LF, spaces, commas or angle brackets). */
const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/**
 * Builds the bilingual (English + Tamil) invitation email. The recipient's language is unknown, so both are included.
 * The link carries the one-time token: callers must not log the returned message.
 */
export function buildInviteEmail(args: { to: string; orgName: string; role: string; link: string }): MailMessage {
  if (!PLAIN_ADDRESS.test(args.to)) throw new Error('invalid recipient address');
  if (!/^https?:\/\/[^\s]+$/.test(args.link)) throw new Error('invalid link');

  const parts = (['en', 'ta'] as const).map((l) => {
    const { copy, roles } = copies[l];
    const vars = { org: quoteName(args.orgName), role: roles[args.role] ?? cleanText(args.role, 40) };
    return {
      subject: copy.subject,
      intro: fill(copy.intro, vars),
      roleLine: fill(copy.roleLine, vars),
      action: copy.action,
      ignore: copy.ignore,
      expires: copy.expires,
    };
  });
  const text = parts
    .map((p) => `${p.intro}\n${p.roleLine}\n${p.action}: ${args.link}\n${p.expires}\n${p.ignore}`)
    .join('\n\n-----\n\n');
  const html = parts
    .map(
      (p) =>
        `<p>${escapeHtml(p.intro)}<br>${escapeHtml(p.roleLine)}</p>` +
        `<p><a href="${escapeHtml(args.link)}">${escapeHtml(p.action)}</a></p>` +
        `<p>${escapeHtml(p.expires)}<br>${escapeHtml(p.ignore)}</p>`,
    )
    .join('<hr>');
  // The subject is a fixed string from the message files: no user-controlled text.
  return { to: args.to, subject: `${parts[0].subject} / ${parts[1].subject}`, text, html };
}
