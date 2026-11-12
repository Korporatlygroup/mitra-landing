import { getFormatter, getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import CatalogueAdminNav from '@/components/admin-catalogue/CatalogueAdminNav';
import NoAccess from '@/components/admin-catalogue/NoAccess';
import Pager from '@/components/admin-catalogue/Pager';
import { parseOffset } from '@/components/admin-catalogue/helpers';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { listProductReviews } from '@/server/services/p5-admin';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5admin.products.title');
}

export default async function AdminProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const ctx = await requireCatalogueAdmin(locale, '/admin/catalogue/products');
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const all = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  if (!ctx.canReviewProducts) return <NoAccess locale={locale} title={t('products.title')} />;

  const offset = parseOffset(sp.offset);
  const res = await listProductReviews(ctx.session.supabase, offset);
  const page = res.ok ? res.data : null;

  return (
    <>
      <h1>{t('products.title')}</h1>
      <CatalogueAdminNav locale={locale} ctx={ctx} current="products" />
      <p>{t('products.intro')}</p>
      {!page ? (
        <p role="alert" className="message message-error">
          <strong>{t('common.error')}: </strong>
          {all(`errors.${res.ok ? 'invalid_input' : res.errorKey}`)}
        </p>
      ) : page.items.length === 0 ? (
        <p>{t('products.empty')}</p>
      ) : (
        <ul className="card-list" data-testid="product-queue">
          {page.items.map((p) => (
            <li key={p.id} className="card" data-testid="product-card" data-product={p.id}>
              <h3>
                <Link href={`/admin/catalogue/products/${p.id}`} locale={locale}>
                  {p.name ?? p.sku}
                </Link>
              </h3>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip status={p.status === 'submitted' ? 'pending' : p.status} label={all(`p5common.status.product.${p.status}`)} />{' '}
                <span className="chip">{p.live_revision_id ? t('products.isChange') : t('products.isNew')}</span>
              </p>
              <dl className="dl">
                <dt>{all('p5common.labels.sku')}</dt>
                <dd>{p.sku}</dd>
                <dt>{t('products.supplier')}</dt>
                <dd>{p.supplier_name ?? '-'}</dd>
                <dt>{t('products.partner')}</dt>
                <dd>{p.partner_name ?? '-'}</dd>
                <dt>{t('products.revision')}</dt>
                <dd>{p.revision_no}</dd>
                <dt>{t('products.submittedOn')}</dt>
                <dd>{fmt.dateTime(new Date(p.submitted_at), { dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC' })}</dd>
              </dl>
              {p.conflict_of_interest ? (
                <p className="message message-error" role="note">
                  {t('common.conflict')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page ? <Pager locale={locale} base="/admin/catalogue/products" offset={offset} total={page.total} /> : null}
    </>
  );
}
