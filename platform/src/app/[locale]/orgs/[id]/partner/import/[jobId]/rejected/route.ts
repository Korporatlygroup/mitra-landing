import { getTranslations } from 'next-intl/server';
import { NextResponse } from 'next/server';
import { uuidSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { importErrorText } from '@/lib/import-errors';
import { toCsv } from '@/server/import';

import { getImport } from '@/server/services/p5-partner';
import type { ImportProblemRow } from '@/server/services/p5-types';

export const dynamic = 'force-dynamic';

/**
 * GET .../partner/import/<job>/rejected : CSV of the rows that could not be imported (row number, product code, name, what is wrong, in the
 * partner's language). Built from the database's record of the job (the uploaded file itself is never stored). Cells are neutralised against
 * spreadsheet formulas. Only members of the partner organisation get data (the database decides).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ locale: string; id: string; jobId: string }> }) {
  const { locale, id, jobId } = await ctx.params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(jobId).success) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return new NextResponse(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const rows: ImportProblemRow[] = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const r = await getImport(supabase, id, jobId, 'problems', offset);
    if (!r.ok) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    rows.push(...r.data.rows);
    if (r.data.rows.length < 100) break;
  }
  const t = await getTranslations({ locale, namespace: 'p5partner.import' });
  const te = await getTranslations({ locale, namespace: 'errors' });
  const head = [t('report.row'), t('report.sku'), t('report.name'), t('report.problems')];
  const body = rows.map((r) => [String(r.row_no), r.sku ?? '', r.name ?? '', r.errors.map((e) => importErrorText(t as never, te as never, e)).join(' | ')]);
  return new NextResponse(toCsv([head, ...body]), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rejected-rows.csv"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
