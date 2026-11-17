import { randomUUID } from 'node:crypto';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PriceSummary } from '@/components/catalogue/Notes';
import RequestForm from '@/components/catalogue/RequestForm';
import { Link } from '@/i18n/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { MY_STATES } from '@/lib/schemas';
import { requireSession } from '@/server/session';
import { loadItem } from '../../data';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const item = await loadItem(id);
  const t = await getTranslations({ locale, namespace: 'p5buyer.request' });
  return { title: item ? `${t('title')}: ${item.name}` : t('title') };
}

/** Request Price for one product (signed in; an organisation of your own is created on first use if you have none). */
export default async function RequestPricePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const session = await requireSession({ locale, requireOrg: true, path: `/catalogue/${id}/request` });
  const item = await loadItem(id);
  if (!item) notFound();
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const orgs = eligibleBuyerOrgs(session.memberships).map((m) => ({ id: m.org.id, name: m.org.name }));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <p>
        <Link href={`/catalogue/${id}`} locale={locale}>
          {t('request.backToProduct')}
        </Link>
      </p>
      <h1>{t('request.title')}</h1>
      <section aria-labelledby="req-prod-h" className="card">
        <h2 id="req-prod-h" style={{ marginTop: 0, fontSize: '1.15rem' }}>
          {item.name}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          {item.supplier.name}
          {item.supplier.state_city || item.supplier.country ? ` · ${[item.supplier.state_city, item.supplier.country].filter(Boolean).join(', ')}` : ''}
        </p>
        <p style={{ margin: '8px 0' }}>
          {tc('labels.moq')}: {item.moq} {tc(`units.${item.unit}`)}
        </p>
        <PriceSummary priceMode={item.price_mode} fromPrice={item.from_price} currency={item.currency} unit={item.unit} confirmedOn={item.price_confirmed_on} locale={locale} />
      </section>
      <p>{t('request.intro')}</p>
      <RequestForm
        locale={locale}
        productId={id}
        initialKey={randomUUID()}
        orgs={orgs}
        variants={item.variants.map((v) => ({ sku: v.sku, label: v.label, moq: v.moq }))}
        moq={Number(item.moq)}
        unitLabel={tc(`units.${item.unit}`)}
        states={MY_STATES}
        minDate={today}
        loginNext={`/${locale}/catalogue/${id}/request`}
      />
    </>
  );
}
