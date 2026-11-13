import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';

/**
 * Wraps every business-help page with the independence notice: INOK is not an agency and cannot apply for anyone.
 * Signed-in users see these pages inside their workspace; visitors see them on the public site.
 */
export default async function BusinessHelpLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'gov' });
  return (
    <WorkspaceShell locale={locale}>
      <div className="catalogue-wide">
        {children}
        <p className="muted gov-notice" role="note">
          {t('independent')}
        </p>
      </div>
    </WorkspaceShell>
  );
}
