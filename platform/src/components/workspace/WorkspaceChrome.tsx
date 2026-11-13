'use client';

import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { switchOrgAction } from '@/app/[locale]/orgs/actions';
import AccountMenu from '@/components/AccountMenu';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import Icon, { type IconName } from '@/components/ui/Icon';
import Logo from '@/components/ui/Logo';
import { usePopover } from '@/components/ui/Overlay';
import { Link, usePathname } from '@/i18n/navigation';

export interface MenuItem {
  key: string;
  href: string;
  icon: IconName;
  label: string;
  /** Path prefixes (locale-less) that mark this item as the current page. */
  match: string[];
  exact?: boolean;
  count?: number;
  countTone?: 'gold' | 'green';
}
export interface MenuGroup {
  key: string;
  label: string | null;
  items: MenuItem[];
}
export interface CreateItem {
  key: string;
  href: string;
  tag: string;
  tone: 'green' | 'gold' | 'blue';
  title: string;
  sub: string;
}
export interface BellItem {
  id: string;
  label: string;
  sub: string;
  href: string | null;
}
export interface ChromeProps {
  locale: string;
  initials: string;
  userName: string;
  orgName: string | null;
  orgInitials: string;
  orgSub: string;
  orgs: { id: string; name: string; sub: string }[];
  activeOrgId: string | null;
  groups: MenuGroup[];
  tabs: { key: string; href: string; icon: IconName; label: string }[];
  create: CreateItem[];
  unread: number;
  bell: BellItem[];
  searchAction: string | null;
  children: ReactNode;
}

const STORE = 'inok.ws.collapsed';

