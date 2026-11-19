import { getTranslations } from 'next-intl/server';
import TabsNav from '@/components/shared/TabsNav';

export type CustomersTab = 'requests' | 'board' | 'results';

/** Tabs shared by the three seller pages under "Find customers". Each tab keeps its own existing page. */
export default async function FindCustomersTabs({ locale, orgId, active }: { locale: string; orgId: string; active: CustomersTab }) {
  const d = await getTranslations({ locale, namespace: 'deals' });
  const base = `/orgs/${orgId}/business`;
  const items: { key: CustomersTab; href: string; label: string }[] = [
    { key: 'requests', href: `${base}/requests`, label: d('tabCustomerRequests') },
    { key: 'board', href: `${base}/requests/board`, label: d('tabBoard') },
    { key: 'results', href: `${base}/leads`, label: d('tabResults') },
  ];
  return <TabsNav label={d('findCustomers')} items={items.map((i) => ({ href: i.href, label: i.label, active: i.key === active }))} />;
}
