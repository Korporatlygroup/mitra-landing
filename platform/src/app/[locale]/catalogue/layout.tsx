import type { ReactNode } from 'react';
import { CompareTray } from '@/components/catalogue/CompareControls';
import ScopedMessages from '@/components/ScopedMessages';

/** Wraps every catalogue page: a wider reading area and the compare tray (selection kept in this browser tab). */
export default async function CatalogueLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ScopedMessages area="catalogue" locale={locale}>
      <div className="catalogue-wide">
        {children}
        <CompareTray />
      </div>
    </ScopedMessages>
  );
}
