import { getTranslations } from 'next-intl/server';
import PartnerGate from '@/components/partner/PartnerGate';
import { Link } from '@/i18n/navigation';
import { requirePartnerContext } from '@/server/partner-context';
import { listSourcingRfqs } from '@/server/services/p6-sourcing';
import PageHeader from '@/components/shared/PageHeader';

export default async function PartnerSourcingPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requirePartnerContext(locale, id, '/sourcing');
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const t = await getTranslations({ locale, namespace: 'p6' });
  const result = await listSourcingRfqs(ctx.session.supabase, id);
  const requests = result.ok ? result.data.items : [];
  return <div className="container"><PageHeader title={t('partnerRequests')} />
    {!requests.length ? <p>{t('empty')}</p> : <ul className="card-list">
      {requests.map((r) => <li className="card" key={r.id}>
        <h2><Link href={`/sourcing/${r.id}?partner=${id}`} locale={locale}>{r.reference}</Link></h2>
        <p>{t(`status.${r.status as 'submitted'}`)}</p>
      </li>)}
    </ul>}
  </div>;
}
