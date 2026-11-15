'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { localeSchema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { listMyMemberships } from '@/server/services/orgs';
import { ACTIVE_ORG_COOKIE, homeFor } from '@/server/workspace';

/** Remembers the organisation the user works in and opens its home. Only an organisation the user belongs to can be chosen. */
export async function switchOrgAction(formData: FormData): Promise<void> {
  const locale = localeSchema.catch('en').parse(formData.get('locale'));
  const id = uuidSchema.safeParse(formData.get('orgId'));
  const { supabase, user } = await actionUser();
  if (!user || !id.success) redirect(`/${locale}`);
  const mine = (await listMyMemberships(supabase, user.id)).find((m) => m.org.id === id.data);
  if (!mine) redirect(`/${locale}/orgs`);
  const jar = await cookies();
  jar.set(ACTIVE_ORG_COOKIE, mine.org.id, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 90 });
  redirect(`/${locale}${homeFor(mine.org)}`);
}
