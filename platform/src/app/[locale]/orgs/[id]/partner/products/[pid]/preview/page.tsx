import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import PartnerGate from '@/components/partner/PartnerGate';
import ProductPreview from '@/components/partner/ProductPreview';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { requirePartnerContext } from '@/server/partner-context';
import { getMyProduct, getSupplier } from '@/server/services/p5-partner';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.preview.title');
}

export default async function ProductPreviewPage({ params }: { params: Promise<{ locale: string; id: string; pid: string }> }) {
  const { locale, id, pid } = await params;
  if (!uuidSchema.safeParse(pid).success) notFound();
  const ctx = await requirePartnerContext(locale, id, `/products/${pid}/preview`);
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const r = await getMyProduct(ctx.session.supabase, id, pid);
  if (!r.ok) notFound();
  const p = r.data;
  const s = await getSupplier(ctx.session.supabase, p.supplier_id);
  const t = await getTranslations({ locale, namespace: 'p5partner.preview' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const sd = s.ok ? s.data : null;
  const base = `/orgs/${id}/partner/products/${pid}`;
  return (
    <>
      <p>
        <Link href={base} locale={locale}>
          {tt('backTo', { page: p.name ?? p.sku })}
        </Link>
      </p>
      <PageHeader title={t('title')} />
      <ProductPreview
        locale={locale}
        draft={{ ...p.draft, sku: p.sku }}
        supplier={{ name: sd?.live.name ?? sd?.name ?? null, country: sd?.live.country ?? sd?.draft.country ?? null, state_city: sd?.live.state_city ?? null, checks: sd?.review_checks ?? null, reviewed_at: sd?.reviewed_at ?? null }}
        media={p.media ?? []}
      />
      <p className="link-row">
        <Link href={`${base}/edit`} locale={locale} className="btn btn-secondary">
          {t('backToEdit')}
        </Link>
        <Link href={base} locale={locale} className="btn btn-primary">
          {t('toActions')}
        </Link>
      </p>
    </>
  );
}
