import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import MediaManager from '@/components/partner/MediaManager';
import PartnerGate from '@/components/partner/PartnerGate';
import ProductForm from '@/components/partner/ProductForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { productEditable, todayIso } from '@/lib/partner-ui';
import { uuidSchema } from '@/lib/schemas';
import { requirePartnerContext } from '@/server/partner-context';
import { getMyProduct, listMySuppliers } from '@/server/services/p5-partner';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.products.editTitle');
}

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string; pid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id, pid } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(pid).success) notFound();
  const ctx = await requirePartnerContext(locale, id, `/products/${pid}/edit`);
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const r = await getMyProduct(ctx.session.supabase, id, pid);
  if (!r.ok) notFound();
  const p = r.data;
  const [t, tt, suppliers] = await Promise.all([
    getTranslations({ locale, namespace: 'p5partner.products' }),
    getTranslations({ locale, namespace: 'p5partner.common' }),
    listMySuppliers(ctx.session.supabase, id),
  ]);
  const sup = (suppliers.ok ? suppliers.data.items : []).map((s) => ({ id: s.id, name: s.name ?? s.code }));
  const editable = ctx.canManageCatalogue && productEditable(p.status, p.pending_revision?.status);
  return (
    <>
      <p>
        <Link href={`/orgs/${id}/partner/products/${pid}`} locale={locale}>
          {tt('backTo', { page: p.name ?? p.sku })}
        </Link>
      </p>
      <h1>{t('editTitle')}</h1>
      {sp.saved ? (
        <p className="message message-ok" role="status">
          {tt('saved')}
        </p>
      ) : null}
      {editable ? (
        <ProductForm
          mode="edit"
          locale={locale}
          orgId={id}
          suppliers={sup}
          supplierId={p.supplier_id}
          productId={pid}
          draftVersion={p.draft_version}
          sku={p.sku}
          draft={p.draft ?? {}}
          today={todayIso()}
          reloadHref={`/${locale}/orgs/${id}/partner/products/${pid}/edit`}
        />
      ) : (
        <p className="message message-error" role="alert" data-testid="not-editable">
          {ctx.canManageCatalogue ? t('notEditable') : t('readOnly')}
        </p>
      )}
      <h2>{t('mediaTitle')}</h2>
      <MediaManager orgId={id} productId={pid} media={p.media ?? []} canEdit={editable} />
    </>
  );
}
