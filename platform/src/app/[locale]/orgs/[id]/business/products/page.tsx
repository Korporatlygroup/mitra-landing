import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import ProductsView from '@/components/workspace/ProductsView';
import { pageTitle } from '@/lib/metadata';
import { requireBusinessContext } from '@/server/business-context';
import { listOrgProducts } from '@/server/services/biz-products';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'biz2.products.title');
}

export default async function ProductsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '/products');
  const t = await getTranslations({ locale });
  if (!ctx.canEdit) {
    return (
      <>
        <PageHeader title={t('biz2.products.title')} />
        <p className="message message-error" role="alert">
          {t('biz2.products.noAccess')}
        </p>
      </>
    );
  }
  const products = await listOrgProducts(ctx.session.supabase, id);
  return (
    <div className="wide">
      <Suspense fallback={null}>
        <ProductsView orgId={id} products={products} importHref={null} canEdit={ctx.canEdit} />
      </Suspense>
    </div>
  );
}
