import { getFormatter, getTranslations } from 'next-intl/server';
import { markNotificationReadAction } from '@/app/[locale]/notifications/actions';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';
import { notificationLabelKey, notificationTarget } from '@/lib/notification-ui';
import type { NotificationRow } from '@/server/services/verification';

/** Notification rows with a "Mark as read" action each (RPC mark_notification_read). */
export default async function NotificationList({ locale, items }: { locale: string; items: NotificationRow[] }) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  return (
    <ul className="card-list">
      {items.map((n) => {
        const label = t(notificationLabelKey(n.kind));
        const target = notificationTarget(n);
        return (
          <li key={n.id} className="card">
            <p style={{ margin: 0 }}>
              {n.read_at ? null : <strong>{t('notifications.new')}: </strong>}
              {label}
            </p>
            <p className="muted" style={{ margin: '0 0 8px' }}>
              {fmt.dateTime(new Date(n.created_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
            </p>
            <div className="link-row">
              {target ? (
                <Link href={target} locale={locale}>
                  {t('notifications.open')}
                </Link>
              ) : null}
            </div>
            {n.read_at ? null : (
              <ActionForm action={markNotificationReadAction} submitLabel={t('notifications.markRead')} variant="secondary" className="inline-form">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="id" value={n.id} />
              </ActionForm>
            )}
          </li>
        );
      })}
    </ul>
  );
}
