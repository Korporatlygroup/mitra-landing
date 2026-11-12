import { getFormatter, getTranslations } from 'next-intl/server';
import { markNotificationReadAction } from '@/app/[locale]/notifications/actions';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';
import type { NotificationRow } from '@/server/services/verification';

const KNOWN_KINDS = new Set([
  'verification_approved',
  'verification_rejected',
  'verification_info_requested',
  'listing_approved',
  'listing_rejected',
  'listing_changes_requested',
  'listing_suspended',
  'listing_reinstated',
  'request_invited',
  'request_interested',
  'request_question',
  'request_declined',
  'request_removed',
  'enquiry_opened',
]);

const GOV_CATEGORIES = new Set(['new_match', 'opens', 'deadline', 'rule_change', 'unavailable', 'reminder']);

function targetFor(n: NotificationRow): string | null {
  if (n.entity_type === 'gov_programme') return '/business-help/saved';
  if (n.entity_type === 'verification_claim' && n.org_id) return `/orgs/${n.org_id}/business/verification`;
  if (n.entity_type === 'listing' && n.org_id) return `/orgs/${n.org_id}/business/listing`;
  if (n.entity_type === 'buyer_request' && n.entity_id) {
    return n.kind === 'request.invited' && n.org_id ? `/orgs/${n.org_id}/business/requests/${n.entity_id}` : `/requests/${n.entity_id}`;
  }
  if (n.entity_type === 'enquiry' && n.entity_id) return `/enquiries/${n.entity_id}`;
  return null;
}

/** Notification rows with a "Mark as read" action each (RPC mark_notification_read). */
export default async function NotificationList({ locale, items }: { locale: string; items: NotificationRow[] }) {
  const t = await getTranslations({ locale, namespace: 'notifications' });
  const tg = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  return (
    <ul className="card-list">
      {items.map((n) => {
        const key = n.kind.replace(/\./g, '_');
        const govCat = n.kind.startsWith('gov.') ? n.kind.slice(4) : null;
        const label = govCat && GOV_CATEGORIES.has(govCat) ? tg(`notif.${govCat}`) : t(`kinds.${KNOWN_KINDS.has(key) ? key : 'other'}`);
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
              {targetFor(n) ? (
                <Link href={targetFor(n) as string} locale={locale}>
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
