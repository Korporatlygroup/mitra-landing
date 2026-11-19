'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';

const QUERY = '(min-width: 1280px)';
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

/** Collapsible right-hand panel of the conversation. Open by default on wide screens, closed on phones; the button overrides either. */
export default function DetailsPanel({ showLabel, hideLabel, children }: { showLabel: string; hideLabel: string; children: ReactNode }) {
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? wide;
  return (
    <aside className={`deal-panel${open ? ' is-open' : ''}`}>
      <button type="button" className="btn btn-secondary btn-sm deal-panel-toggle" aria-expanded={open} aria-controls="deal-panel-body" onClick={() => setManual(!open)}>
        {open ? hideLabel : showLabel}
      </button>
      <div id="deal-panel-body" className="deal-panel-body" hidden={!open}>
        {children}
      </div>
    </aside>
  );
}
