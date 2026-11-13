import { getTranslations } from 'next-intl/server';
import PartnerNotifications from '@/components/partner/PartnerNotifications';
import { pageTitle } from '@/lib/metadata';
import { requirePartnerContext } from '@/server/partner-context';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.nav.notifications');
}

export default async function PartnerNotificationsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requirePartnerContext(locale, id, '/notifications');
  const t = await getTranslations({ locale, namespace: 'p5partner.notifications' });
  const { data } = await ctx.session.supabase
    .from('notifications')
    .select('id, org_id, kind, entity_type, entity_id, created_at, read_at')
    .eq('org_id', id)
    .order('created_at', { ascending: false })
    .limit(50);
  const items = (data ?? []) as { id: string; org_id: string | null; kind: string; entity_type: string | null; entity_id: string | null; created_at: string; read_at: string | null }[];
  return (
    <>
      <h1>{t('title')}</h1>
      {items.length === 0 ? <p>{t('none')}</p> : <PartnerNotifications locale={locale} orgId={id} items={items} />}
    </>
  );
}
