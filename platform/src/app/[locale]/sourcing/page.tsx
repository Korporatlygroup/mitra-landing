import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { listSourcingRfqs, listSourcingTemplates } from '@/server/services/p6-sourcing';
import { requireSession } from '@/server/session';

export default async function SourcingHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await requireSession({ locale, path: '/sourcing' });
  const t = await getTranslations({ locale, namespace: 'p6' });
  const orgs = eligibleBuyerOrgs(session.memberships);
  const lists = await Promise.all(orgs.map((m) => listSourcingRfqs(session.supabase, m.org.id)));
  const requests = lists.flatMap((r) => r.ok ? r.data.items : []).sort((a,b) => b.created_at.localeCompare(a.created_at));
  const savedLists = await Promise.all(orgs.map((m) => listSourcingTemplates(session.supabase, m.org.id)));
  const templates = savedLists.flatMap((list, index) => list.ok ? list.data.map((item) => ({
    ...item, org: orgs[index]!.org.id,
  })) : []);
  return <main className="container">
    <h1>{t('title')}</h1>
    <p>{t('intro')}</p>
    <nav aria-label={t('title')} className="link-row">
      <Link href="/catalogue" locale={locale} className="btn btn-secondary">{t('step1')}</Link>
      <Link href="/sourcing/new" locale={locale} className="btn btn-primary">{t('new')}</Link>
    </nav>
    <h2>{t('myRequests')}</h2>
    {!requests.length ? <p>{t('empty')}</p> :
      <ul className="card-list">{requests.map((r) => <li className="card" key={r.id}>
        <h3><Link href={`/sourcing/${r.id}`} locale={locale}>{r.reference}</Link></h3>
        <p>{t(`status.${r.status as 'submitted'}`)}</p>
      </li>)}</ul>}
    {templates.length ? <section><h2>{t('savedLists')}</h2><ul className="card-list">
      {templates.map((item) => <li key={item.id} className="card"><strong>{item.title}</strong>
        <p><Link href={`/sourcing/new?template=${item.id}&org=${item.org}`} locale={locale}
          className="btn btn-secondary">{t('useTemplate')}</Link></p>
      </li>)}</ul></section> : null}
  </main>;
}
