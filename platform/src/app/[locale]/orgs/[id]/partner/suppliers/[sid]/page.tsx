import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import PartnerForm from '@/components/partner/PartnerForm';
import PartnerGate from '@/components/partner/PartnerGate';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { reviewedSummary } from '@/lib/p5-format';
import { statusTone, supplierEditable, supplierMissing, supplierUnderReview } from '@/lib/partner-ui';
import { uuidSchema } from '@/lib/schemas';
import { requirePartnerContext } from '@/server/partner-context';
import { getSupplier } from '@/server/services/p5-partner';
import { withdrawSupplierAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.suppliers.detailTitle');
}

const REVIEW_EVENTS = new Set(['approved', 'rejected', 'more_info_requested']);

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string; sid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id, sid } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(sid).success) notFound();
  const ctx = await requirePartnerContext(locale, id, `/suppliers/${sid}`);
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const r = await getSupplier(ctx.session.supabase, sid);
  if (!r.ok || r.data.partner_org_id !== id) notFound();
  const d = r.data;

  const t = await getTranslations({ locale, namespace: 'p5partner.suppliers' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const fmt = await getFormatter({ locale });
  const base = `/orgs/${id}/partner`;
  const underReview = supplierUnderReview(d);
  const editable = ctx.canManageSuppliers && supplierEditable(d.status, underReview);
  const missing = supplierMissing(d);
  const lastReview = [...d.events].reverse().find((e) => REVIEW_EVENTS.has(e.kind));
  // For an approved supplier the stored reason is about the last revision only when that revision was not approved.
  const reasonToShow =
    d.status === 'more_info_needed' || d.status === 'rejected'
      ? d.decision_reason
      : d.status === 'approved' && lastReview && lastReview.kind !== 'approved'
        ? (lastReview.reason ?? d.decision_reason)
        : null;
  const live = d.live;
  const priv = d.private;
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

  return (
    <>
      <p>
        <Link href={`${base}/suppliers`} locale={locale}>
          {tt('backTo', { page: t('title') })}
        </Link>
      </p>
      <h1>{d.name ?? t('unnamed')}</h1>
      <p>
        <StatusChip status={statusTone(d.status)} label={tc(`status.supplier.${d.status}`)} /> <span className="muted">&middot; {t('code')}: {d.code}</span>
      </p>
      {sp.sent ? (
        <p className="message message-ok" role="status" data-testid="sent-banner">
          {t('sent')}
        </p>
      ) : null}

      {sp.withdrawn ? (
        <p className="message message-ok" role="status" data-testid="withdrawn-banner">
          {t('withdrawn')}
        </p>
      ) : null}

      <p className="next-step" data-testid="status-explain">
        {t(`explain.${d.status}`)}
      </p>
      {reasonToShow ? (
        <div className="message message-error" data-testid="admin-reason">
          <p style={{ margin: 0 }}>
            <strong>{d.status === 'approved' ? t('reasonRevision') : d.status === 'rejected' ? t('reasonRejected') : t('reasonInfo')}: </strong>
            {reasonToShow}
          </p>
        </div>
      ) : null}
      {d.status === 'suspended' && d.suspended_reason ? (
        <p className="message message-error">
          <strong>{t('reasonSuspended')}: </strong>
          {d.suspended_reason}
        </p>
      ) : null}
      {d.status === 'approved' && underReview ? <p className="message message-ok">{t('revisionInReview')}</p> : null}
      {d.status === 'approved' && !underReview && d.has_unsubmitted_changes ? <p className="message message-ok">{t('unsentChangesLong')}</p> : null}
      {d.status === 'approved' ? <p className="hint">{t('liveStaysNote')}</p> : null}

      <div className="link-row">
        {editable ? (
          <Link href={`${base}/suppliers/${sid}/edit?step=1`} locale={locale} className="btn btn-primary">
            {d.status === 'approved' ? t('editApproved') : t('edit')}
          </Link>
        ) : null}
        {editable && missing.length === 0 && d.status !== 'approved' ? (
          <Link href={`${base}/suppliers/${sid}/edit?step=4`} locale={locale} className="btn btn-secondary">
            {tc('buttons.submitForReview')}
          </Link>
        ) : null}
        {editable && d.status === 'approved' && d.has_unsubmitted_changes && missing.length === 0 ? (
          <Link href={`${base}/suppliers/${sid}/edit?step=4`} locale={locale} className="btn btn-secondary">
            {t('sendChanges')}
          </Link>
        ) : null}
        {d.status === 'approved' && ctx.canManageCatalogue ? (
          <Link href={`${base}/products/new?supplier=${sid}`} locale={locale} className="btn btn-secondary">
            {tc('buttons.addProduct')}
          </Link>
        ) : null}
      </div>
      {ctx.canManageSuppliers && d.status === 'awaiting_review' ? (
        <PartnerForm action={withdrawSupplierAction} submitLabel={t('withdraw')} variant="secondary" className="form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="orgId" value={id} />
          <input type="hidden" name="supplierId" value={sid} />
          <p className="hint">{t('withdrawHint')}</p>
        </PartnerForm>
      ) : null}

      <h2>{t('detailsTitle')}</h2>
      <dl className="dl">
        <dt>{t('fields.name')}</dt>
        <dd>{d.draft.name ?? live.name ?? '-'}</dd>
        <dt>{t('fields.country')}</dt>
        <dd>{[d.draft.country, d.draft.state_city].filter(Boolean).join(', ') || '-'}</dd>
        <dt>{t('fields.category')}</dt>
        <dd>{d.draft.main_category ? tc(`categories.${d.draft.main_category}`) : '-'}</dd>
        <dt>{t('fields.description')}</dt>
        <dd>{d.draft.description ?? '-'}</dd>
        <dt>{t('fields.capabilities')}</dt>
        <dd>{(d.draft.capabilities ?? []).join(', ') || '-'}</dd>
      </dl>

      <h2>{t('privateTitle')}</h2>
      <p className="hint">{t('privateNote')}</p>
      <dl className="dl">
        <dt>{t('fields.contactName')}</dt>
        <dd>{priv?.contact_name ?? '-'}</dd>
        <dt>{t('fields.contactEmail')}</dt>
        <dd>{priv?.contact_email ?? '-'}</dd>
        <dt>{t('fields.contactPhone')}</dt>
        <dd>{priv?.contact_phone ?? '-'}</dd>
        <dt>{t('fields.registration')}</dt>
        <dd>{priv?.registration_id || t('notProvided')}</dd>
        <dt>{t('fields.website')}</dt>
        <dd>{priv?.website ?? '-'}</dd>
      </dl>

      <h2>{t('docsTitle')}</h2>
      {d.documents.length === 0 ? (
        <p>{t('noDocs')}</p>
      ) : (
        <ul className="card-list">
          {d.documents.map((x) => (
            <li key={x.id} className="card">
              <strong>{x.display_name}</strong> <span className="muted">&middot; {tc(`docTypes.${x.doc_type}`)}</span>
              <p style={{ margin: '4px 0 0' }}>
                <StatusChip status={x.scan_status === 'clean' ? 'approved' : x.scan_status === 'infected' ? 'rejected' : 'needs_info'} label={tc(`status.scan.${x.scan_status}`)} />
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">{t('docsNote')}</p>

      <h2>{t('reviewTitle')}</h2>
      <p>{reviewedSummary(tc as never, { checks: d.review_checks, reviewed_at: d.reviewed_at }, locale)}</p>
      <p className="hint">{tc('verification.scope')}</p>

      <h2>{t('historyTitle')}</h2>
      {d.events.length === 0 ? (
        <p>{t('noEvents')}</p>
      ) : (
        <ol className="timeline" aria-label={t('historyTitle')} data-testid="supplier-events">
          {d.events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <strong>{t(`events.${KNOWN_EVENTS.has(e.kind) ? e.kind : 'other'}`)}</strong>
              <span className="muted"> &middot; {when(e.at)}</span>
              {e.from_status && e.to_status && e.from_status !== e.to_status ? (
                <span className="muted">
                  {' '}
                  &middot; {tc(`status.supplier.${e.from_status}`)} &rarr; {tc(`status.supplier.${e.to_status}`)}
                </span>
              ) : null}
              {e.reason ? <p style={{ margin: '2px 0 0' }}>{e.reason}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

const KNOWN_EVENTS = new Set(['submitted', 'resubmitted', 'withdrawn', 'approved', 'rejected', 'more_info_requested', 'suspended', 'reinstated', 'document_uploaded', 'document_removed']);
