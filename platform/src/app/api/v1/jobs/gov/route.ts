import type { NextRequest } from 'next/server';
import { bearerMatches } from '@/lib/http-safety';
import { getMailer, MailConfigError } from '@/server/mailer';
import { runNotificationsOnce, type MailerLike } from '@/server/gov/notify';
import { runNewsDigestOnce } from '@/server/news-digest';
import { safeFetch } from '@/server/gov/safe-fetch';
import { runWorkerOnce } from '@/server/gov/worker';
import * as priv from '@/server/privileged';

export const dynamic = 'force-dynamic';
// One bounded run per call (a few jobs). Drive it from a scheduler every few minutes. Overlapping runs are safe (database leases).
export const maxDuration = 60;

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const AGENT = 'inok-govnavigator';

/**
 * Government-assistance monitoring run. Disabled (404) unless GOV_WORKER_SECRET is set; otherwise needs
 * `Authorization: Bearer ${GOV_WORKER_SECRET}` (constant-time comparison). The database additionally refuses all work
 * while the `monitoring_enabled` switch is off, so deploying this route starts nothing by itself.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.GOV_WORKER_SECRET;
  if (!secret) return new Response(JSON.stringify({ ok: false }), { status: 404, headers });
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' } });
  }
  const contact = process.env.GOV_WORKER_CONTACT;
  const userAgent = `INOK-GovNavigator/0.1${contact ? ` (${contact})` : ''}`;
  try {
    const summary = await runWorkerOnce({
      rpc: priv.govWorkerRpc,
      fetchPage: (url, allowedHosts, validators) => safeFetch(url, { allowedHosts, userAgent, validators }),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      workerId: `route-${crypto.randomUUID().slice(0, 8)}`,
      agentToken: AGENT,
    });
    // Notifications run after monitoring in the same bounded call. Without a configured mailer, in-app delivery still happens.
    let mailer: MailerLike | null = null;
    try {
      mailer = getMailer();
    } catch (err) {
      if (!(err instanceof MailConfigError)) throw err;
    }
    const notifications = await runNotificationsOnce({
      rpc: priv.govWorkerRpc,
      mailer,
      siteUrl: process.env.SITE_URL ?? 'http://127.0.0.1:3000',
    });
    // The weekly news digest rides on the same bounded call (at most one email per person per ISO week).
    const digest = await runNewsDigestOnce({ rpc: priv.govWorkerRpc, mailer, siteUrl: process.env.SITE_URL ?? 'http://127.0.0.1:3000' });
    return new Response(JSON.stringify({ ok: true, ...summary, notifications, digest }), { status: 200, headers });
  } catch (err) {
    console.error('gov worker run failed', { name: (err as Error).name });
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers });
  }
}
