import { getTranslations } from 'next-intl/server';
import ConversationList from '@/components/messages/ConversationList';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import DealsTabs from '@/components/deals/DealsTabs';
import { pageTitle } from '@/lib/metadata';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'biz2.messages.title');
}

/** Messages: the list of conversations. Choosing one opens it in the right pane. */
export default async function MessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, requireOrg: true, path: '/enquiries', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale });
  const d = await getTranslations({ locale, namespace: 'deals' });
  const list = await ConversationList({ db: s.supabase, locale });
  return (
    <div className="wide">
      <PageHeader title={d('myDeals')} sub={t('biz2.messages.sub')} />
      <DealsTabs locale={locale} active="conversations" />
      {list ? (
        <div className="msg-wrap">
          <div className="card msg-left">{list}</div>
          <div className="card msg-right msg-empty">
            <span className="mut">{t('biz2.messages.pick')}</span>
          </div>
        </div>
      ) : (
        <EmptyState icon="message" title={t('biz2.messages.none')} text={t('biz2.messages.noneBody')} action={{ href: '/directory', label: t('biz2.messages.explore') }} />
      )}
    </div>
  );
}
