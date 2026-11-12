import { getTranslations } from 'next-intl/server';
import NotificationList from '@/components/NotificationList';
import { pageTitle } from '@/lib/metadata';
import { listNotifications } from '@/server/services/verification';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'notifications.title');
}

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, path: '/notifications', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale, namespace: 'notifications' });
  const items = await listNotifications(s.supabase, { limit: 50 });
  return (
    <>
      <h1>{t('title')}</h1>
      {items.length === 0 ? <p>{t('none')}</p> : <NotificationList locale={locale} items={items} />}
    </>
  );
}
