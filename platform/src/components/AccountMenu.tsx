'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { signOutAction } from '@/app/[locale]/account/actions';
import { Link } from '@/i18n/navigation';
import Icon from './ui/Icon';
import { usePopover } from './ui/Overlay';

/** Avatar button that opens the account menu: account, organisations, messages, sign out. Used in the public bar and the workspace bar. */
export default function AccountMenu({ initials, name, language }: { initials: string; name?: string; language?: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = usePopover(open, () => setOpen(false));
  return (
    <div className="pop-anchor" ref={ref}>
      <button type="button" className="ib" style={{ width: 'auto', padding: '0 4px' }} aria-label={t('ws.accountMenu')} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <span className="av" style={{ width: 38, height: 38 }} data-i={initials} aria-hidden="true" />
      </button>
      {open ? (
        <div className="pop" style={{ width: 260 }} role="menu">
          {name ? (
            <div className="pop-head">
              <strong>{name}</strong>
            </div>
          ) : null}
          {language ? <div style={{ padding: "4px 12px 8px" }}>{language}</div> : null}
          <Link role="menuitem" className="pi" href="/account" onClick={() => setOpen(false)}>
            <Icon name="users" size={18} />
            <span>{t('nav.account')}</span>
          </Link>
          <Link role="menuitem" className="pi" href="/orgs" onClick={() => setOpen(false)}>
            <Icon name="store" size={18} />
            <span>{t('nav.organisations')}</span>
          </Link>
          <Link role="menuitem" className="pi" href="/notifications" onClick={() => setOpen(false)}>
            <Icon name="bell" size={18} />
            <span>{t('nav.notifications')}</span>
          </Link>
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" role="menuitem" className="pi">
              <Icon name="logout" size={18} />
              <span>{t('nav.signOut')}</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
