'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CAPTCHA_FIELD, TURNSTILE_ORIGIN } from '@/lib/turnstile';

interface TurnstileApi {
  render(el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void; 'error-callback': () => void; language?: string }): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('turnstile script failed')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** The security-check box. Fills a hidden field with a one-time token; the token is renewed after every submit. Must sit inside the form. */
export default function TurnstileWidget({ siteKey, language }: { siteKey: string; language?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | undefined>(undefined);
  const [token, setToken] = useState('');
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    let alive = true;
    loadScript().then(() => {
      if (!alive || !box.current || !window.turnstile || id.current) return;
      id.current = window.turnstile.render(box.current, { sitekey: siteKey, language: language ?? 'auto', callback: (t) => setToken(t), 'expired-callback': () => setToken(''), 'error-callback': () => setToken('') });
    }).catch(() => setToken(''));
    return () => { alive = false; if (id.current && window.turnstile) window.turnstile.remove(id.current); id.current = undefined; };
  }, [siteKey, language]);

  // a token works once: after each submit get a fresh one
  useEffect(() => {
    if (wasPending.current && !pending && id.current && window.turnstile) { setToken(''); window.turnstile.reset(id.current); }
    wasPending.current = pending;
  }, [pending]);

  return (
    <div className="turnstile" data-testid="turnstile">
      <div ref={box} />
      <input type="hidden" name={CAPTCHA_FIELD} value={token} readOnly />
    </div>
  );
}
