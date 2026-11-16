import type { ReactNode } from 'react';
import ScopedMessages from '@/components/ScopedMessages';

export default async function OrgsLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ScopedMessages area="orgs" locale={locale}>
      {children}
    </ScopedMessages>
  );
}
