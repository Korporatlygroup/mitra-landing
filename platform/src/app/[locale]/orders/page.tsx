import { getFormatter, getTranslations } from 'next-intl/server';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import DealsTabs from '@/components/deals/DealsTabs';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { listOrders } from '@/server/services/deals';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'deals.ordersTitle');
}

/** My orders: the agreements made when quotations were accepted. Readable by the two organisations of each agreement only. */
export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, requireOrg: true, path: '/orders', requireMfaIfNeeded: false });
  const d = await getTranslations({ locale, namespace: 'deals' });
  const fmt = await getFormatter({ locale });
  const orders = await listOrders(s.supabase);
  return (
    <div className="wide">
      <PageHeader title={d('myDeals')} sub={d('ordersIntro')} />
      <DealsTabs locale={locale} active="orders" />
      {orders.length === 0 ? (
        <EmptyState icon="board" title={d('ordersTitle')} text={d('ordersEmpty')} action={{ href: '/enquiries', label: d('tabMessages') }} />
      ) : (
        <ul className="deal-orders">
          {orders.map((o) => (
            <li key={o.id} className="card">
              <Link href={`/orders/${o.id}`}><strong>{o.reference}</strong></Link>
              <span className="mut">{o.scope_text}</span>
              <span>{o.currency} {o.total}</span>
              <StatusBadge label={d(`os_${o.status}`)} tone={o.status === 'completed' ? 'green' : o.status === 'disputed' ? 'red' : o.status === 'cancelled' ? 'neutral' : 'gold'} />
              <time className="mut" dateTime={o.created_at}>{fmt.dateTime(new Date(o.created_at), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' })}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
