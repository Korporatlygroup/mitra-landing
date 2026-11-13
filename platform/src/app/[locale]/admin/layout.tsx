import type { ReactNode } from 'react';
import AdminShell from '@/components/admin/AdminShell';

/** Every /admin page sits in the console shell (dark menu, queue counts) for MITRA staff. */
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AdminShell locale={locale}>{children}</AdminShell>;
}
