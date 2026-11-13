'use server';

import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { catName } from '@/lib/category';
import { failure, success, type FormState } from '@/lib/form-state';
import type { LeadDetail } from '@/lib/leads';
import { localeSchema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { getRequestForSeller } from '@/server/services/directory';
import { recordLead } from '@/server/services/enquiries';
import { listCategories } from '@/server/services/verification';

/** Full details of one buyer request for the board drawer. Contact details only come back once the database has unlocked them. */
export async function loadLeadDetailAction(orgId: string, requestId: string, locale: string): Promise<LeadDetail | null> {
  if (!uuidSchema.safeParse(orgId).success || !uuidSchema.safeParse(requestId).success) return null;
  const lc = localeSchema.catch('en').parse(locale);
  const { supabase, user } = await actionUser();
  if (!user) return null;
  const r = await getRequestForSeller(supabase, requestId, orgId);
  if (!r.ok || !r.data.title) return null;
  const v = r.data;
  const t = await getTranslations({ locale: lc });
  const cats = await listCategories(supabase);
  const cat = cats.find((c) => c.slug === v.category_slug);
  const reasons = [...(v.reason_codes ?? []).map((c) => (t.has(`biz2.board.reason.${c}`) ? t(`biz2.board.reason.${c}`) : null)), cat ? catName(lc, cat) : null].filter((x): x is string => Boolean(x));
  const dash = t('biz2.board.notGiven');
  return {
    title: v.title ?? '',
    buyer: v.buyer_name ?? null,
    area: [v.target_district, v.target_state].filter(Boolean).join(', ') || dash,
    qty: v.quantity ? `${v.quantity} ${v.unit ?? ''}`.trim() : dash,
    neededBy: v.needed_by ?? dash,
    budget: v.budget_min || v.budget_max ? `RM ${v.budget_min ?? '?'} - ${v.budget_max ?? '?'}` : dash,
    description: v.description ?? '',
    reasons,
    phone: v.contact_phone ?? null,
    email: v.contact_email ?? null,
  };
}

/** "Mark won" / "Mark lost": the business's own report on an enquiry (never a payment record). */
export async function markLeadAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = String(f.get('enquiryId') ?? '');
  const stage = String(f.get('stage') ?? '');
  if (!uuidSchema.safeParse(id).success || !['reported_won', 'reported_lost'].includes(stage)) return failure('invalid_input');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await recordLead(supabase, id, stage, null, null);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('biz2.board.done');
}
