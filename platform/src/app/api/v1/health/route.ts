export const dynamic = 'force-dynamic';

/** Liveness only. Deliberately returns nothing about version, environment or dependencies. */
export function GET() {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
