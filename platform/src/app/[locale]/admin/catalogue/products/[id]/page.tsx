import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { TextArea } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
import CatalogueAdminNav from '@/components/admin-catalogue/CatalogueAdminNav';
import DoneBanner from '@/components/admin-catalogue/DoneBanner';
import NoAccess from '@/components/admin-catalogue/NoAccess';
import ProductDiffTable from '@/components/admin-catalogue/ProductDiffTable';
import ProductPreview from '@/components/admin-catalogue/ProductPreview';
import { countChanged, diffProductData } from '@/components/admin-catalogue/helpers';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { getProductForReview } from '@/server/services/p5-admin';
import { reviewProductAction, suspendAction } from '../../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5admin.products.detail.title');
}

export default async function AdminProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const ctx = await requireCatalogueAdmin(locale, `/admin/catalogue/products/${id}`);
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const c = await getTranslations({ locale, namespace: 'p5common' });
  const fmt = await getFormatter({ locale });
  if (!ctx.canReviewProducts) return <NoAccess locale={locale} title={t('products.detail.title')} />;

  const back = (
    <p>
      <Link href="/admin/catalogue/products" locale={locale}>
        {t('products.detail.back')}
      </Link>
    </p>
  );
  const res = await getProductForReview(ctx.session.supabase, id);
  if (!res.ok) {
    return (
      <>
        {back}
        <h1>{t('products.detail.title')}</h1>
        <p role="alert" className="message message-error" data-testid="product-unavailable">
          <strong>{t('common.error')}: </strong>
          {t('products.detail.unavailable')}
        </p>
      </>
    );
  }
  const p = res.data;
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC' });
  const rev = p.revision;
  const submittedData = rev?.data ?? {};
  const rows = diffProductData(p.live_revision, rev?.data ?? null);
  const changed = countChanged(rows);
  const awaiting = Boolean(rev && rev.status === 'submitted' && p.status !== 'suspended' && !p.conflict_of_interest);
  const name = rev?.data?.name ?? p.name ?? p.sku;
  const supplierName = p.supplier?.name ?? null;

  const hidden = (decision: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="productId" value={p.id} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="expectedVersion" value={String(p.version)} />
    </>
  );

  return (
    <>
      {back}
      <h1>{name}</h1>
      <CatalogueAdminNav locale={locale} ctx={ctx} current="products" />
      <DoneBanner locale={locale} value={sp.done} />
      <p>
        <StatusChip status={p.status} label={c(`status.product.${p.status}`)} /> <span className="chip">{p.live_revision_id ? t('products.isChange') : t('products.isNew')}</span>
      </p>
      {p.conflict_of_interest ? (
        <p className="message message-error" role="note" data-testid="product-conflict">
          {t('common.conflict')}
        </p>
      ) : null}
      <dl className="dl">
        <dt>{c('labels.sku')}</dt>
        <dd>{p.sku}</dd>
        <dt>{t('products.supplier')}</dt>
        <dd>
          {ctx.canReviewSuppliers && p.supplier ? (
            <Link href={`/admin/catalogue/suppliers/${p.supplier.id}`} locale={locale}>
              {supplierName ?? p.supplier.code}
            </Link>
          ) : (
            (supplierName ?? '-')
          )}
          {p.supplier ? <> &middot; {c(`status.supplier.${p.supplier.status}`)}</> : null}
        </dd>
        {rev ? (
          <>
            <dt>{t('products.revision')}</dt>
            <dd>
              {rev.rev_no} &middot; {t(`products.revStatus.${rev.status}`)}
            </dd>
            <dt>{t('products.submittedOn')}</dt>
            <dd>{when(rev.submitted_at)}</dd>
          </>
        ) : null}
      </dl>

      <h2>{t('products.detail.compareHeading')}</h2>
      {!rev ? (
        <p>{t('products.detail.noRevision')}</p>
      ) : (
        <>
          <p data-testid="diff-summary">{p.live_revision ? t('products.detail.changedCount', { n: changed }) : t('products.detail.firstSubmission')}</p>
          <ProductDiffTable locale={locale} rows={rows} hasLive={Boolean(p.live_revision)} />

          <h2>{t('products.detail.previewHeading')}</h2>
          <p className="muted">{t('products.detail.previewNote')}</p>
          <ProductPreview locale={locale} data={submittedData} supplierName={supplierName} images={p.media} />

          <h2>{t('products.detail.imagesHeading')}</h2>
          {p.media.length === 0 ? (
            <p>{t('products.detail.noImages')}</p>
          ) : (
            <ul className="card-list" data-testid="product-images">
              {p.media.map((m) => (
                <li key={m.id} className="card" data-testid="product-image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="p5-thumb" src={`/api/v1/catalogue-media/${m.id}`} alt={m.alt ?? ''} width={320} height={240} loading="lazy" />
                  <p style={{ margin: '6px 0 0' }}>
                    <StatusChip status="approved" label={c('status.scan.clean')} />
                  </p>
                  <p className="muted" style={{ margin: 0 }}>
                    {m.alt ? `${t('products.detail.altText')}: ${m.alt}` : t('products.detail.noAlt')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">{t('products.detail.imagesNote')}</p>
        </>
      )}

      <h2>{t('products.detail.historyHeading')}</h2>
      {p.pending_revision && p.pending_revision.status !== 'submitted' ? (
        <ul className="timeline" data-testid="product-history">
          <li data-testid="product-decision" data-status={p.pending_revision.status}>
            <strong>{t('products.detail.decisionLine', { n: p.pending_revision.rev_no, status: t(`products.revStatus.${p.pending_revision.status}`) })}</strong>
            {p.pending_revision.decided_at ? <> &middot; {when(p.pending_revision.decided_at)}</> : null}
            {p.pending_revision.reason ? (
              <>
                <br />
                {t('common.reason')}: {p.pending_revision.reason}
              </>
            ) : null}
          </li>
        </ul>
      ) : (
        <p>{t('products.detail.noDecisionYet')}</p>
      )}
      <p className="muted">{t('products.detail.historyGap')}</p>

      {awaiting ? (
        <section aria-labelledby="decide-h">
          <h2 id="decide-h">{t('products.detail.decideHeading')}</h2>
          <p>{t('products.detail.decideIntro')}</p>
          <div className="card">
            <h3>{t('products.detail.approveHeading')}</h3>
            <p className="hint">{t('products.detail.approveHint')}</p>
            <ActionForm action={reviewProductAction} submitLabel={t('products.detail.approveButton')}>
              {hidden('approve')}
              <TextArea id="approve-note" name="reason" label={t('suppliers.detail.noteOptional')} maxLength={1000} />
            </ActionForm>
          </div>
          <div className="card">
            <h3>{t('products.detail.changesHeading')}</h3>
            <p className="hint">{t('products.detail.changesHint')}</p>
            <ActionForm action={reviewProductAction} submitLabel={t('products.detail.changesButton')} variant="secondary">
              {hidden('request_changes')}
              <TextArea id="changes-reason" name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
            </ActionForm>
          </div>
          <div className="card">
            <h3>{t('products.detail.rejectHeading')}</h3>
            <p className="hint">{t('products.detail.rejectHint')}</p>
            <ActionForm action={reviewProductAction} submitLabel={t('products.detail.rejectButton')} variant="danger">
              {hidden('reject')}
              <TextArea id="reject-reason" name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
            </ActionForm>
          </div>
        </section>
      ) : null}

      {!p.conflict_of_interest && p.status !== 'suspended' && p.status !== 'draft' ? (
        <section aria-labelledby="susp-h">
          <h2 id="susp-h">{t('products.detail.suspendHeading')}</h2>
          <p>{t('products.detail.suspendHint')}</p>
          <ActionForm action={suspendAction} submitLabel={t('products.detail.suspendButton')} variant="danger">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="target" value="product" />
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="mode" value="suspend" />
            <TextArea id="susp-reason" name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
          </ActionForm>
        </section>
      ) : null}
      {!p.conflict_of_interest && p.status === 'suspended' ? (
        <section aria-labelledby="reinst-h">
          <h2 id="reinst-h">{t('products.detail.reinstateHeading')}</h2>
          <p>{t('products.detail.reinstateHint')}</p>
          <ActionForm action={suspendAction} submitLabel={t('products.detail.reinstateButton')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="target" value="product" />
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="mode" value="reinstate" />
            <TextArea id="reinst-reason" name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
