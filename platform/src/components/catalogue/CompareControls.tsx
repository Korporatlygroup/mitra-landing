'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { useCompareSelection, type CompareEntry } from './compare-store';
import { compareHref, COMPARE_LIMIT } from './helpers';

/** "Compare" checkbox on a product card or detail page. Keeps the selection across pages (see compare-store). */
export function CompareToggle({ id, name }: { id: string; name: string }) {
  const t = useTranslations('p5buyer.compare');
  const { entries, toggle } = useCompareSelection();
  const [full, setFull] = useState(false);
  const checked = entries.some((e) => e.id === id);
  return (
    <div className="field check catalogue-compare-toggle">
      <input
        id={`cmp-${id}`}
        type="checkbox"
        checked={checked}
        aria-describedby={full ? `cmp-full-${id}` : undefined}
        onChange={() => setFull(toggle({ id, name }) === 'full')}
      />
      <label htmlFor={`cmp-${id}`}>
        {t('add')}
        <span className="p5b-sr">: {name}</span>
      </label>
      {full ? (
        <p id={`cmp-full-${id}`} className="hint" role="status">
          {t('full', { max: COMPARE_LIMIT })}
        </p>
      ) : null}
    </div>
  );
}

/** The bar at the bottom of the catalogue pages: what is selected, remove one, clear, open the comparison. */
export function CompareTray() {
  const t = useTranslations('p5buyer.compare');
  const { entries, remove, clear } = useCompareSelection();
  const pathname = usePathname();
  // not on the comparison page itself, and not on the request form (the bar would cover the submit button on a phone)
  if (entries.length === 0 || /^\/catalogue\/compare\/?$/.test(pathname) || /^\/catalogue\/[^/]+\/request\/?$/.test(pathname)) return null;
  const ids = entries.map((e) => e.id);
  return (
    <aside className="compare-tray" aria-label={t('trayLabel')}>
      <p className="compare-tray-title">{t('selected', { n: entries.length, max: COMPARE_LIMIT })}</p>
      <ul className="compare-tray-list">
        {entries.map((e) => (
          <li key={e.id}>
            <span className="compare-tray-name">{e.name}</span>
            <button type="button" className="btn btn-link" onClick={() => remove(e.id)} aria-label={t('removeOne', { name: e.name })}>
              {t('remove')}
            </button>
          </li>
        ))}
      </ul>
      <div className="compare-tray-actions">
        {entries.length >= 2 ? (
          <Link href={compareHref(ids)} className="btn btn-primary">
            {t('open')}
          </Link>
        ) : (
          <p className="hint">{t('needTwo')}</p>
        )}
        <button type="button" className="btn btn-secondary" onClick={clear}>
          {t('clear')}
        </button>
      </div>
    </aside>
  );
}

/** On the compare page: makes the tray selection match the comparison that is open (so going back keeps what you compared). */
export function CompareSync({ entries }: { entries: CompareEntry[] }) {
  const { replace } = useCompareSelection();
  const key = entries.map((e) => `${e.id}:${e.name}`).join('|');
  useEffect(() => {
    replace(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
