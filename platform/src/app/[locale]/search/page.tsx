import { getTranslations } from 'next-intl/server';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { listOrgProducts } from '@/server/services/biz-products';
import { listEnquiries, listSellerRequests } from '@/server/services/directory';
import { listGovProgrammes } from '@/server/services/gov';
import { requireSession } from '@/server/session';
import { getWorkspace } from '@/server/workspace';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'biz2.search.title');
}

const has = (hay: (string | null | undefined)[], needle: string) => hay.some((h) => (h ?? '').toLowerCase().includes(needle));

/** Top-bar search: the signed-in person's requests and enquiries, products and services, and the published government programmes. */
export default async function SearchPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const s = await requireSession({ locale, path: '/search', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale });
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 80);
  const needle = q.toLowerCase();
  const ws = await getWorkspace();
  const org = ws?.org ?? null;

  let requests: { href: string; title: string; sub: string }[] = [];
  let products: { href: string; title: string; sub: string }[] = [];
  let programmes: { href: string; title: string; sub: string }[] = [];
  if (q.length >= 2) {
    const [reqRows, enqRows, prodRows, govRes] = await Promise.all([
      org?.type === 'business' ? listSellerRequests(s.supabase, org.id, 'all') : Promise.resolve([]),
      listEnquiries(s.supabase, org ? (org.type === 'business' ? { sellerOrgId: org.id } : { buyerOrgIds: [org.id] }) : {}),
      org?.type === 'business' ? listOrgProducts(s.supabase, org.id) : Promise.resolve([]),
      listGovProgrammes(s.supabase, { q, limit: 8 }),
    ]);
    requests = [
      ...reqRows.filter((r) => has([r.title, r.target_state], needle)).map((r) => ({ href: `/orgs/${org!.id}/business/requests/${r.request_id}`, title: r.title ?? '', sub: r.target_state ?? '' })),
      ...enqRows.filter((e) => has([e.topic, e.opening_note], needle)).map((e) => ({ href: `/enquiries/${e.id}`, title: e.topic, sub: t(`enq.statuses.${e.status}`) })),
    ];
    products = prodRows.filter((p) => has([p.name, p.description], needle)).map((p) => ({ href: `/orgs/${org!.id}/business/products`, title: p.name, sub: p.kind === 'service' ? t('biz2.products.kService') : t('biz2.products.kProduct') }));
    programmes = (govRes.ok ? govRes.data : []).map((g) => ({ href: `/business-help/${g.slug}`, title: g.name, sub: g.agency_name }));
  }
  const groups = [
    { key: 'requests', label: t('biz2.search.requests'), items: requests },
    { key: 'products', label: t('biz2.search.products'), items: products },
    { key: 'programmes', label: t('biz2.search.programmes'), items: programmes },
  ];
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="wide" style={{ maxWidth: '52rem', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h1 style={{ margin: 0 }}>{q ? t('biz2.search.results', { q }) : t('biz2.search.title')}</h1>
      <form role="search" method="get" className="dir-search" style={{ flex: 'none' }}>
        <Icon name="search" size={18} />
        <label className="sr" htmlFor="sq">
          {t('ws.search')}
        </label>
        <input id="sq" name="q" type="search" defaultValue={q} maxLength={80} placeholder={t('ws.searchPlaceholder')} />
        <button type="submit" className="btn btn-primary btn-sm">
          {t('ws.search')}
        </button>
      </form>
      {!q ? <p className="mut">{t('biz2.search.empty')}</p> : total === 0 ? <div className="empty"><strong>{t('biz2.search.none', { q })}</strong></div> : null}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.key} aria-labelledby={`sg-${g.key}`}>
            <h2 id={`sg-${g.key}`} style={{ fontSize: '1rem', margin: '0 0 8px' }}>
              {g.label}
            </h2>
            <ul className="card-list">
              {g.items.map((i) => (
                <li key={`${i.href}-${i.title}`} className="card" style={{ padding: 14 }}>
                  <Link href={i.href} style={{ fontWeight: 700 }}>
                    {i.title}
                  </Link>
                  {i.sub ? <div className="mut" style={{ fontSize: '0.8125rem' }}>{i.sub}</div> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
