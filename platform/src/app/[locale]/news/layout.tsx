import type { ReactNode } from 'react';
import ScopedMessages from '@/components/ScopedMessages';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';

export default async function NewsLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ScopedMessages area="news" locale={locale}>
      <WorkspaceShell locale={locale}>
        {children}
      </WorkspaceShell>
    </ScopedMessages>
  );
}
