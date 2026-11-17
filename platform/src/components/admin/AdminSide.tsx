'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * The admin console menu. From 900px it is the usual side column. On phones only the brand and a Menu button show, so the work comes
 * first and the menu opens on request (a disclosure; the links stay in the DOM).
 */
export default function AdminSide({ label, menuLabel, head, children }: { label: string; menuLabel: string; head: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <aside className="ad-side" aria-label={label} data-open={open ? 'true' : 'false'}>
      <div className="ad-headrow">
        {head}
        <button type="button" className="ad-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          {menuLabel}
        </button>
      </div>
      <div id={id} className="ad-collapsible">
        {children}
      </div>
    </aside>
  );
}
