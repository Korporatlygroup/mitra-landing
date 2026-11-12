import type { ReactNode } from 'react';
import PartnerNav from '@/components/PartnerNav';
import { requirePartnerContext } from '@/server/partner-context';

/**
 * Partner section shell: sidebar (Home, Suppliers, Products, Import Catalogue, Buyer Requests, Notifications, Settings) and content.
 * The gate here covers direct loads; every page below must still call requirePartnerContext itself.
 */
export default async function PartnerLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requirePartnerContext(locale, id, '');
  return (
    <div className="partner-shell">
      <aside className="partner-side">
        <p className="partner-org">{ctx.org.name}</p>
        <PartnerNav orgId={id} />
      </aside>
      <div className="partner-content">{children}</div>
    </div>
  );
}
