import type { NextRequest } from 'next/server';
import { MAX_IMAGE_BYTES } from '@/lib/image-upload';
import { contentLengthVerdict, isSameOriginRequest } from '@/lib/http-safety';
import { requiresMfa } from '@/lib/permissions';
import { uuidSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { LIMITS, uploadOrgKey, uploadUserKey } from '@/lib/throttle';
import * as priv from '@/server/privileged';
import { scanBytes } from '@/server/scanner';
import { getMfaStatus } from '@/server/services/mfa';
import { getRolePermissions, listMyMemberships } from '@/server/services/orgs';
import { ingestProductImage } from '@/server/services/p5-files';
import { jsonFail, jsonOk } from '@/server/services/p5-http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/v1/products/[id]/media   multipart/form-data: `file` (png, jpeg or webp, at most 5 MiB), `alt` (optional, up to 200 chars)
 * Same order of checks as the supplier document route (same-origin, getUser, Content-Length bound, product read with the USER's
 * session, partner membership with catalogue:manage + MFA for owners, throttle) and the same pure pipeline. Image metadata is stripped
 * before hashing and scanning. If the scanner is unavailable the image is stored privately and registered as `pending`: it is never
 * served and never published until a later scan marks it clean. Responses: `{ ok: true, id, scanStatus }` or `{ ok: false, errorKey }`.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isSameOriginRequest(request.headers, request.url)) return jsonFail('forbidden');
    const { id: productId } = await context.params;
    if (!uuidSchema.safeParse(productId).success) return jsonFail('not_found');

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return jsonFail('unauthenticated');

    const verdict = contentLengthVerdict(request.headers, MAX_IMAGE_BYTES);
    if (verdict === 'missing') return jsonFail('file_empty', 411);
    if (verdict === 'too_large') return jsonFail('file_too_large');

    // Members can read their own product row (RLS); anyone else gets the same 404 as for a missing product.
    const { data: product } = await supabase.from('products').select('partner_org_id').eq('id', productId).maybeSingle();
    const orgId = (product as { partner_org_id?: string } | null)?.partner_org_id;
    if (!orgId) return jsonFail('not_found');
    const mine = (await listMyMemberships(supabase, user.id)).find((m) => m.org.id === orgId);
    if (!mine || mine.org.type !== 'partner' || !(await getRolePermissions(supabase, mine.role)).has('catalogue:manage')) return jsonFail('forbidden');
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
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return jsonFail('file_empty');
    if (file.size > MAX_IMAGE_BYTES) return jsonFail('file_too_large');
    const altRaw = form.get('alt');
    const alt = typeof altRaw === 'string' && altRaw.trim() !== '' ? altRaw.trim().slice(0, 200) : null;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await ingestProductImage(
      {
        scan: scanBytes,
        upload: async (path, b, mime) => (await priv.uploadToBucket(priv.MEDIA_BUCKET, path, b, mime)).ok,
        remove: (path) => priv.deleteFromBucket(priv.MEDIA_BUCKET, path),
        register: (i) =>
          priv.registerProductMedia({
            orgId,
            userId: user.id,
            productId,
            mime: i.mime,
            size: i.size,
            sha256: i.sha256,
            storagePath: i.storagePath,
            scanStatus: i.scanStatus,
            scanEngine: i.scanEngine,
            alt,
          }),
        newId: () => crypto.randomUUID(),
      },
      { orgId, productId, fileName: file.name, declaredMime: file.type, bytes },
    );
    if (!result.ok) return jsonFail(result.errorKey);
    return jsonOk({ id: result.id, scanStatus: result.scanStatus }, 201);
  } catch {
    return jsonFail('internal');
  }
}
