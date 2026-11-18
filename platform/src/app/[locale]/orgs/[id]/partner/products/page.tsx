import { getTranslations } from 'next-intl/server';
import PartnerGate from '@/components/partner/PartnerGate';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { statusTone } from '@/lib/partner-ui';
import { requirePartnerContext } from '@/server/partner-context';
import { listMyProducts, listMySuppliers } from '@/server/services/p5-partner';
import type { ProductStatus } from '@/server/services/p5-types';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.nav.products');
}

const STATUSES: ProductStatus[] = ['draft', 'submitted', 'changes_requested', 'approved', 'published', 'unpublished', 'rejected', 'suspended'];
const PAGE = 25;

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePartnerContext(locale, id, '/products');
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const t = await getTranslations({ locale, namespace: 'p5partner.products' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const te = await getTranslations({ locale, namespace: 'errors' });
  const db = ctx.session.supabase;

  const status = STATUSES.includes(sp.status as ProductStatus) ? (sp.status as ProductStatus) : null;
  const supplierParam = typeof sp.supplier === 'string' && /^[0-9a-f-]{36}$/.test(sp.supplier) ? sp.supplier : null;
  const offset = Math.max(0, Number(typeof sp.offset === 'string' ? sp.offset : 0) || 0);
  const [suppliers, list] = await Promise.all([listMySuppliers(db, id), listMyProducts(db, id, { supplierId: supplierParam, status, offset, limit: PAGE })]);
  const sup = suppliers.ok ? suppliers.data.items : [];
  const supplierName = (sid: string) => sup.find((s) => s.id === sid)?.name ?? '-';
  const base = `/orgs/${id}/partner/products`;
  const qs = (o: number) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (supplierParam) p.set('supplier', supplierParam);
    if (o) p.set('offset', String(o));
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const items = list.ok ? list.data.items : [];
  const total = list.ok ? list.data.total : 0;

  return (
    <>
      <PageHeader title={t('title')} sub={t('intro')} />
      {ctx.canManageCatalogue ? (
        <p className="link-row">
          <Link href={`${base}/new`} locale={locale} className="btn btn-primary">
            {tc('buttons.addProduct')}
          </Link>
          <Link href={`/orgs/${id}/partner/import`} locale={locale} className="btn btn-secondary">
            {tc('buttons.uploadProducts')}
          </Link>
        </p>
      ) : (
        <p className="hint">{t('readOnly')}</p>
      )}

      <form method="get" className="form form-wide filters" aria-label={t('filters')}>
        <div className="field">
          <label htmlFor="f-supplier">{t('filterSupplier')}</label>
          <select id="f-supplier" name="supplier" defaultValue={supplierParam ?? ''}>
            <option value="">{tt('all')}</option>
            {sup.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">{t('filterStatus')}</label>
          <select id="f-status" name="status" defaultValue={status ?? ''}>
            <option value="">{tt('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tc(`status.product.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-secondary">
            {tt('apply')}
          </button>
        </div>
      </form>

      {!list.ok ? (
        <p className="message message-error" role="alert">
          {te(list.errorKey)}
        </p>
      ) : null}
      {list.ok && items.length === 0 ? (
        <section>
          <h2>{t('emptyTitle')}</h2>
          <p>{status || supplierParam ? t('emptyFiltered') : t('emptyBody')}</p>
        </section>
      ) : (
        <ul className="card-list" data-testid="product-list">
          {items.map((p) => (
            <li key={p.id} className="card" data-testid="product-row">
              <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>
                <Link href={`${base}/${p.id}`} locale={locale}>
                  {p.name ?? p.sku}
                </Link>
              </h2>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip status={statusTone(p.status)} label={tc(`status.product.${p.status}`)} />
                <span className="muted">
                  {' '}
                  &middot; {tc('labels.sku')}: {p.sku} &middot; {supplierName(p.supplier_id)}
                </span>
              </p>
              {p.pending_revision && p.status !== 'submitted' && p.status !== 'draft' ? (
                <p className="hint">{t(`revision.${p.pending_revision.status === 'submitted' ? 'inReview' : p.pending_revision.status === 'approved' ? 'approved' : 'other'}`)}</p>
              ) : null}
              {p.has_unsubmitted_changes && p.status !== 'draft' ? <p className="hint">{t('unsentChanges')}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {total > PAGE ? (
        <nav aria-label={tt('pagination')} className="link-row">
          {offset > 0 ? (
            <Link href={`${base}${qs(Math.max(0, offset - PAGE))}`} locale={locale} className="btn btn-secondary">
              {tt('previous')}
            </Link>
          ) : null}
          {offset + PAGE < total ? (
            <Link href={`${base}${qs(offset + PAGE)}`} locale={locale} className="btn btn-secondary">
              {tt('next')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
