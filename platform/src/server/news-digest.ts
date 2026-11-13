import { messagesFor, type Locale } from '@/i18n/messages';
import type { MailerLike } from './gov/notify';
import type { GovRpc } from './gov/worker';

/**
 * Weekly news digest. For every person who switched the weekly email on, take the posts published in the last seven days
 * for their topics and language and send one plain-text email. A claim row (user + ISO week) makes the send at-most-once;
 * if the mail provider refuses the message the claim is released so the next run tries again. No posts means no email.
 */

export interface DigestDeps {
  rpc: GovRpc;
  mailer: MailerLike | null;
  siteUrl: string;
  now?: Date;
}
export interface DigestSummary {
  candidates: number;
  sent: number;
  skippedNoPosts: number;
  skippedAlreadySent: number;
  failed: number;
  email_unavailable: boolean;
}

interface Candidate {
  user_id: string;
  email: string;
  language: Locale;
  topics: string[];
}
interface Post {
  id: string;
  title: string;
  summary: string;
  category: string;
}

/** ISO 8601 week key, e.g. 2026-W46. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const dig = (locale: Locale, key: string): string => {
  const tree = (messagesFor(locale) as { news2?: { digest?: Record<string, string> } }).news2?.digest;
  return tree?.[key] ?? '';
};

export function buildDigest(c: Pick<Candidate, 'language'>, posts: Post[], siteUrl: string): { subject: string; text: string } {
  const lang: Locale = (['en', 'ta', 'ms'] as const).includes(c.language) ? c.language : 'en';
  const base = siteUrl.replace(/\/+$/, '');
  const lines = [dig(lang, 'intro'), ''];
  for (const p of posts) lines.push(p.title, p.summary, `${dig(lang, 'read')}: ${base}/${lang}/news/${p.id}`, '');
  lines.push('--', `${dig(lang, 'unsubscribeNote')} ${base}/${lang}/news`);
  return { subject: dig(lang, 'subject'), text: lines.join('\n') };
}

export async function runNewsDigestOnce(deps: DigestDeps): Promise<DigestSummary> {
  const out: DigestSummary = { candidates: 0, sent: 0, skippedNoPosts: 0, skippedAlreadySent: 0, failed: 0, email_unavailable: false };
  const now = deps.now ?? new Date();
  const week = isoWeekKey(now);
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const cand = await deps.rpc('news_digest_candidates');
  if (cand.error) throw new Error(`digest: ${cand.error.message}`);
  const list = (cand.data ?? []) as Candidate[];
  out.candidates = list.length;
  for (const c of list) {
    if (c.topics.length === 0) {
      out.skippedNoPosts++;
      continue;
    }
    const lang: Locale = (['en', 'ta', 'ms'] as const).includes(c.language) ? c.language : 'en';
    const postsRes = await deps.rpc('news_digest_posts', { p_since: since, p_language: lang, p_topics: c.topics });
    const posts = ((postsRes.data ?? []) as Post[]) ?? [];
    if (postsRes.error || posts.length === 0) {
      out.skippedNoPosts++;
      continue;
    }
    if (!deps.mailer) {
      out.email_unavailable = true;
      continue; // nothing claimed: a later run with a mailer sends it
    }
    const claim = await deps.rpc('news_digest_claim', { p_user: c.user_id, p_week: week });
    if (claim.error || claim.data !== true) {
      out.skippedAlreadySent++;
      continue;
    }
    try {
      const mail = buildDigest(c, posts, deps.siteUrl);
      await deps.mailer.send({ to: c.email, subject: mail.subject, text: mail.text });
      out.sent++;
    } catch {
      out.failed++;
      await deps.rpc('news_digest_release', { p_user: c.user_id, p_week: week });
    }
  }
  return out;
}
