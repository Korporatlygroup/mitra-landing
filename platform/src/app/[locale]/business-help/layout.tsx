import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

/** Wraps every business-help page with the independence notice: INOK is not an agency and cannot apply for anyone. */
export default async function BusinessHelpLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'gov' });
  return (
    <div className="catalogue-wide">
      {children}
      <p className="muted gov-notice" role="note">
        {t('independent')}
      </p>
    </div>
  );
}
