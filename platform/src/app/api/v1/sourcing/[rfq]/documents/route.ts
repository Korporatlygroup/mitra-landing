import { createHash, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { contentLengthVerdict, isSameOriginRequest } from '@/lib/http-safety';
import { mapRpcError } from '@/lib/errors';
import { uuidSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, uploadOrgKey, uploadUserKey } from '@/lib/throttle';
import { MAX_UPLOAD_BYTES, sanitizeFileName, stripImageMetadata, validateUpload } from '@/lib/upload';
import * as priv from '@/server/privileged';
import { scanBytes } from '@/server/scanner';
import { jsonFail, jsonOk } from '@/server/services/p5-http';
import { getSourcingRfq } from '@/server/services/p6-sourcing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Scan first, then store in a private bucket. A failed registration removes the new object. */
export async function POST(request: NextRequest, context: { params: Promise<{ rfq: string }> }) {
  try {
    if (!isSameOriginRequest(request.headers, request.url)) return jsonFail('forbidden');
    const { rfq } = await context.params;
    if (!uuidSchema.safeParse(rfq).success) return jsonFail('not_found');
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return jsonFail('unauthenticated');
    const sizeVerdict = contentLengthVerdict(request.headers, MAX_UPLOAD_BYTES);
    if (sizeVerdict === 'missing') return jsonFail('length_required');
    if (sizeVerdict === 'too_large') return jsonFail('file_too_large');
    const form = await request.formData();
    const partner = String(form.get('partner') ?? '');
    if (!uuidSchema.safeParse(partner).success) return jsonFail('not_found');
    const { error: authorizationError } = await db.rpc('authorize_sourcing_document_upload',
      { p_rfq: rfq, p_partner: partner });
    if (authorizationError) return jsonFail('not_found');
    const scope = await getSourcingRfq(db, rfq, partner);
    if (!scope.ok || scope.data.status === 'cancelled' || scope.data.status === 'closed'
      || (scope.data.partner_org_id && scope.data.your_invitation_status !== 'accepted')
      || (scope.data.buyer_org_id && !scope.data.partners?.some((p) => p.org_id === partner && p.status === 'accepted')))
      return jsonFail('not_found');
    const org = scope.data.buyer_org_id ?? partner;
    const [userOk, orgOk] = await Promise.all([
      priv.authAttempt(uploadUserKey(user.id), LIMITS.uploadUser.max, LIMITS.uploadUser.windowSeconds),
      priv.authAttempt(uploadOrgKey(org), LIMITS.uploadOrg.max, LIMITS.uploadOrg.windowSeconds),
    ]);
    if (!userOk || !orgOk) return jsonFail('rate_limited');
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return jsonFail('file_empty');
    if (file.size > MAX_UPLOAD_BYTES) return jsonFail('file_too_large');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = validateUpload({ fileName: file.name, declaredMime: file.type, bytes });
    if (!valid.ok) return jsonFail(valid.errorKey);
    let stored: Uint8Array = bytes;
    if (valid.kind !== 'pdf') {
      const clean = stripImageMetadata(bytes, valid.mime);
      if (!clean.ok) return jsonFail('file_unsafe_content');
      stored = clean.bytes;
    }
    const scan = await scanBytes(stored);
    if (scan.status === 'infected') return jsonFail('file_infected');
    if (scan.status !== 'clean') return jsonFail('upload_failed');
    const path = `sourcing/${randomUUID()}.${valid.storageExt}`;
    if (!(await priv.queueSourcingCleanup(path))) return jsonFail('upload_failed');
    if (!(await priv.uploadToBucket(priv.DOCS_BUCKET, path, stored, valid.mime)).ok) return jsonFail('upload_failed');
    const result = await priv.registerSourcingDocument({
      rfq, partner, user: user.id, name: sanitizeFileName(file.name), mime: valid.mime,
      size: stored.length, sha256: createHash('sha256').update(stored).digest('hex'), path,
    });
    if (!result.ok) {
      // The RPC may have committed before a network failure. Its transaction clears the cleanup queue on success;
      // otherwise the queued random path is retried after the grace period. Preserve the object in either case.
      return jsonFail(mapRpcError(result.error));
    }
    return jsonOk({ id: result.id }, 201);
  } catch { return jsonFail('internal'); }
}
