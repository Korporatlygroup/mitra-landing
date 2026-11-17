import { notificationTarget } from '@/lib/notification-ui';
import type { NotificationRow } from '@/server/services/verification';
import type { MailMessage } from './mailer';
import type { MailerLike } from './gov/notify';

/**
 * Transactional email for in-app notifications. The recipient is the person the notification was already created for (the database
 * chose them by organisation membership and permission); this module only decides the words. Emails say WHAT kind of thing happened
 * and link to the app, where the usual sign-in and authorisation apply: they never carry names, prices, messages, document names or
 * anything about another organisation. Subjects are fixed strings. The Malay and Tamil wording is draft, awaiting native review.
 * Same colours and layout as the Supabase authentication templates (scripts/build-email-templates.mjs).
 */

type Locale = 'en' | 'ms' | 'ta';
type Group = 'enquiry' | 'quote' | 'request' | 'sourcing' | 'listing' | 'verification' | 'partner' | 'referral' | 'other';

const BRAND = '#8c1d40';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const COPY: Record<Locale, { subject: Record<Group, string>; line: Record<Group, string>; open: string; why: string; settings: string; footer: string }> = {
  en: {
    subject: {
      enquiry: 'INOK: new activity on an enquiry',
      quote: 'INOK: an update on a quotation',
      request: 'INOK: an update on a request',
      sourcing: 'INOK: an update on sourcing',
      listing: 'INOK: an update on your listing',
      verification: 'INOK: a decision on your verification',
      partner: 'INOK: an update on your supplier or partner profile',
      referral: 'INOK: an update on a referral',
      other: 'INOK: you have a new notification',
    },
    line: {
      enquiry: 'There is new activity on one of your enquiries.',
      quote: 'There is an update on one of your quotations.',
      request: 'There is an update on one of your requests.',
      sourcing: 'There is an update on one of your sourcing requests.',
      listing: 'There is an update on your business listing.',
      verification: 'A decision was recorded on your business verification.',
      partner: 'There is an update on your supplier, product or partner profile.',
      referral: 'There is an update on a referral.',
      other: 'You have a new notification.',
    },
    open: 'Open INOK',
    why: 'Sign in to see the details. For your privacy this email does not include them.',
    settings: 'You can switch these emails off in your account settings.',
    footer: 'INOK is an independent business platform. It is not a government agency and does not decide eligibility for any programme.',
  },
  ms: {
    subject: {
      enquiry: 'INOK: aktiviti baharu pada pertanyaan',
      quote: 'INOK: kemas kini pada sebut harga',
      request: 'INOK: kemas kini pada permintaan',
      sourcing: 'INOK: kemas kini pada sumber bekalan',
      listing: 'INOK: kemas kini pada penyenaraian anda',
      verification: 'INOK: keputusan pada pengesahan anda',
      partner: 'INOK: kemas kini pada profil pembekal atau rakan anda',
      referral: 'INOK: kemas kini pada rujukan',
      other: 'INOK: anda ada pemberitahuan baharu',
    },
    line: {
      enquiry: 'Ada aktiviti baharu pada salah satu pertanyaan anda.',
      quote: 'Ada kemas kini pada salah satu sebut harga anda.',
      request: 'Ada kemas kini pada salah satu permintaan anda.',
      sourcing: 'Ada kemas kini pada salah satu permintaan sumber bekalan anda.',
      listing: 'Ada kemas kini pada penyenaraian perniagaan anda.',
      verification: 'Satu keputusan telah direkodkan pada pengesahan perniagaan anda.',
      partner: 'Ada kemas kini pada profil pembekal, produk atau rakan anda.',
      referral: 'Ada kemas kini pada satu rujukan.',
      other: 'Anda ada pemberitahuan baharu.',
    },
    open: 'Buka INOK',
    why: 'Log masuk untuk melihat butirannya. Demi privasi anda, e-mel ini tidak menyertakannya.',
    settings: 'Anda boleh mematikan e-mel ini dalam tetapan akaun anda.',
    footer: 'INOK ialah platform perniagaan bebas. INOK bukan agensi kerajaan dan tidak menentukan kelayakan bagi sebarang program.',
  },
  ta: {
    subject: {
      enquiry: 'INOK: விசாரணையில் புதிய செயல்பாடு',
      quote: 'INOK: ஒரு விலைப்புள்ளியில் புதுப்பிப்பு',
      request: 'INOK: ஒரு கோரிக்கையில் புதுப்பிப்பு',
      sourcing: 'INOK: மூலப்பொருள் தேடலில் புதுப்பிப்பு',
      listing: 'INOK: உங்கள் பட்டியலில் புதுப்பிப்பு',
      verification: 'INOK: உங்கள் சரிபார்ப்பில் முடிவு',
      partner: 'INOK: உங்கள் விநியோகஸ்தர் அல்லது கூட்டாளர் சுயவிவரத்தில் புதுப்பிப்பு',
      referral: 'INOK: ஒரு பரிந்துரையில் புதுப்பிப்பு',
      other: 'INOK: உங்களுக்கு புதிய அறிவிப்பு உள்ளது',
    },
    line: {
      enquiry: 'உங்கள் விசாரணைகளில் ஒன்றில் புதிய செயல்பாடு உள்ளது.',
      quote: 'உங்கள் விலைப்புள்ளிகளில் ஒன்றில் புதுப்பிப்பு உள்ளது.',
      request: 'உங்கள் கோரிக்கைகளில் ஒன்றில் புதுப்பிப்பு உள்ளது.',
      sourcing: 'உங்கள் மூலப்பொருள் தேடல் கோரிக்கைகளில் ஒன்றில் புதுப்பிப்பு உள்ளது.',
      listing: 'உங்கள் வணிகப் பட்டியலில் புதுப்பிப்பு உள்ளது.',
      verification: 'உங்கள் வணிக சரிபார்ப்பில் ஒரு முடிவு பதிவு செய்யப்பட்டது.',
      partner: 'உங்கள் விநியோகஸ்தர், பொருள் அல்லது கூட்டாளர் சுயவிவரத்தில் புதுப்பிப்பு உள்ளது.',
      referral: 'ஒரு பரிந்துரையில் புதுப்பிப்பு உள்ளது.',
      other: 'உங்களுக்கு புதிய அறிவிப்பு உள்ளது.',
    },
    open: 'INOK ஐத் திறக்கவும்',
    why: 'விவரங்களைக் காண உள்நுழையவும். உங்கள் தனியுரிமைக்காக இந்த மின்னஞ்சலில் அவை சேர்க்கப்படவில்லை.',
    settings: 'இந்த மின்னஞ்சல்களை உங்கள் கணக்கு அமைப்புகளில் நிறுத்தலாம்.',
    footer: 'INOK ஒரு சுதந்திரமான வணிகத் தளம். இது அரசு நிறுவனம் அல்ல; எந்த திட்டத்திற்கும் தகுதியை இது தீர்மானிப்பதில்லை.',
  },
};

