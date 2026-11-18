import { getFormatter, getTranslations } from 'next-intl/server';
import { markNotificationReadAction } from '@/app/[locale]/notifications/actions';
import ActionForm from '@/components/ActionForm';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { notificationLabelKey, notificationTarget } from '@/lib/notification-ui';
import type { NotificationRow } from '@/server/services/verification';

const MYT = 'Asia/Kuala_Lumpur';
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: MYT });

/** Notification rows grouped as Today / Earlier, each with its time, a link to where it happened and a "Mark as read" action (RPC mark_notification_read). */
export default async function NotificationList({ locale, items }: { locale: string; items: NotificationRow[] }) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const today = dayKey(new Date());
  const groups = [
    { key: 'today', rows: items.filter((n) => dayKey(new Date(n.created_at)) === today) },
    { key: 'earlier', rows: items.filter((n) => dayKey(new Date(n.created_at)) !== today) },
  ].filter((g) => g.rows.length > 0);
  return (
    <div className="stack-x" style={{ gap: 20 }}>
      {groups.map((g) => (
        <section key={g.key} aria-label={t(`notifications.${g.key}`)}>
          <h2 className="nlist-h">{t(`notifications.${g.key}`)}</h2>
          <ul className="nlist">
            {g.rows.map((n) => {
              const label = t(notificationLabelKey(n.kind));
              const target = notificationTarget(n);
              return (
                <li key={n.id} className={`nrow${n.read_at ? '' : ' unread'}`}>
                  <span className="nrow-ico" aria-hidden="true">
                    <Icon name="bell" size={18} />
                  </span>
                  <div className="nrow-body">
                    <p className="nrow-title">
                      {n.read_at ? null : <span className="chip-x brand">{t('notifications.new')}</span>} {label}
                    </p>
                    <p className="nrow-time">{fmt.dateTime(new Date(n.created_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: MYT })}</p>
                  </div>
                  <div className="nrow-actions">
                    {target ? (
                      <Link href={target} locale={locale} className="btn btn-secondary btn-sm">
                        {t('notifications.open')}
                      </Link>
                    ) : null}
                    {n.read_at ? null : (
                      <ActionForm action={markNotificationReadAction} submitLabel={t('notifications.markRead')} variant="secondary" className="inline-form">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="id" value={n.id} />
                      </ActionForm>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
