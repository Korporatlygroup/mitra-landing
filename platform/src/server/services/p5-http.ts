/** Shared helpers for the Phase 5 file route handlers (pure, no privileged access). */

export const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
} as const;

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  file_empty: 400,
  empty_file: 400,
  file_too_large: 413,
  file_type_not_allowed: 415,
  file_unsafe_content: 422,
  file_infected: 422,
  rate_limited: 429,
  upload_failed: 502,
  internal: 500,
  stale_version: 409,
  conflict: 409,
  media_limit_reached: 409,
  document_limit_reached: 409,
  partner_not_approved: 409,
  supplier_suspended: 409,
  product_suspended: 409,
  product_under_review: 409,
  supplier_under_review: 409,
  length_required: 411,
};

/** HTTP status for a message key (errors.*). Unknown keys are 422 (the input was understood but refused). */
export const statusForErrorKey = (key: string): number => STATUS[key] ?? 422;

/** JSON failure `{ ok: false, errorKey }` (the client translates `errors.<errorKey>`). */
export const jsonFail = (errorKey: string, status = statusForErrorKey(errorKey)) =>
  new Response(JSON.stringify({ ok: false, errorKey }), { status, headers: JSON_HEADERS });

export const jsonOk = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify({ ok: true, ...body }), { status, headers: JSON_HEADERS });
