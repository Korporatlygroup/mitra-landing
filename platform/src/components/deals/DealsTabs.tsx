import { getTranslations } from 'next-intl/server';
import TabsNav from '@/components/shared/TabsNav';

export type DealsTab = 'overview' | 'conversations' | 'requests' | 'wholesale' | 'orders';

/**
 * The one set of tabs shown on every "My deals" page, so messages, quotations, requests and orders read as one workspace.
 * Each tab keeps its own existing page and workflow; only the entry and the explanation are shared.
 */
export default async function DealsTabs({ locale, active }: { locale: string; active: DealsTab }) {
  const d = await getTranslations({ locale, namespace: 'deals' });
  const items: { key: DealsTab; href: string; label: string }[] = [
    { key: 'overview', href: '/deals', label: d('tabOverview') },
    { key: 'conversations', href: '/enquiries', label: d('tabMessages') },
    { key: 'requests', href: '/requests', label: d('tabRequests') },
    { key: 'wholesale', href: '/sourcing', label: d('tabWholesale') },
    { key: 'orders', href: '/orders', label: d('tabOrders') },
  ];
  return <TabsNav label={d('myDeals')} items={items.map((i) => ({ href: i.href, label: i.label, active: i.key === active }))} />;
}
