'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useSyncExternalStore } from 'react';
import { Link, usePathname } from '@/i18n/navigation';

const ITEMS = [
  { key: 'home', path: '' },
  { key: 'suppliers', path: '/suppliers' },
  { key: 'products', path: '/products' },
  { key: 'import', path: '/import' },
  { key: 'requests', path: '/requests' },
  { key: 'notifications', path: '/notifications' },
  { key: 'settings', path: '/settings' },
] as const;

const MOBILE = '(max-width: 720px)';
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(MOBILE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isMobile = () => window.matchMedia(MOBILE).matches;

/**
 * Partner section sidebar: Home, Suppliers, Products, Import Catalogue, Buyer Requests, Notifications, Settings.
 * Desktop: a column. Phone: collapses behind a "Menu" button (open without JavaScript, collapsed after hydration), no horizontal scroll.
 */
export default function PartnerNav({ orgId }: { orgId: string }) {
  const t = useTranslations('p5partner.nav');
  const pathname = usePathname();
  const listId = useId();
  // Server render and desktop: open. Phone: collapsed until the user opens it; choosing a page collapses it again.
  const mobile = useSyncExternalStore(subscribe, isMobile, () => false);
  const [choice, setChoice] = useState<{ path: string; open: boolean } | null>(null);
  const open = choice && choice.path === pathname ? choice.open : !mobile;
  const setOpen = (fn: (o: boolean) => boolean) => setChoice({ path: pathname, open: fn(open) });
  const base = `/orgs/${orgId}/partner`;

  return (
    <nav aria-label={t('label')} className="partner-nav">
      <button type="button" className="btn btn-secondary partner-nav-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
        {t('menu')}
      </button>
      <ul id={listId} className="partner-nav-list" hidden={!open}>
        {ITEMS.map(({ key, path }) => {
          const href = `${base}${path}`;
          const current = path === '' ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={key}>
              <Link href={href} aria-current={current ? 'page' : undefined}>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
