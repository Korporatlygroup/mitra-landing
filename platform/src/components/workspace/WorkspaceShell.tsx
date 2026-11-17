import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
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
  const initialCollapsed = (await cookies()).get('inok_sb')?.value === '1';
  const t = await getTranslations({ locale });
  const id = ws.org?.id;
  const m = (k: string) => t(`ws.menu.${k}`);
  const base = id ? `/orgs/${id}` : '';

  let tabs: { key: string; href: string; icon: 'home' | 'board' | 'message' | 'box' | 'store'; label: string }[];
  let create: CreateItem[];
  // Search goes to what it can actually search: the public directory (businesses and their services); a business workspace also searches its own requests.
  let searchAction: string | null = `/${locale}/directory`;

  const isBiz = ws.kind === 'business' && Boolean(id);
  const isPartner = ws.kind === 'partner' && Boolean(id);
  const hasBusinessOrg = ws.orgs.some((o) => o.type === 'business');
  const pb = `${base}/partner`;
  const bb = `${base}/business`;

  // One menu for every signed-in page. Every entry below points at a page that exists; modules that do not exist yet are not listed.
  const groups: MenuGroup[] = [
    {
      key: 'main',
      label: m('sMain'),
      items: [
        { key: 'home', href: '/', icon: 'home', label: m('home'), match: [], exact: true },
        ...(isBiz ? [{ key: 'b360', href: `${bb}/360`, icon: 'target' as const, label: m('b360'), match: [`${bb}/360`] }] : []),
        { key: 'notifications', href: '/notifications', icon: 'bell', label: m('notifications'), match: ['/notifications'], count: ws.unread || undefined },
      ],
    },
    {
      key: 'market',
      label: m('sMarket'),
      items: [
        { key: 'directory', href: '/directory', icon: 'search', label: m('findBusinesses'), match: ['/directory', '/search'] },
        { key: 'catalogue', href: '/catalogue', icon: 'box', label: m('catalogue'), match: ['/catalogue'] },
        { key: 'myRequests', href: '/requests', icon: 'board', label: m('myRequests'), match: ['/requests'] },
        { key: 'enquiries', href: '/enquiries', icon: 'message', label: m('enquiries'), match: ['/enquiries'] },
        ...(isBiz ? [{ key: 'customerRequests', href: `${bb}/requests`, icon: 'list' as const, label: m('customerRequests'), match: [`${bb}/requests`, `${bb}/leads`], count: ws.newRequests || undefined }] : []),
        { key: 'sourcing', href: '/sourcing', icon: 'layers', label: m('sourcing'), match: ['/sourcing'] },
      ],
    },
    {
      key: 'mine',
      label: m('sBusiness'),
      items: isBiz
        ? [
            { key: 'profile', href: bb, icon: 'store', label: m('profileEdit'), match: [`${bb}/onboarding`], exact: true },
            { key: 'listing', href: `${bb}/listing`, icon: 'eye', label: m('listing'), match: [`${bb}/listing`, `${bb}/preview`] },
            { key: 'products', href: `${bb}/products`, icon: 'box', label: m('products'), match: [`${bb}/products`] },
            ...(ws.canReadVerification ? [{ key: 'verification', href: `${bb}/verification`, icon: 'shield' as const, label: m('verification'), match: [`${bb}/verification`] }] : []),
            { key: 'team', href: `${base}/members`, icon: 'users', label: m('team'), match: [`${base}/members`] },
          ]
        : isPartner
          ? [
              { key: 'phome', href: pb, icon: 'home', label: t('p5partner.nav.home'), match: [], exact: true },
              { key: 'suppliers', href: `${pb}/suppliers`, icon: 'store', label: t('p5partner.nav.suppliers'), match: [`${pb}/suppliers`] },
              { key: 'pproducts', href: `${pb}/products`, icon: 'box', label: t('p5partner.nav.products'), match: [`${pb}/products`] },
              { key: 'import', href: `${pb}/import`, icon: 'upload', label: t('p5partner.nav.import'), match: [`${pb}/import`] },
              { key: 'prequests', href: `${pb}/requests`, icon: 'board', label: t('p5partner.nav.requests'), match: [`${pb}/requests`] },
              { key: 'team', href: `${base}/members`, icon: 'users', label: m('team'), match: [`${base}/members`] },
            ]
          : [
              // A buyer can start selling later with the same account: this opens the organisation form with "sell" preselected.
              ...(hasBusinessOrg ? [] : [{ key: 'sell', href: '/list-your-business', icon: 'store' as const, label: m('sellOnInok'), match: ['/orgs/new'] }]),
              ...(id ? [{ key: 'team', href: `${base}/members`, icon: 'users' as const, label: m('team'), match: [`${base}/members`] }] : []),
            ],
    },
    {
      key: 'support',
      label: m('sSupport'),
      items: [
        { key: 'gov', href: '/business-help', icon: 'target', label: m('govHelp'), match: ['/business-help'], exact: true },
        { key: 'saved', href: '/business-help/saved', icon: 'bookmark', label: m('savedAssistance'), match: ['/business-help/saved'] },
        { key: 'news', href: '/news', icon: 'news', label: m('news'), match: ['/news'] },
      ],
    },
    {
      key: 'account',
      label: m('sAccount'),
      items: [
        { key: 'account', href: '/account', icon: 'settings', label: m('settings'), match: ['/account'] },
        { key: 'help', href: '/complaints', icon: 'help', label: m('helpComplaints'), match: ['/complaints'] },
      ],
    },
  ];
  if (ws.isStaff) {
    groups.push({
      key: 'admin',
      label: m('sAdmin'),
      items: [
        { key: 'admin', href: '/admin', icon: 'shield', label: m('adminConsole'), match: [], exact: true },
        { key: 'adminReviews', href: '/admin/verification', icon: 'check', label: m('adminReviews'), match: ['/admin/verification'] },
        { key: 'adminListings', href: '/admin/listings', icon: 'store', label: m('adminListings'), match: ['/admin/listings'] },
        { key: 'adminDup', href: '/admin/duplicates', icon: 'users', label: m('adminDuplicates'), match: ['/admin/duplicates'] },
        { key: 'adminProg', href: '/admin/business-help', icon: 'target', label: m('adminProgrammes'), match: ['/admin/business-help'] },
        { key: 'adminNews', href: '/admin/news', icon: 'news', label: m('adminNews'), match: ['/admin/news'] },
        { key: 'adminUsers', href: '/admin/users', icon: 'users', label: m('adminUsers'), match: ['/admin/users'] },
        { key: 'adminAudit', href: '/admin/audit', icon: 'list', label: m('adminAudit'), match: ['/admin/audit'] },
      ],
    });
  }

  if (isBiz) {
    tabs = [
      { key: 'home', href: '/', icon: 'home', label: t('ws.tabHome') },
      { key: 'leads', href: `${bb}/requests`, icon: 'board', label: t('ws.tabLeads') },
      { key: 'msg', href: '/enquiries', icon: 'message', label: t('ws.tabMessages') },
      { key: 'products', href: `${bb}/products`, icon: 'box', label: t('ws.tabProducts') },
    ];
    create = [
      { key: 'product', href: `${bb}/products?new=1`, tag: t('ws.newTag'), tone: 'green', title: t('ws.createProduct'), sub: t('ws.createProductSub') },
      { key: 'quote', href: `${bb}/requests`, tag: t('ws.newTag'), tone: 'gold', title: t('ws.createQuote'), sub: t('ws.createQuoteSub') },
      { key: 'message', href: '/enquiries', tag: t('ws.newTag'), tone: 'blue', title: t('ws.createMessage'), sub: t('ws.createMessageSub') },
      { key: 'request', href: '/requests/new', tag: t('ws.newTag'), tone: 'gold', title: m('post'), sub: t('dir2.canTFindSub') },
    ];
    searchAction = `/${locale}/search`;
  } else if (isPartner) {
    tabs = [
      { key: 'home', href: '/', icon: 'home', label: t('ws.tabHome') },
      { key: 'products', href: `${pb}/products`, icon: 'box', label: t('ws.tabProducts') },
      { key: 'requests', href: `${pb}/requests`, icon: 'board', label: t('ws.tabLeads') },
      { key: 'suppliers', href: `${pb}/suppliers`, icon: 'store', label: m('suppliers') },
    ];
    create = [
      { key: 'product', href: `${pb}/products/new`, tag: t('ws.newTag'), tone: 'green', title: t('ws.createProduct'), sub: t('ws.createProductSub') },
      { key: 'supplier', href: `${pb}/suppliers/new`, tag: t('ws.newTag'), tone: 'gold', title: m('suppliers'), sub: t('p5common.buttons.addSupplier') },
    ];
  } else {
    tabs = [
      { key: 'home', href: '/', icon: 'home', label: t('ws.tabHome') },
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
      allWorkspacesLabel={m('allWorkspaces')}
      orgs={ws.orgs.map((o) => ({ id: o.id, name: o.name, sub: t(`orgTypes.${o.type}`) }))}
      activeOrgId={ws.org?.id ?? null}
      groups={groups}
      tabs={tabs}
      create={create}
      unread={ws.unread}
      bell={bell}
      searchAction={searchAction}
      initialCollapsed={initialCollapsed}
    >
      {children}
    </WorkspaceChrome>
  );
}
