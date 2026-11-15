import type { ReactNode } from 'react';
import { requirePartnerContext } from '@/server/partner-context';

/**
 * Partner section gate. The menu (Home, Suppliers, Products, Import catalogue, Buyer requests, Notifications, Settings) is in the
 * workspace shell from ../layout.tsx. The gate here covers direct loads; every page below must still call requirePartnerContext itself.
 */
export default async function PartnerLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await requirePartnerContext(locale, id, '');
  return <>{children}</>;
}
