import en from '../../messages/en.json';
import ta from '../../messages/ta.json';
import { cleanText } from './invite-email';
import type { MailMessage } from './mailer';

export type DecisionKind = 'approve' | 'reject' | 'request_info';

const RECIPIENT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const copies = { en, ta } as const;

/**
 * Fixed EN + TA text. The subject never contains reviewer-written or user-written text; the reason appears
 * only in the body as quoted, sanitised data.
 */
export function buildDecisionEmail(args: {
  to: string;
  claimType: keyof typeof en.claimTypes;
  decision: DecisionKind;
  reason: string;
  siteUrl: string;
  orgId: string;
}): MailMessage {
  if (!RECIPIENT.test(args.to)) throw new Error('invalid recipient address');
  const reason = `“${cleanText(args.reason, 300)}”`;

  const parts = (['en', 'ta'] as const).map((l) => {
    const c = copies[l];
    const link = `${args.siteUrl.replace(/\/+$/, '')}/${l}/orgs/${args.orgId}/business/verification`;
    return {
      subject: c.email.decision.subject,
      intro: fill(c.email.decision.intro, { claim: c.claimTypes[args.claimType] }),
      decisionLine: c.email.decision[args.decision],
      reasonLine: fill(c.email.decision.reason, { reason }),
      open: c.email.decision.open,
      link,
    };
  });
  const text = parts.map((p) => `${p.intro}\n${p.decisionLine}\n${p.reasonLine}\n${p.open}: ${p.link}`).join('\n\n-----\n\n');
  const html = parts
    .map(
      (p) =>
        `<p>${esc(p.intro)}<br>${esc(p.decisionLine)}<br>${esc(p.reasonLine)}</p><p><a href="${esc(p.link)}">${esc(p.open)}</a></p>`,
    )
    .join('<hr>');
  return { to: args.to, subject: `${parts[0].subject} / ${parts[1].subject}`, text, html };
}
