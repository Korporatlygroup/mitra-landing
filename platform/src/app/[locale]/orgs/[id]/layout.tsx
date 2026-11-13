import type { ReactNode } from 'react';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';

/** Signed-in pages live inside the workspace shell (top bar and side menu); signed-out visitors see the page as it is. */
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  return (
    <WorkspaceShell locale={locale} orgId={id}>
      {children}
    </WorkspaceShell>
  );
}
