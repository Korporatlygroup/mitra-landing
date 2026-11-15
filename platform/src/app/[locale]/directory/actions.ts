'use server';

import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { formToObject, nonSecretValues, parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { reportSchema, sendEnquirySchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { getProfile } from '@/server/services/auth';
import { openListingEnquiry, reportContent } from '@/server/services/directory';
import { createOrg, listMyMemberships } from '@/server/services/orgs';

/** In-app enquiry from a public listing. A buyer organisation is created on first use when the user has none. */
export async function sendEnquiryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // The profile dialog sends quantity / needed-by / details separately; they are written into the one stored message.
  if (formData.has('details')) {
    const t = await getTranslations({ locale: String(formData.get('locale') ?? 'en') });
    const lines: string[] = [];
    const qty = String(formData.get('quantity') ?? '').trim();
    const by = String(formData.get('neededBy') ?? '').trim();
    if (qty) lines.push(`${t('dir2.dialogQty')}: ${qty}`);
    if (by) lines.push(`${t('dir2.dialogBy')}: ${by}`);
    lines.push(String(formData.get('details') ?? '').trim());
    formData.set('note', lines.filter(Boolean).join('\n'));
  }
  const p = parseForm(sendEnquirySchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;

  let orgId = d.buyerOrgId;
  if (!orgId) orgId = eligibleBuyerOrgs(await listMyMemberships(supabase, user.id))[0]?.org.id;
  if (!orgId) {
    const profile = await getProfile(supabase, user.id);
    const made = await createOrg(supabase, 'buyer', (profile.display_name || 'My requests').slice(0, 160));
    if (!made.ok) return failure(made.errorKey, nonSecretValues(formToObject(formData)));
    orgId = made.data;
  }
  const r = await openListingEnquiry(supabase, orgId, d.slug, d.topic, d.note);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(formToObject(formData)));
  revalidatePath('/', 'layout');
  return success(r.data.created ? 'dir.enquirySent' : 'dir.enquiryExists');
}

export async function reportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(reportSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await reportContent(supabase, p.data.type, p.data.target, p.data.reason, p.data.note ?? null);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(formToObject(formData)));
  return success('rep.sent');
}
