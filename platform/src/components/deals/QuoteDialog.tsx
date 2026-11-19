'use client';

import { useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/Overlay';

/** Opens the quotation editor (a server-rendered form passed as children) in a focused dialog, so it never fills the chat. */
export default function QuoteDialog({ buttonLabel, title, hint, closeLabel, children }: { buttonLabel: string; title: string; hint: string; closeLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} closeLabel={closeLabel}>
        <p className="mut">{hint}</p>
        {children}
      </Dialog>
    </>
  );
}
