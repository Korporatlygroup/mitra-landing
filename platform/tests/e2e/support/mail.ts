import { MAILPIT_URL } from './env';

export interface Mail {
  id: string;
  subject: string;
  text: string;
  html: string;
}

async function list(to: string): Promise<{ ID: string }[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`);
  if (!res.ok) return [];
  return ((await res.json()) as { messages: { ID: string }[] }).messages ?? [];
}

/** Waits for a mail to `to` that is not in `seen` (and, optionally, whose body matches `match`). Newest first. */
export async function waitForMail(to: string, opts: { seen?: Set<string>; match?: RegExp; timeoutMs?: number } = {}): Promise<Mail> {
  const timeout = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const m of await list(to)) {
      if (opts.seen?.has(m.ID)) continue;
      const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${m.ID}`)).json()) as { Subject: string; Text: string; HTML: string };
      const mail = { id: m.ID, subject: full.Subject, text: full.Text ?? '', html: full.HTML ?? '' };
      if (opts.match && !opts.match.test(`${mail.text}\n${mail.html}`)) continue;
      opts.seen?.add(m.ID);
      return mail;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No matching email for ${to} in Mailpit within ${timeout}ms`);
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
}

const decode = (s: string) => s.replace(/&amp;/g, '&');
export const CONFIRM_RE = /\/auth\/callback\?/;
export const INVITE_RE = /\/(?:en|ta)\/invite\/[0-9a-f]{64}/;

/** The confirmation link (auth callback) in a sign-up email. */
export function confirmLink(mail: Mail): string {
  const m = `${mail.html}\n${mail.text}`.match(/https?:\/\/[^\s"'<>)]*\/auth\/callback\?[^\s"'<>)]+/);
  if (!m) throw new Error('No confirmation link in email');
  return decode(m[0]);
}
/** The invitation link (/en/invite/<token>) in an invitation email. */
export function inviteLink(mail: Mail): string {
  const m = `${mail.text}\n${mail.html}`.match(/https?:\/\/[^\s"'<>)]*\/(?:en|ta)\/invite\/[0-9a-f]{64}/);
  if (!m) throw new Error('No invitation link in email');
  return m[0];
}
export const tokenOf = (link: string) => link.slice(-64);