export interface ClaimedEmail {
  queue_id: string;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  org_id: string | null;
  email: string;
  language: string;
  attempts: number;
}

export function groupOf(kind: string): Group {
  const head = kind.split(/[._]/)[0] ?? '';
  switch (head) {
    case 'enquiry': return 'enquiry';
    case 'quote': return 'quote';
    case 'request': return 'request';
    case 'sourcing': return 'sourcing';
    case 'listing': return 'listing';
    case 'verification': return 'verification';
    case 'partner': case 'supplier': case 'product': return 'partner';
    case 'referral': return 'referral';
    default: return 'other';
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Path the notification points at; only well-formed ids are used, anything else falls back to the notification centre. */
export function linkPath(row: Pick<ClaimedEmail, 'kind' | 'entity_type' | 'entity_id' | 'org_id'>): string {
  const idOk = row.entity_id && UUID.test(row.entity_id);
  const orgOk = row.org_id && UUID.test(row.org_id);
  if (!idOk && row.entity_type !== 'listing' && row.entity_type !== 'verification_claim') return '/notifications';
  const path = notificationTarget({ kind: row.kind, entity_type: row.entity_type, entity_id: row.entity_id, org_id: orgOk ? row.org_id : null } as NotificationRow);
  return path ?? '/notifications';
}

export function buildNotificationEmail(row: ClaimedEmail, siteUrl: string): MailMessage {
  if (!PLAIN_ADDRESS.test(row.email)) throw new Error('invalid recipient address');
  const lang: Locale = row.language === 'ms' || row.language === 'ta' ? row.language : 'en';
  const c = COPY[lang];
  const g = groupOf(row.kind);
  const link = `${siteUrl.replace(/\/$/, '')}/${lang}${linkPath(row)}`;
  const text = `${c.line[g]}\n\n${c.open}: ${link}\n\n${c.why}\n${c.settings}\n\n${c.footer}`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(c.subject[g])}</title></head>
<body style="margin:0;padding:0;background:#f6f1f3;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1f3;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:2px;">INOK</td></tr>
<tr><td style="padding:28px;"><h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111;">${esc(c.subject[g].replace(/^INOK:\s*/, ''))}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#222;">${esc(c.line[g])}</p>
<p style="margin:24px 0;"><a href="${esc(link)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:8px;">${esc(c.open)}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#555;">${esc(c.why)}</p><p style="margin:0;font-size:14px;line-height:1.5;color:#555;">${esc(c.settings)}</p></td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #eee;font-size:12px;line-height:1.5;color:#666;">${esc(c.footer)}</td></tr></table></td></tr></table></body></html>`;
  // The idempotency key is the notification: a repeated send of the same notification is dropped by the provider for 24 hours.
  return { to: row.email, subject: c.subject[g], text, html, idempotencyKey: `notification-email/${row.queue_id}` };
}

export interface NotifyEmailDeps {
  rpc: (name: 'claim_notification_emails' | 'mark_notification_email', args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  mailer: MailerLike | null;
  siteUrl: string;
  batch?: number;
}
export interface NotifyEmailSummary { claimed: number; accepted: number; failed: number; email_unavailable: boolean }

/**
 * One bounded delivery run. A message counts as sent only after Resend accepted it (the call resolved); any failure goes back to the
 * queue for a limited number of retries with growing delays (the database enforces the limit). Logs carry the queue id and an error
 * code only, never an address or content.
 */
export async function runNotificationEmailsOnce(deps: NotifyEmailDeps): Promise<NotifyEmailSummary> {
  const out: NotifyEmailSummary = { claimed: 0, accepted: 0, failed: 0, email_unavailable: false };
  const claim = await deps.rpc('claim_notification_emails', { p_limit: deps.batch ?? 25 });
  if (claim.error) throw new Error(`claim: ${claim.error.message}`);
  const rows = (claim.data ?? []) as ClaimedEmail[];
  out.claimed = rows.length;
  for (const row of rows) {
    if (!deps.mailer) {
      out.email_unavailable = true;
      await deps.rpc('mark_notification_email', { p_queue: row.queue_id, p_ok: false, p_error: 'mailer_not_configured', p_provider: null });
      continue;
    }
    try {
      const id = await deps.mailer.send(buildNotificationEmail(row, deps.siteUrl));
      await deps.rpc('mark_notification_email', { p_queue: row.queue_id, p_ok: true, p_error: null, p_provider: typeof id === 'string' ? id : null });
      out.accepted += 1;
    } catch (err) {
      const name = (err as Error).name === 'MailSendError' ? (err as Error).message : `send_failed:${(err as Error).name}`;
      await deps.rpc('mark_notification_email', { p_queue: row.queue_id, p_ok: false, p_error: name.slice(0, 200), p_provider: null });
      out.failed += 1;
      console.error('notification email failed', { queue: row.queue_id, attempt: row.attempts, error: name });
    }
  }
  return out;
}
