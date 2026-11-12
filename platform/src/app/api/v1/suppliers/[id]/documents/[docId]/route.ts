import type { NextRequest } from 'next/server';
import { ALLOWED_DOWNLOAD_MIME, contentDispositionAttachment } from '@/lib/http-safety';
import { uuidSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { sanitizeFileName } from '@/lib/upload';
import { downloadFromBucket, DOCS_BUCKET } from '@/server/privileged';
import type { SupplierDocumentAccess } from '@/server/services/p5-types';

export const dynamic = 'force-dynamic';

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
};
/** One identical answer for every failure, so the route reveals nothing about which documents exist. */
const notFound = () => new Response('Not found', { status: 404, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * GET /api/v1/suppliers/[id]/documents/[docId]
 * Supplier evidence download for partner members with supplier:manage and for MITRA reviewers (locked documents). Authorised and
 * audited by the access RPC with the USER's session (clean documents only); the private object is then read with the service key and
 * streamed through the server as an attachment (nothing is cached; there is no long-lived URL). Anything else is the same 404.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string; docId: string }> }) {
  try {
    const { id, docId } = await context.params;
    if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(docId).success) return notFound();

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return notFound();

    const { data, error } = await supabase.rpc('get_supplier_document_access', { p_doc: docId });
    if (error || !data) return notFound();
    const access = data as Partial<SupplierDocumentAccess>;
    if (!access.storage_path || !access.mime_type || !ALLOWED_DOWNLOAD_MIME.has(access.mime_type)) return notFound();
    // The object must belong to the supplier named in the URL: supplier/<org>/<supplier>/<file>.
    const parts = access.storage_path.split('/');
    if (parts.length !== 4 || parts[0] !== 'supplier' || parts[2] !== id) return notFound();

    const blob = await downloadFromBucket(DOCS_BUCKET, access.storage_path);
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
