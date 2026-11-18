'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * Filters: always open on wide screens; on phones the form collapses behind one "Filters" button (a disclosure, not a modal),
 * so the products come first. The form stays in the DOM and is hidden with CSS only below 640px, so it works without JavaScript on desktop.
 */
export default function FilterSheet({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="fsheet" data-open={open ? 'true' : 'false'}>
      <button type="button" className="btn btn-secondary fsheet-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {label}
        {active ? <span className="chip-x brand" aria-hidden="true">•</span> : null}
      </button>
      <div id={id} className="fsheet-body">
        {children}
      </div>
    </div>
  );
}
