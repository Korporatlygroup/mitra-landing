import type { NextRequest } from 'next/server';
import { bearerMatches } from '@/lib/http-safety';
import { getMailer, MailConfigError } from '@/server/mailer';
import type { MailerLike } from '@/server/gov/notify';
import * as priv from '@/server/privileged';
import { runNotificationEmailsOnce } from '@/server/transactional-email';

export const dynamic = 'force-dynamic';
// One bounded batch per call (at most 25 emails). Started by the Cron Trigger every two minutes; overlapping runs are safe (row locks).
export const maxDuration = 60;

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

/** Transactional notification email run. Disabled (404) without CRON_SECRET; otherwise needs `Authorization: Bearer ${CRON_SECRET}`. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(JSON.stringify({ ok: false }), { status: 404, headers });
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' } });
  }
  let mailer: MailerLike | null = null;
  try {
    mailer = getMailer();
  } catch (err) {
    if (!(err instanceof MailConfigError)) throw err;
  }
  try {
    const summary = await runNotificationEmailsOnce({ rpc: priv.notifyEmailRpc, mailer, siteUrl: process.env.SITE_URL ?? 'http://127.0.0.1:3000' });
    return new Response(JSON.stringify({ ok: true, ...summary }), { status: 200, headers });
  } catch (err) {
    console.error('notification email run failed', { name: (err as Error).name });
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers });
  }
}