function Popover({ label, icon, dot, children, labelledCount }: { label: string; icon: IconName; dot?: boolean; children: (close: () => void) => ReactNode; labelledCount?: number }) {
  const [open, setOpen] = useState(false);
  const ref = usePopover(open, () => setOpen(false));
  return (
    <div className="pop-anchor" ref={ref}>
      <button type="button" className="ib" aria-label={label} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)} data-count={labelledCount}>
        <Icon name={icon} size={22} />
        {dot ? <span className="bell-dot" aria-hidden="true" /> : null}
      </button>
      {open ? <div className="pop">{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

export default function WorkspaceChrome(p: ChromeProps) {
  const t = useTranslations();
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = usePopover(createOpen, () => setCreateOpen(false));
  const orgRef = usePopover(orgOpen, () => setOrgOpen(false));

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORE) === '1');
    } catch {
      /* storage can be blocked; the menu stays open */
    }
  }, []);
  useEffect(() => {
    setMobileOpen(false);
  }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(STORE, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  const isOn = (i: { match: string[]; exact?: boolean; href: string }) => (i.exact ? path === i.href : i.match.some((m) => path === m || path.startsWith(`${m}/`)));

  // The onboarding wizard has its own focused header: no menu, no top bar.
  if (/^\/orgs\/[^/]+\/business\/onboarding(\/|$)/.test(path)) return <>{p.children}</>;

  return (
    <div className="ws-shell">
      <header className="ws-top">
        <div className="ws-top-inner">
          <button type="button" className="ib ws-menu-btn" aria-label={t('ws.openMenu')} aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
            <Icon name="menu" size={22} />
          </button>
          <button type="button" className="ib collapse-btn" aria-label={t('ws.collapse')} aria-pressed={collapsed} onClick={toggle}>
            <Icon name="panel" size={22} />
          </button>
          <Logo locale={p.locale} small label={t('ws.homeLabel')} />
          {p.searchAction ? (
            <form role="search" className="ws-search" action={p.searchAction} method="get">
              <Icon name="search" size={18} />
              <label className="sr" htmlFor="ws-q">
                {t('ws.search')}
              </label>
              <input id="ws-q" ref={searchRef} type="search" name="q" maxLength={80} placeholder={t('ws.searchPlaceholder')} />
              <span className="kbd" aria-hidden="true">
                /
              </span>
            </form>
          ) : (
            <span style={{ flex: 1 }} />
          )}
          <nav aria-label={t('ws.browse')} className="ws-links">
            <Link className="btn btn-ghost btn-sm" href="/directory">
              {t('ws.directory')}
            </Link>
            <Link className="btn btn-ghost btn-sm" href="/catalogue">
              {t('p5common.nav.catalogue')}
            </Link>
          </nav>
          <div className="ws-top-actions">
            {p.create.length > 0 ? (
              <div className="pop-anchor" ref={createRef}>
                <button type="button" className="btn btn-gold btn-sm" aria-expanded={createOpen} aria-haspopup="true" onClick={() => setCreateOpen((v) => !v)}>
                  <Icon name="plus" size={18} stroke={2.2} />
                  {t('ws.create')}
                </button>
                {createOpen ? (
                  <div className="pop" style={{ width: 260 }}>
                    {p.create.map((c) => (
                      <Link key={c.key} href={c.href} className="pi" onClick={() => setCreateOpen(false)}>
                        <span className={`tag t-${c.tone}`}>{c.tag}</span>
                        <span>
                          <strong>{c.title}</strong>
                          <span className="mut">{c.sub}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <Popover label={p.unread > 0 ? t('ws.notifBell', { n: p.unread }) : t('ws.notifBellNone')} icon="bell" dot={p.unread > 0}>
              {(close) => (
                <>
                  <div className="pop-head">
                    <strong>{t('ws.notifications')}</strong>
                    <span className="mut" style={{ fontSize: '0.8125rem' }}>
                      {p.unread > 0 ? t('ws.notifCount', { n: p.unread }) : t('ws.notifNone')}
                    </span>
                  </div>
                  {p.bell.map((b) =>
                    b.href ? (
                      <Link key={b.id} href={b.href} className="pi" onClick={close}>
                        <span className="av" style={{ width: 36, height: 36, background: 'var(--tag-coral-bg)', color: 'var(--tag-coral)' }}>
                          !
                        </span>
                        <span>
                          <strong>{b.label}</strong>
                          <span className="mut">{b.sub}</span>
                        </span>
                      </Link>
                    ) : (
                      <div key={b.id} className="pi">
                        <span>
                          <strong>{b.label}</strong>
                          <span className="mut">{b.sub}</span>
                        </span>
                      </div>
                    ),
                  )}
                  <Link href="/notifications" className="pi" onClick={close} style={{ justifyContent: 'center', color: 'var(--brand)', fontWeight: 700 }}>
                    {t('ws.seeAll')}
                  </Link>
                </>
              )}
            </Popover>
            <AccountMenu initials={p.initials} name={p.userName} language={<Suspense fallback={null}><LocaleSwitcher /></Suspense>} />
          </div>
        </div>
      </header>

      <div className="ws-body">
        {mobileOpen ? <button type="button" className="scrim" aria-label={t('ws.close')} tabIndex={-1} onClick={() => setMobileOpen(false)} /> : null}
        <aside className={`ws-side${collapsed ? ' mini' : ''}${mobileOpen ? ' open' : ''}`} aria-label={t('ws.workspace')}>
          {p.orgName ? (
            <div className="pop-anchor" ref={orgRef}>
              <button type="button" className="sl org-btn" aria-expanded={orgOpen} aria-haspopup="true" onClick={() => setOrgOpen((v) => !v)}>
                <span className="org-init" aria-hidden="true">
                  {p.orgInitials}
                </span>
                <span className="orgtxt" style={{ flex: 1, minWidth: 0 }}>
                  <strong>{p.orgName}</strong>
                  <small>{p.orgSub}</small>
                </span>
                {p.orgs.length > 1 ? <Icon name="chevron" size={16} /> : null}
              </button>
              {orgOpen ? (
                <div className="org-menu">
                  {p.orgs.map((o) => (
                    <form key={o.id} action={switchOrgAction}>
                      <input type="hidden" name="orgId" value={o.id} />
                      <input type="hidden" name="locale" value={p.locale} />
                      <button type="submit" className="pi" aria-current={o.id === p.activeOrgId ? 'true' : undefined}>
                        <span>
                          <strong>{o.name}</strong>
                          <span className="mut">{o.sub}</span>
                        </span>
                      </button>
                    </form>
                  ))}
                  <Link href="/orgs/new" className="pi" onClick={() => setOrgOpen(false)} style={{ color: 'var(--brand)', fontWeight: 700 }}>
                    <Icon name="plus" size={18} />
                    <span>{t('orgs.create')}</span>
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <Link href="/orgs/new" className="sl org-btn">
              <span className="org-init" aria-hidden="true">
                <Icon name="plus" size={18} />
              </span>
              <span className="orgtxt" style={{ flex: 1 }}>
                <strong>{t('orgs.create')}</strong>
              </span>
            </Link>
          )}
          <nav aria-label={t('ws.workspace')} style={{ display: 'contents' }}>
            {p.groups.map((g) => (
              <div key={g.key} style={{ display: 'contents' }}>
                {g.label ? <p className="sg">{g.label}</p> : null}
                {g.items.map((i) => (
                  <Link key={i.key} href={i.href} className="sl" aria-current={isOn(i) ? 'page' : undefined} title={collapsed ? i.label : undefined} aria-label={collapsed ? i.label : undefined}>
                    <Icon name={i.icon} size={20} />
                    <span className="lab">{i.label}</span>
                    {i.count ? <span className={`cnt${i.countTone === 'green' ? ' cnt-green' : ''}`}>{i.count}</span> : null}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="ws-main" id="ws-content">
          {p.children}
        </div>
      </div>

      <nav className="tabbar" aria-label={t('ws.tabs')}>
        {p.tabs.map((i) => (
          <Link key={i.key} href={i.href} aria-current={path === i.href || (i.href.length > 12 && path.startsWith(`${i.href}/`)) ? 'page' : undefined}>
            <Icon name={i.icon} size={20} />
            {i.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMobileOpen(true)}>
          <Icon name="menu" size={20} />
          {t('ws.tabMore')}
        </button>
      </nav>
    </div>
  );
}
