import type { NextRequest } from 'next/server';
import { contentLengthVerdict, isSameOriginRequest } from '@/lib/http-safety';
import { requiresMfa } from '@/lib/permissions';
import { supplierDocUploadMetaSchema, uuidSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, uploadOrgKey, uploadUserKey } from '@/lib/throttle';
import { MAX_UPLOAD_BYTES } from '@/lib/upload';
import * as priv from '@/server/privileged';
import { scanBytes } from '@/server/scanner';
import { getMfaStatus } from '@/server/services/mfa';
import { getRolePermissions, listMyMemberships } from '@/server/services/orgs';
import { ingestSupplierDocument } from '@/server/services/p5-files';
import { jsonFail, jsonOk } from '@/server/services/p5-http';
import { getSupplier } from '@/server/services/p5-partner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/v1/suppliers/[id]/documents   multipart/form-data: `file`, `docType`
 * Supplier evidence upload. Order: same-origin check, signed-in user (getUser), id shape, Content-Length bound, supplier read with the
 * USER's session (404 unless a member), partner-org membership with supplier:manage (+ MFA for owners), throttle, then the pure
 * pipeline (validate, strip, hash, scan BEFORE storing, store, register, roll back). Private bucket; browsers never touch storage.
 * Responses: `{ ok: true, id, scanStatus }` or `{ ok: false, errorKey }` (translate `errors.<errorKey>`).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isSameOriginRequest(request.headers, request.url)) return jsonFail('forbidden');
    const { id: supplierId } = await context.params;
    if (!uuidSchema.safeParse(supplierId).success) return jsonFail('not_found');

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return jsonFail('unauthenticated');

    const verdict = contentLengthVerdict(request.headers, MAX_UPLOAD_BYTES);
    if (verdict === 'missing') return jsonFail('file_empty', 411);
    if (verdict === 'too_large') return jsonFail('file_too_large');

    const supplier = await getSupplier(supabase, supplierId);
    if (!supplier.ok) return jsonFail(supplier.errorKey);
    const orgId = supplier.data.partner_org_id;
    const mine = (await listMyMemberships(supabase, user.id)).find((m) => m.org.id === orgId);
    if (!mine || mine.org.type !== 'partner' || !(await getRolePermissions(supabase, mine.role)).has('supplier:manage')) return jsonFail('forbidden');
    if (requiresMfa(mine.role, mine.org.type) && (await getMfaStatus(supabase)).currentLevel !== 'aal2') return jsonFail('forbidden');

    const userOk = await priv.authAttempt(uploadUserKey(user.id), LIMITS.uploadUser.max, LIMITS.uploadUser.windowSeconds);
    const orgOk = await priv.authAttempt(uploadOrgKey(orgId), LIMITS.uploadOrg.max, LIMITS.uploadOrg.windowSeconds);
    if (!userOk || !orgOk) return jsonFail('rate_limited');

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonFail('file_empty', 400);
    }
    const meta = supplierDocUploadMetaSchema.safeParse({ docType: form.get('docType') });
    if (!meta.success) return jsonFail('invalid_doc_type');
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return jsonFail('file_empty');
    if (file.size > MAX_UPLOAD_BYTES) return jsonFail('file_too_large');
    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await ingestSupplierDocument(
      {
        scan: scanBytes,
        upload: async (path, b, mime) => (await priv.uploadToBucket(priv.DOCS_BUCKET, path, b, mime)).ok,
        remove: (path) => priv.deleteFromBucket(priv.DOCS_BUCKET, path),
        register: (i) =>
          priv.registerSupplierDocument({
            orgId,
            userId: user.id,
            supplierId,
            docType: meta.data.docType,
            displayName: i.displayName,
            mime: i.mime,
            size: i.size,
            sha256: i.sha256,
            storagePath: i.storagePath,
            scanStatus: i.scanStatus,
            scanEngine: i.scanEngine,
          }),
        newId: () => crypto.randomUUID(),
      },
      { orgId, supplierId, fileName: file.name, declaredMime: file.type, bytes },
    );
    if (!result.ok) return jsonFail(result.errorKey);
    return jsonOk({ id: result.id, scanStatus: result.scanStatus }, 201);
  } catch {
    return jsonFail('internal');
  }
}
