import type { ReactNode } from 'react';
import ScopedMessages from '@/components/ScopedMessages';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';

/** Help and complaints is reachable from the side menu, so signed-in people keep the menu here too; visitors see the page as it is. */
export default async function ComplaintsLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ScopedMessages area="complaints" locale={locale}>
      <WorkspaceShell locale={locale}>{children}</WorkspaceShell>
    </ScopedMessages>
  );
}
