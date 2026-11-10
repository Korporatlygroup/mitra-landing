import type { NextRequest } from 'next/server';
import { ALLOWED_DOWNLOAD_MIME, contentDispositionAttachment } from '@/lib/http-safety';
import { uuidSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { sanitizeFileName } from '@/lib/upload';
import { downloadObject } from '@/server/privileged';

export const dynamic = 'force-dynamic';

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
};

/** One identical answer for every failure, so the route reveals nothing about which documents exist. */
const notFound = () => new Response('Not found', { status: 404, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * Authorise-and-log with the USER's session (RPC get_document_access), then read the private object with the
 * service key and stream it as an attachment.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) return notFound();

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return notFound();

    const { data, error } = await supabase.rpc('get_document_access', { p_doc: id });
    if (error || !data) return notFound();
    const access = data as { storage_path?: string; mime_type?: string; display_name?: string };
    if (!access.storage_path || !access.mime_type || !ALLOWED_DOWNLOAD_MIME.has(access.mime_type)) return notFound();

    const blob = await downloadObject(access.storage_path);
    if (!blob) return notFound();

    return new Response(blob.stream(), {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': access.mime_type,
        'Content-Length': String(blob.size),
        'Content-Disposition': contentDispositionAttachment(sanitizeFileName(access.display_name ?? 'document')),
      },
    });
  } catch {
    return notFound();
  }
}
