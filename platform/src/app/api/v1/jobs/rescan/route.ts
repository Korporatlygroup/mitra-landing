import type { NextRequest } from 'next/server';
import { bearerMatches } from '@/lib/http-safety';
import * as priv from '@/server/privileged';
import { scanBytes } from '@/server/scanner';
import { RESCAN_BATCH, rescanDepsFrom, rescanPending, type RescanDeps } from '@/server/services/documents';

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
  // Phase 5: supplier evidence and product images are rescanned the same way (an unscanned image is never served or published).
  const p5 = (bucket: priv.StorageBucket, list: RescanDeps['list'], setResult: RescanDeps['setResult']): RescanDeps => ({
    list,
    download: async (path) => {
      const blob = await priv.downloadFromBucket(bucket, path);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
    scan: scanBytes,
    setResult,
    remove: (path) => priv.deleteFromBucket(bucket, path),
  });
  const supplier_documents = await rescanPending(p5(priv.DOCS_BUCKET, priv.listUnscannedSupplierDocuments, priv.setSupplierDocumentScan), RESCAN_BATCH);
  const product_media = await rescanPending(p5(priv.MEDIA_BUCKET, priv.listUnscannedProductMedia, priv.setProductMediaScan), RESCAN_BATCH);
  return new Response(JSON.stringify({ ok: true, ...summary, supplier_documents, product_media }), { status: 200, headers });
}
