import { getTranslations } from 'next-intl/server';
import PartnerGate from '@/components/partner/PartnerGate';
import ProductForm from '@/components/partner/ProductForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { todayIso } from '@/lib/partner-ui';
import { requirePartnerContext } from '@/server/partner-context';
import { listMySuppliers } from '@/server/services/p5-partner';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.products.addTitle');
}

export default async function NewProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePartnerContext(locale, id, '/products/new');
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const t = await getTranslations({ locale, namespace: 'p5partner.products' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const r = await listMySuppliers(ctx.session.supabase, id);
  const approved = (r.ok ? r.data.items : []).filter((s) => s.status === 'approved').map((s) => ({ id: s.id, name: s.name ?? s.code }));
  const wanted = typeof sp.supplier === 'string' ? sp.supplier : '';
  const supplierId = approved.find((s) => s.id === wanted)?.id ?? approved[0]?.id ?? '';
  return (
    <>
      <p>
        <Link href={`/orgs/${id}/partner/products`} locale={locale}>
          {tt('backTo', { page: t('title') })}
        </Link>
      </p>
      <h1>{t('addTitle')}</h1>
      {!ctx.canManageCatalogue ? (
        <p className="message message-error">{t('readOnly')}</p>
      ) : approved.length === 0 ? (
        <section data-testid="no-approved-supplier">
          <p>{t('needSupplier')}</p>
          <Link href={`/orgs/${id}/partner/suppliers`} locale={locale} className="btn btn-primary">
            {t('goSuppliers')}
          </Link>
        </section>
      ) : (
        <ProductForm mode="create" locale={locale} orgId={id} suppliers={approved} supplierId={supplierId} draft={{}} today={todayIso()} />
      )}
    </>
  );
}
