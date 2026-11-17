'use client';

import { useRef, useState, type ReactNode } from 'react';

/**
 * Search box above the conversation list. It only hides rows already on the page (each row carries its text in data-chat), so it needs no
 * request and loses nothing; the full list is back as soon as the box is cleared.
 */
export default function ConversationFilter({ label, noMatch, children }: { label: string; noMatch: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [none, setNone] = useState(false);
  const onInput = (value: string) => {
    const q = value.trim().toLowerCase();
    let shown = 0;
    ref.current?.querySelectorAll<HTMLElement>('[data-chat]').forEach((el) => {
      const hit = !q || (el.dataset.chat ?? '').toLowerCase().includes(q);
      el.hidden = !hit;
      if (hit) shown += 1;
    });
    setNone(shown === 0);
  };
  return (
    <div>
      <div className="search-x" style={{ margin: '4px 4px 8px', maxWidth: 'none' }}>
        <label className="sr" htmlFor="chat-q">
          {label}
        </label>
        <input id="chat-q" type="search" maxLength={80} placeholder={label} onInput={(e) => onInput(e.currentTarget.value)} />
      </div>
      <div ref={ref}>{children}</div>
      {none ? (
        <p className="mut" role="status" style={{ padding: '8px 12px', margin: 0, fontSize: '0.875rem' }}>
          {noMatch}
        </p>
      ) : null}
    </div>
  );
}
