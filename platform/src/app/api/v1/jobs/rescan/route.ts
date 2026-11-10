import type { NextRequest } from 'next/server';
import { bearerMatches } from '@/lib/http-safety';
import * as priv from '@/server/privileged';
import { scanBytes } from '@/server/scanner';
import { RESCAN_BATCH, rescanDepsFrom, rescanPending } from '@/server/services/documents';

export const dynamic = 'force-dynamic';
// One batch of at most RESCAN_BATCH documents per call; run it from a scheduler every few minutes.
export const maxDuration = 60;

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

/**
 * Scheduled rescan of quarantined (pending) documents. Disabled (404) when CRON_SECRET is unset; otherwise needs
 * `Authorization: Bearer ${CRON_SECRET}` (constant-time comparison).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(JSON.stringify({ ok: false }), { status: 404, headers });
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' } });
  }
  const summary = await rescanPending(rescanDepsFrom(priv, scanBytes), RESCAN_BATCH);
  return new Response(JSON.stringify({ ok: true, ...summary }), { status: 200, headers });
}
