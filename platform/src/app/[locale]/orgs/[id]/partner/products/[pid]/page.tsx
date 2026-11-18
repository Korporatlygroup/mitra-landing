import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import PartnerForm from '@/components/partner/PartnerForm';
import PartnerGate from '@/components/partner/PartnerGate';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { productEditable, statusTone } from '@/lib/partner-ui';
import { uuidSchema } from '@/lib/schemas';
import { requirePartnerContext } from '@/server/partner-context';
import { getMyProduct, getSupplier } from '@/server/services/p5-partner';
import { publishProductAction, submitProductAction, unpublishProductAction } from '../actions';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.products.detailTitle');
}

export default async function ProductOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string; pid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id, pid } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(pid).success) notFound();
  const ctx = await requirePartnerContext(locale, id, `/products/${pid}`);
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const r = await getMyProduct(ctx.session.supabase, id, pid);
  if (!r.ok) notFound();
  const p = r.data;
  const sup = await getSupplier(ctx.session.supabase, p.supplier_id);
  const [t, tc, tt, fmt] = await Promise.all([
    getTranslations({ locale, namespace: 'p5partner.products' }),
    getTranslations({ locale, namespace: 'p5common' }),
    getTranslations({ locale, namespace: 'p5partner.common' }),
    getFormatter({ locale }),
  ]);
  const base = `/orgs/${id}/partner/products`;
  const pend = p.pending_revision;
  const live = p.status === 'published' || p.status === 'unpublished';
  const editable = ctx.canManageCatalogue && productEditable(p.status, pend?.status);
  const canSubmit = editable && (p.status === 'draft' || p.status === 'changes_requested' || p.status === 'rejected' || p.has_unsubmitted_changes);
  const canPublish = ctx.canManageCatalogue && (p.status === 'approved' || p.status === 'unpublished' || (live && pend?.status === 'approved'));
  const canUnpublish = ctx.canManageCatalogue && p.status === 'published';
  // The reason the reviewer gave, from the revision that needs changes (or the product itself when it was refused).
  const feedback = pend && (pend.status === 'changes_requested' || pend.status === 'rejected') ? pend.reason : p.status === 'changes_requested' || p.status === 'rejected' ? (p.revisions.find((x) => x.reason)?.reason ?? null) : null;
  const supplierOk = sup.ok && sup.data.status === 'approved';
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={id} />
      <input type="hidden" name="productId" value={pid} />
    </>
  );

  return (
    <>
      <p>
        <Link href={base} locale={locale}>
          {tt('backTo', { page: t('title') })}
        </Link>
      </p>
      <PageHeader title={p.name ?? p.sku} />
      <p>
        <StatusChip status={statusTone(p.status)} label={tc(`status.product.${p.status}`)} />{' '}
        <span className="muted">
          &middot; {tc('labels.sku')}: {p.sku} &middot; {sup.ok ? (sup.data.name ?? sup.data.code) : '-'}
        </span>
      </p>
      {sp.sent ? (
        <p className="message message-ok" role="status" data-testid="sent-banner">
          {t('sent')}
        </p>
      ) : null}
      {sp.published ? (
        <p className="message message-ok" role="status" data-testid="published-banner">
          {t('publishedNow')}
        </p>
      ) : null}
      {sp.unpublished ? (
        <p className="message message-ok" role="status" data-testid="unpublished-banner">
          {t('unpublishedNow')}
        </p>
      ) : null}

      <p className="next-step" data-testid="status-explain">
        {t(`explain.${p.status}`)}
      </p>
      {feedback ? (
        <div className="message message-error" data-testid="admin-reason">
          <p style={{ margin: 0 }}>
            <strong>{p.status === 'rejected' || pend?.status === 'rejected' ? t('reasonRejected') : t('reasonChanges')}: </strong>
            {feedback}
          </p>
        </div>
      ) : null}
      {p.status === 'suspended' ? (
        <p className="message message-error" data-testid="suspended-note">
          <strong>{t('reasonSuspended')}: </strong>
          {p.suspended_reason ?? t('suspendedNoReason')}
        </p>
      ) : null}
      {live && pend ? (
        <p className="message message-ok">{pend.status === 'submitted' ? t('revision.inReviewLong') : pend.status === 'approved' ? t('revision.approvedLong') : t('revision.otherLong')}</p>
      ) : null}
      {(p.status === 'published' || p.status === 'unpublished') && !pend ? <p className="hint">{t('editKeepsLive')}</p> : null}
      {!supplierOk && sup.ok ? <p className="message message-error">{t('supplierNotApproved')}</p> : null}

      <div className="link-row">
        {editable ? (
          <Link href={`${base}/${pid}/edit`} locale={locale} className="btn btn-primary">
            {live ? t('editLive') : t('edit')}
          </Link>
        ) : null}
        <Link href={`${base}/${pid}/preview`} locale={locale} className="btn btn-secondary">
          {t('preview')}
        </Link>
      </div>

      {canSubmit ? (
        <PartnerForm action={submitProductAction} submitLabel={tc('buttons.submitForReview')} variant="primary" reloadHref={`/${locale}${base}/${pid}`}>
          {hidden}
          <input type="hidden" name="expectedVersion" value={p.draft_version} />
          <p className="hint">{t('submitHint')}</p>
        </PartnerForm>
      ) : null}
      {canPublish ? (
        <PartnerForm action={publishProductAction} submitLabel={live && pend?.status === 'approved' ? t('publishNew') : t('publish')} variant="primary" reloadHref={`/${locale}${base}/${pid}`}>
          {hidden}
          <input type="hidden" name="expectedVersion" value={p.version} />
          <p className="hint">{t('publishHint')}</p>
        </PartnerForm>
      ) : null}
      {canUnpublish ? (
        <PartnerForm action={unpublishProductAction} submitLabel={t('unpublish')} variant="secondary">
          {hidden}
          <p className="hint">{t('unpublishHint')}</p>
        </PartnerForm>
      ) : null}

      <h2>{t('historyTitle')}</h2>
      {p.revisions.length === 0 ? (
        <p>{t('noRevisions')}</p>
      ) : (
        <ol className="timeline" data-testid="revisions">
          {[...p.revisions]
            .sort((a, b) => b.rev_no - a.rev_no)
            .map((x) => (
              <li key={x.id}>
                <strong>{t('revisionNo', { n: x.rev_no })}</strong> &middot; {t(`revisionStatus.${x.status}`)}
                {x.decided_at ? <span className="muted"> &middot; {when(x.decided_at)}</span> : null}
                {x.reason ? <p style={{ margin: '2px 0 0' }}>{x.reason}</p> : null}
              </li>
            ))}
        </ol>
      )}
    </>
  );
}
