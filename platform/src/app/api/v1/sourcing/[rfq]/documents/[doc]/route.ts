import type { NextRequest } from 'next/server';
import { ALLOWED_DOWNLOAD_MIME, contentDispositionAttachment } from '@/lib/http-safety';
import { uuidSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { sanitizeFileName } from '@/lib/upload';
import { DOCS_BUCKET, downloadFromBucket } from '@/server/privileged';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'" };
const notFound = () => new Response('Not found', { status: 404, headers });

export async function GET(_request: NextRequest,
  context: { params: Promise<{ rfq: string; doc: string }> }) {
  try {
    const { rfq, doc } = await context.params;
    if (!uuidSchema.safeParse(rfq).success || !uuidSchema.safeParse(doc).success) return notFound();
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return notFound();
    const { data, error } = await db.rpc('get_sourcing_document_access', { p_doc: doc });
    if (error || !data) return notFound();
    const access = data as { rfq_id: string; storage_path: string; mime_type: string; display_name: string };
    if (access.rfq_id !== rfq || !ALLOWED_DOWNLOAD_MIME.has(access.mime_type)
      || !/^sourcing\/[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(access.storage_path)) return notFound();
    const blob = await downloadFromBucket(DOCS_BUCKET, access.storage_path);
    if (!blob) return notFound();
    return new Response(blob.stream(), { status: 200, headers: { ...headers,
      'Content-Type': access.mime_type, 'Content-Length': String(blob.size),
      'Content-Disposition': contentDispositionAttachment(sanitizeFileName(access.display_name)),
    } });
  } catch { return notFound(); }
}
