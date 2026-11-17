import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { initialsOf } from '@/components/ui/Tag';
import { notificationLabelKey, notificationTarget } from '@/lib/notification-ui';
import { getWorkspace } from '@/server/workspace';
import WorkspaceChrome, { type BellItem, type CreateItem, type MenuGroup } from './WorkspaceChrome';

/**
 * The signed-in shell: top bar, side menu (business, partner or buyer), content area. For a signed-out visitor it renders the page as it is,
 * so the page's own sign-in redirect still runs with the right `next` address.
 */
export default async function WorkspaceShell({ locale, orgId, children }: { locale: string; orgId?: string; children: ReactNode }) {
  const ws = await getWorkspace(orgId);
  if (!ws) return <>{children}</>;
  const t = await getTranslations({ locale });
  const id = ws.org?.id;
  const m = (k: string) => t(`ws.menu.${k}`);
  const base = id ? `/orgs/${id}` : '';

  let groups: MenuGroup[];
  let tabs: { key: string; href: string; icon: 'home' | 'board' | 'message' | 'box' | 'store'; label: string }[];
  let create: CreateItem[];
  let searchAction: string | null = null;

  if (ws.kind === 'business' && id) {
    groups = [
      { key: 'top', label: null, items: [{ key: 'home', href: `${base}/business`, icon: 'home', label: m('home'), match: [], exact: true }] },
      {
        key: 'customers',
        label: m('customers'),
        items: [
          { key: 'requests', href: `${base}/business/requests`, icon: 'board', label: m('requests'), match: [`${base}/business/requests`, `${base}/business/leads`], count: ws.newRequests || undefined },
          { key: 'messages', href: '/enquiries', icon: 'message', label: m('messages'), match: ['/enquiries'] },
        ],
      },
      // One account can also BUY: a business organisation may post requests and send enquiries (the database allows request:post for it).
      { key: 'buying', label: m('buying'), items: [{ key: 'myRequests', href: '/requests', icon: 'board', label: m('myRequests'), match: ['/requests'] }] },
      {
        key: 'business',
        label: m('business'),
        items: [
          { key: 'products', href: `${base}/business/products`, icon: 'box', label: m('products'), match: [`${base}/business/products`] },
          { key: 'listing', href: `${base}/business/listing`, icon: 'store', label: m('listing'), match: [`${base}/business/listing`, `${base}/business/preview`] },
          ...(ws.canReadVerification
            ? [{ key: 'verification', href: `${base}/business/verification`, icon: 'shield' as const, label: m('verification'), match: [`${base}/business/verification`] }]
            : []),
        ],
      },
      {
        key: 'grow',
        label: m('grow'),
        items: [
          { key: 'gov', href: '/business-help', icon: 'target', label: m('govHelp'), match: ['/business-help'] },
          { key: 'news', href: '/news', icon: 'news', label: m('news'), match: ['/news'] },
        ],
      },
      {
        key: 'more',
        label: null,
        items: [
          { key: 'team', href: `${base}/members`, icon: 'users', label: m('team'), match: [`${base}/members`] },
          { key: 'account', href: '/account', icon: 'settings', label: m('settings'), match: ['/account'] },
        ],
      },
    ];
    tabs = [
      { key: 'home', href: `${base}/business`, icon: 'home', label: t('ws.tabHome') },
      { key: 'leads', href: `${base}/business/requests`, icon: 'board', label: t('ws.tabLeads') },
      { key: 'msg', href: '/enquiries', icon: 'message', label: t('ws.tabMessages') },
      { key: 'products', href: `${base}/business/products`, icon: 'box', label: t('ws.tabProducts') },
    ];
    create = [
      { key: 'product', href: `${base}/business/products?new=1`, tag: t('ws.newTag'), tone: 'green', title: t('ws.createProduct'), sub: t('ws.createProductSub') },
      { key: 'quote', href: `${base}/business/requests`, tag: t('ws.newTag'), tone: 'gold', title: t('ws.createQuote'), sub: t('ws.createQuoteSub') },
      { key: 'message', href: '/enquiries', tag: t('ws.newTag'), tone: 'blue', title: t('ws.createMessage'), sub: t('ws.createMessageSub') },
      { key: 'request', href: '/requests/new', tag: t('ws.newTag'), tone: 'gold', title: m('post'), sub: t('dir2.canTFindSub') },
    ];
    searchAction = `/${locale}/search`;
  } else if (ws.kind === 'partner' && id) {
    const pb = `${base}/partner`;
    groups = [
      {
        key: 'partner',
        label: null,
        items: [
          { key: 'home', href: pb, icon: 'home', label: t('p5partner.nav.home'), match: [], exact: true },
          { key: 'suppliers', href: `${pb}/suppliers`, icon: 'store', label: t('p5partner.nav.suppliers'), match: [`${pb}/suppliers`] },
          { key: 'products', href: `${pb}/products`, icon: 'box', label: t('p5partner.nav.products'), match: [`${pb}/products`] },
          { key: 'import', href: `${pb}/import`, icon: 'upload', label: t('p5partner.nav.import'), match: [`${pb}/import`] },
          { key: 'requests', href: `${pb}/requests`, icon: 'board', label: t('p5partner.nav.requests'), match: [`${pb}/requests`] },
          { key: 'notifications', href: `${pb}/notifications`, icon: 'bell', label: t('p5partner.nav.notifications'), match: [`${pb}/notifications`] },
          { key: 'settings', href: `${pb}/settings`, icon: 'settings', label: t('p5partner.nav.settings'), match: [`${pb}/settings`] },
        ],
      },
      { key: 'more', label: null, items: [{ key: 'team', href: `${base}/members`, icon: 'users', label: m('team'), match: [`${base}/members`] }] },
    ];
    tabs = [
      { key: 'home', href: pb, icon: 'home', label: t('ws.tabHome') },
      { key: 'products', href: `${pb}/products`, icon: 'box', label: t('ws.tabProducts') },
      { key: 'requests', href: `${pb}/requests`, icon: 'board', label: t('ws.tabLeads') },
      { key: 'suppliers', href: `${pb}/suppliers`, icon: 'store', label: m('suppliers') },
    ];
    create = [
      { key: 'product', href: `${pb}/products/new`, tag: t('ws.newTag'), tone: 'green', title: t('ws.createProduct'), sub: t('ws.createProductSub') },
      { key: 'supplier', href: `${pb}/suppliers/new`, tag: t('ws.newTag'), tone: 'gold', title: m('suppliers'), sub: t('p5common.buttons.addSupplier') },
    ];
  } else {
    groups = [
      {
        key: 'buyer',
        label: null,
        items: [
          { key: 'home', href: '/requests', icon: 'home', label: m('home'), match: ['/requests'] },
          { key: 'messages', href: '/enquiries', icon: 'message', label: m('messages'), match: ['/enquiries'] },
          { key: 'saved', href: '/catalogue/saved', icon: 'bookmark', label: m('saved'), match: ['/catalogue/saved'] },
          { key: 'productRequests', href: '/catalogue/requests', icon: 'board', label: m('productRequests'), match: ['/catalogue/requests'] },
        ],
      },
      {
        key: 'grow',
        label: m('grow'),
        items: [
          { key: 'gov', href: '/business-help', icon: 'target', label: m('govHelp'), match: ['/business-help'] },
          { key: 'news', href: '/news', icon: 'news', label: m('news'), match: ['/news'] },
        ],
      },
      {
        key: 'more',
        label: null,
        items: [
          ...(id ? [{ key: 'team', href: `${base}/members`, icon: 'users' as const, label: m('team'), match: [`${base}/members`] }] : []),
          // A buyer can start selling later with the same account: this opens the organisation form with "sell" preselected.
          ...(ws.orgs.some((o) => o.type === 'business') ? [] : [{ key: 'sell', href: '/orgs/new?purpose=sell', icon: 'store' as const, label: m('sellOnInok'), match: ['/orgs/new'] }]),
          { key: 'account', href: '/account', icon: 'settings', label: m('settings'), match: ['/account'] },
        ],
      },
    ];
    tabs = [
      { key: 'home', href: '/requests', icon: 'home', label: t('ws.tabHome') },
      { key: 'msg', href: '/enquiries', icon: 'message', label: t('ws.tabMessages') },
      { key: 'saved', href: '/catalogue/saved', icon: 'store', label: m('saved') },
    ];
    create = [{ key: 'request', href: '/requests/new', tag: t('ws.newTag'), tone: 'gold', title: m('post'), sub: t('dir2.canTFindSub') }];
  }

  const bell: BellItem[] = ws.latest.map((n) => ({ id: n.id, label: t(notificationLabelKey(n.kind)), sub: n.read_at ? '' : t('notifications.new'), href: notificationTarget(n) }));
  const orgSub = ws.org ? t(`orgTypes.${ws.org.type}`) : '';

  return (
    <WorkspaceChrome
      locale={locale}
      initials={initialsOf(ws.user.name)}
      userName={ws.user.name}
      orgName={ws.org?.name ?? null}
      orgInitials={ws.org ? initialsOf(ws.org.name) : ''}
      orgSub={orgSub}
      orgs={ws.orgs.map((o) => ({ id: o.id, name: o.name, sub: t(`orgTypes.${o.type}`) }))}
      activeOrgId={ws.org?.id ?? null}
      groups={groups}
      tabs={tabs}
      create={create}
      unread={ws.unread}
      bell={bell}
      searchAction={searchAction}
    >
      {children}
    </WorkspaceChrome>
  );
}
