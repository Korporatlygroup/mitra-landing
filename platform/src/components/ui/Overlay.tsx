'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Shared behaviour of drawers and dialogs: move focus in, trap Tab, close on Esc, give focus back to the trigger. */
function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      trigger?.focus?.();
    };
  }, [open]);
  return ref;
}

export function Drawer({ open, onClose, title, closeLabel, children, wide }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode; wide?: boolean }) {
  const ref = useOverlay(open, onClose);
  const id = useId();
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <>
      <button type="button" className="scrim" aria-label={closeLabel} tabIndex={-1} onClick={onClose} />
      <div ref={ref} className={`drawer${wide ? ' drawer-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="drawer-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="ib" aria-label={closeLabel} onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}

export function Dialog({ open, onClose, title, closeLabel, children }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode }) {
  const ref = useOverlay(open, onClose);
  const id = useId();
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal">
      <button type="button" className="modal-scrim" aria-label={closeLabel} tabIndex={-1} onClick={onClose} />
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="drawer-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="ib" aria-label={closeLabel} onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Closes a popover on Esc or a click outside it; the trigger keeps focus. */
export function usePopover(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return ref;
}

/** Accessible on/off switch. Mirrors its state into a hidden input when `name` is given, so it works inside a form. */
export function Switch({ checked, onChange, label, name, disabled }: { checked: boolean; onChange?: (v: boolean) => void; label: string; name?: string; disabled?: boolean }) {
  return (
    <>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="sw" disabled={disabled} onClick={() => onChange?.(!checked)} />
      {name ? <input type="hidden" name={name} value={checked ? 'on' : ''} /> : null}
    </>
  );
}
