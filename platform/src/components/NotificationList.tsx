import { getFormatter, getTranslations } from 'next-intl/server';
import { markNotificationReadAction } from '@/app/[locale]/notifications/actions';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';
import type { NotificationRow } from '@/server/services/verification';

const KNOWN_KINDS = new Set(['verification_approved', 'verification_rejected', 'verification_info_requested']);

/** Notification rows with a "Mark as read" action each (RPC mark_notification_read). */
export default async function NotificationList({ locale, items }: { locale: string; items: NotificationRow[] }) {
  const t = await getTranslations({ locale, namespace: 'notifications' });
  const fmt = await getFormatter({ locale });
  return (
    <ul className="card-list">
      {items.map((n) => {
        const key = n.kind.replace(/\./g, '_');
        const label = t(`kinds.${KNOWN_KINDS.has(key) ? key : 'other'}`);
        return (
          <li key={n.id} className="card">
            <p style={{ margin: 0 }}>
              {n.read_at ? null : <strong>{t('new')}: </strong>}
              {label}
            </p>
            <p className="muted" style={{ margin: '0 0 8px' }}>
              {fmt.dateTime(new Date(n.created_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
            </p>
            <div className="link-row">
              {n.org_id && n.entity_type === 'verification_claim' ? (
                <Link href={`/orgs/${n.org_id}/business/verification`} locale={locale}>
                  {t('open')}
                </Link>
              ) : null}
            </div>
            {n.read_at ? null : (
              <ActionForm action={markNotificationReadAction} submitLabel={t('markRead')} variant="secondary" className="inline-form">
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
