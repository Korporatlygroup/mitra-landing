import { redirect } from 'next/navigation';
import { getOptionalUser, myMembershipsOnce } from '@/server/session';

/**
 * Where every "List your business" button goes. It decides, on the server, from who is asking:
 *  - signed out              -> sign-up with the seller intent carried along (?intent=sell)
 *  - signed in, no business  -> the business organisation form, "sell" preselected (no second account)
 *  - signed in with business -> the list of their organisations (open one, or add another)
 * Nothing here trusts a URL parameter: the destinations are fixed paths.
 */
export default async function ListYourBusinessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { supabase, user } = await getOptionalUser();
  if (!supabase || !user) redirect(`/${locale}/signup?intent=sell`);
  const memberships = await myMembershipsOnce(supabase, user.id);
  const hasBusiness = memberships.some((m) => m.org.type === 'business');
  redirect(hasBusiness ? `/${locale}/orgs` : `/${locale}/orgs/new?purpose=sell`);
}
