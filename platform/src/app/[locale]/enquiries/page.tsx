import { getTranslations } from 'next-intl/server';
import ConversationList from '@/components/messages/ConversationList';
import { pageTitle } from '@/lib/metadata';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'biz2.messages.title');
}

/** Messages: the list of conversations. Choosing one opens it in the right pane. */
export default async function MessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, path: '/enquiries', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale });
  const list = await ConversationList({ db: s.supabase, locale });
  return (
    <div className="wide">
      <div className="page-head">
        <div>
          <h1>{t('biz2.messages.title')}</h1>
          <p className="page-sub">{t('biz2.messages.sub')}</p>
        </div>
      </div>
      {list ? (
        <div className="msg-wrap">
          <div className="card msg-left">{list}</div>
          <div className="card msg-right msg-empty">
            <span className="mut">{t('biz2.messages.pick')}</span>
          </div>
        </div>
      ) : (
        <div className="empty">
          <strong>{t('biz2.messages.none')}</strong>
          <span className="mut">{t('biz2.messages.noneBody')}</span>
        </div>
      )}
    </div>
  );
}
