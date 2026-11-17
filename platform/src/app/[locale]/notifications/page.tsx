import { getTranslations } from 'next-intl/server';
import NotificationList from '@/components/NotificationList';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import TabsNav from '@/components/shared/TabsNav';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { listNotifications } from '@/server/services/verification';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'notifications.title');
}

export default async function NotificationsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const s = await requireSession({ locale, path: '/notifications', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale, namespace: 'notifications' });
  const all = await listNotifications(s.supabase, { limit: 50 });
  const unread = all.filter((n) => !n.read_at);
  const tab = sp.tab === 'unread' ? 'unread' : 'all';
  const items = tab === 'unread' ? unread : all;
  return (
    <>
      <PageHeader
        title={t('title')}
        sub={t('sub')}
        actions={
          <Link href="/account?section=notifications" className="btn btn-secondary">
            {t('prefs')}
          </Link>
        }
      />
      <TabsNav
        label={t('tabsLabel')}
        items={[
          { href: '/notifications', label: t('tAll'), count: all.length, active: tab === 'all' },
          { href: '/notifications?tab=unread', label: t('tUnread'), count: unread.length, active: tab === 'unread' },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState icon="bell" title={tab === 'unread' ? t('noneUnread') : t('none')} text={t('emptyText')} action={tab === 'unread' ? { href: '/notifications', label: t('tAll') } : undefined} />
      ) : (
        <NotificationList locale={locale} items={items} />
      )}
    </>
  );
}
