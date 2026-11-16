import type { ReactNode } from 'react';
import ScopedMessages from '@/components/ScopedMessages';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';

/** Signed-in pages live inside the workspace shell (top bar and side menu); signed-out visitors see the page as it is. */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ScopedMessages area="notifications" locale={locale}>
      <WorkspaceShell locale={locale}>{children}</WorkspaceShell>
    </ScopedMessages>
  );
}
