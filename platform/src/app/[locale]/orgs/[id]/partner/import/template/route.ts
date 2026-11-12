import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildTemplateCsv, buildTemplateXlsx } from '@/server/import';

export const dynamic = 'force-dynamic';

/**
 * GET .../partner/import/template?format=csv|xlsx : the blank catalogue file with one example row. Static content (no partner data), but
 * only for signed-in users. Built by the import engine, so formulas and special characters are neutralised.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return new NextResponse(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="mitra-catalogue-template.${format}"`,
  };
  if (format === 'xlsx') {
    const bytes = buildTemplateXlsx();
    return new NextResponse(Buffer.from(bytes), { status: 200, headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
  }
  return new NextResponse(buildTemplateCsv(), { status: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
}
