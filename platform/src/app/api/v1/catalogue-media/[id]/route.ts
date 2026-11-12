import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { ALLOWED_IMAGE_MIME } from '@/lib/http-safety';
import { uuidSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { downloadFromBucket, MEDIA_BUCKET } from '@/server/privileged';
import { getProductMediaAccess } from '@/server/services/p5-buyer';

export const dynamic = 'force-dynamic';

const BASE_HEADERS = {
  // `private, no-cache`: browsers may keep the bytes but must ask this route again before every use, and the route asks the database
  // every time. So an image whose product is unpublished, or which was removed, stops being served at once; shared caches never store it.
  'Cache-Control': 'private, no-cache',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
};
/** One identical answer for every failure (missing, removed, unscanned, unpublished, not yours). */
const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * GET /api/v1/catalogue-media/[id]   (anonymous allowed)
 * Asks get_product_media_access with whatever session the request has: the database grants access only for an approved, clean image of a
 * currently visible (published) product, or to partner members / reviewers of that product. The private object is then read with the
 * service key and streamed inline with its stored content type. Storage paths are never exposed.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) return notFound();

    const supabase = await createClient();
    const access = await getProductMediaAccess(supabase, id);
    if (!access.ok) return notFound();
    const { storage_path: path, mime_type: mime } = access.data;
    if (!path || !mime || !ALLOWED_IMAGE_MIME.has(mime)) return notFound();
    // products/<org>/<product>/<file>
    if (path.split('/').length !== 4 || !path.startsWith('products/')) return notFound();

    // The stored object never changes for a given media id, so the ETag is derived from id + path (authorisation already passed above).
    const etag = `"${createHash('sha256').update(`${id}:${path}`).digest('hex').slice(0, 32)}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...BASE_HEADERS, ETag: etag } });

    const blob = await downloadFromBucket(MEDIA_BUCKET, path);
    if (!blob) return notFound();
    return new Response(blob.stream(), {
      status: 200,
      headers: { ...BASE_HEADERS, ETag: etag, 'Content-Type': mime, 'Content-Length': String(blob.size), 'Content-Disposition': 'inline' },
    });
  } catch {
    return notFound();
  }
}
