import { getTranslations } from 'next-intl/server';
import DealsTabs from '@/components/deals/DealsTabs';
import RecentActivity from '@/components/deals/RecentActivity';
import PageHeader from '@/components/shared/PageHeader';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'deals.myDeals');
}

/**
 * My deals: one place that explains the four things people have with INOK and shows how many of each they have.
 * Counts and the activity list come straight from stored records (conversations, requests, orders, quotation and order events).
 * There are deliberately no unread or waiting-for-reply counts: INOK does not record read state, so none is shown.
 */
export default async function DealsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, requireOrg: true, path: '/deals', requireMfaIfNeeded: false });
  const d = await getTranslations({ locale, namespace: 'deals' });
  const db = s.supabase;
  const [enq, req, ord] = await Promise.all([
    db.from('enquiries').select('id', { count: 'exact', head: true }),
    db.from('buyer_requests').select('id', { count: 'exact', head: true }),
    db.from('orders').select('id', { count: 'exact', head: true }),
  ]);
  const cards = [
    { key: 'conv', href: '/enquiries', title: d('tabMessages'), text: d('whatConversations'), n: enq.count ?? 0 },
    { key: 'req', href: '/requests', title: d('tabRequests'), text: d('whatRequests'), n: req.count ?? 0 },
    { key: 'whole', href: '/sourcing', title: d('tabWholesale'), text: d('whatWholesale'), n: null as number | null },
    { key: 'ord', href: '/orders', title: d('tabOrders'), text: d('whatOrders'), n: ord.count ?? 0 },
  ];
  return (
    <div className="wide">
      <PageHeader title={d('myDeals')} sub={d('dealsIntro')} />
      <DealsTabs locale={locale} active="overview" />
      <div className="xgrid xgrid-4 deals-cards">
        {cards.map((c) => (
          <Link key={c.key} href={c.href} className="card deals-card">
            <strong>{c.title}</strong>
            {c.n !== null ? <span className="deals-n">{c.n}</span> : null}
            <span className="mut">{c.text}</span>
          </Link>
        ))}
      </div>
      <section aria-labelledby="deals-act" className="card">
        <h2 id="deals-act" style={{ marginTop: 0 }}>{d('latestActivity')}</h2>
        <RecentActivity db={db} locale={locale} />
        <p className="mut" style={{ marginBottom: 0 }}>{d('savedProductsHint')} <Link href="/catalogue/saved">{d('savedProducts')}</Link></p>
      </section>
    </div>
  );
}
