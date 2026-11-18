'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

/** A horizontally scrolling row (tabs, section links). The edge that has more to scroll to fades out (data-more), so a strip that
 * does not fit never looks cut off by mistake. The current item is scrolled into view on load. */
export default function ScrollStrip({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth > 2;
    el.dataset.more = !overflow ? 'none' : el.scrollLeft <= 2 ? 'end' : el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 ? 'start' : 'both';
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const current = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);
  return (
    <nav ref={ref} className={className} aria-label={label} onScroll={update}>
      {children}
    </nav>
  );
}
