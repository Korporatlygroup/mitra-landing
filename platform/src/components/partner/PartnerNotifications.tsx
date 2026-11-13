import { getFormatter, getTranslations } from 'next-intl/server';
import { markNotificationReadAction } from '@/app/[locale]/notifications/actions';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';

interface Item {
  id: string;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  read_at: string | null;
}

const KINDS = new Set([
  'partner_decided',
  'supplier_decided',
  'supplier_suspended',
  'product_decided',
  'product_suspended',
  'sourcing_received',
  'sourcing_reply',
  'sourcing_withdrawn',
  'sourcing_closed',
]);

function target(orgId: string, n: Item): string | null {
  const base = `/orgs/${orgId}/partner`;
  if (n.entity_type === 'supplier' && n.entity_id) return `${base}/suppliers/${n.entity_id}`;
  if (n.entity_type === 'product' && n.entity_id) return `${base}/products/${n.entity_id}`;
  if (n.entity_type === 'sourcing_request' && n.entity_id) return `${base}/requests/${n.entity_id}`;
  if (n.entity_type === 'organisation') return `${base}/settings`;
  return null;
}

/** Partner notifications: plain-language labels per kind and a direct link to the item. Each unread one can be marked as read. */
export default async function PartnerNotifications({ locale, orgId, items }: { locale: string; orgId: string; items: Item[] }) {
  const t = await getTranslations({ locale, namespace: 'p5partner.notifications' });
  const fmt = await getFormatter({ locale });
  return (
    <ul className="card-list">
      {items.map((n) => {
        const key = n.kind.replace(/\./g, '_');
        const href = target(orgId, n);
        return (
          <li key={n.id} className="card" data-testid="notification">
            <p style={{ margin: 0 }}>
              {n.read_at ? null : <strong>{t('new')}: </strong>}
              {t(`kinds.${KINDS.has(key) ? key : 'other'}`)}
            </p>
            <p className="muted" style={{ margin: '0 0 8px' }}>
              {fmt.dateTime(new Date(n.created_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
            </p>
            <div className="link-row">
              {href ? (
                <Link href={href} locale={locale} className="btn btn-secondary">
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
