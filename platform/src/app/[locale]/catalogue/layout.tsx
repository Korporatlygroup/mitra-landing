import type { ReactNode } from 'react';
import { CompareTray } from '@/components/catalogue/CompareControls';

/** Wraps every catalogue page: a wider reading area and the compare tray (selection kept in this browser tab). */
export default function CatalogueLayout({ children }: { children: ReactNode }) {
  return (
    <div className="catalogue-wide">
      {children}
      <CompareTray />
    </div>
  );
}
