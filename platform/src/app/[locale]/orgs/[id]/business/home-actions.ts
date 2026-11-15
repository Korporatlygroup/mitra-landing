'use server';

import { revalidatePath } from 'next/cache';
import { localeSchema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { dismissCard } from '@/server/services/dashboard';

/** Hides one recommended card for seven days (kept per person and organisation). */
export async function dismissCardAction(formData: FormData): Promise<void> {
  const locale = localeSchema.catch('en').parse(formData.get('locale'));
  const org = uuidSchema.safeParse(formData.get('orgId'));
  const key = String(formData.get('key') ?? '');
  const { supabase, user } = await actionUser();
  if (!user || !org.success) return;
  const r = await dismissCard(supabase, org.data, key);
  if (r.ok) revalidatePath(`/${locale}/orgs/${org.data}/business`);
}
