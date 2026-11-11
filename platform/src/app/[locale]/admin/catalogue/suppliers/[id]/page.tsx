import { getFormatter, getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { TextArea } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
import CatalogueAdminNav from '@/components/admin-catalogue/CatalogueAdminNav';
import NoAccess from '@/components/admin-catalogue/NoAccess';
import { Link } from '@/i18n/navigation';
import { reviewedSummary } from '@/lib/p5-format';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { getSupplier } from '@/server/services/p5-partner';
import { SUPPLIER_REVIEW_CHECKS, type SupplierDraftData } from '@/server/services/p5-types';
import { notFound } from 'next/navigation';
import { reviewSupplierAction, suspendAction } from '../../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5admin.suppliers.detail.title');
}

export default async function AdminSupplierPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const ctx = await requireCatalogueAdmin(locale, `/admin/catalogue/suppliers/${id}`);
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const c = await getTranslations({ locale, namespace: 'p5common' });
  const fmt = await getFormatter({ locale });
  const cT = (k: string, v?: Record<string, string | number>) => c(k as never, v as never);
  if (!ctx.canReviewSuppliers) return <NoAccess locale={locale} title={t('suppliers.detail.title')} />;

  const res = await getSupplier(ctx.session.supabase, id);
  const back = (
    <p>
      <Link href="/admin/catalogue/suppliers" locale={locale}>
        {t('suppliers.detail.back')}
      </Link>
    </p>
  );
  if (!res.ok) {
    return (
      <>
        {back}
        <h1>{t('suppliers.detail.title')}</h1>
        <p role="alert" className="message message-error" data-testid="supplier-unavailable">
          <strong>{t('common.error')}: </strong>
          {t('suppliers.detail.unavailable')}
        </p>
      </>
    );
  }
  const s = res.data;
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC', timeZoneName: 'short' });
  const pending = s.draft_submitted_version !== null;
  const d: SupplierDraftData = s.draft ?? {};
  const live = s.live;
  const hasLive = Boolean(live && live.name);
  const dash = t('common.none');
  const category = (slug?: string | null) => (slug ? (c.has(`categories.${slug}`) ? c(`categories.${slug}`) : slug) : dash);
  const kb = (bytes: number) => t('common.kb', { n: fmt.number(Math.max(1, Math.round(bytes / 1024))) });

  const publicFields = (v: { name?: string | null; country?: string | null; state_city?: string | null; main_category?: string | null; description?: string | null; capabilities?: string[] | null }) => (
    <dl className="dl">
      <dt>{t('suppliers.detail.fields.name')}</dt>
      <dd>{v.name || dash}</dd>
      <dt>{t('suppliers.detail.fields.country')}</dt>
      <dd>{v.country || dash}</dd>
      <dt>{t('suppliers.detail.fields.stateCity')}</dt>
      <dd>{v.state_city || dash}</dd>
      <dt>{t('suppliers.detail.fields.category')}</dt>
      <dd>{category(v.main_category)}</dd>
      <dt>{t('suppliers.detail.fields.description')}</dt>
      <dd>{v.description || dash}</dd>
      <dt>{t('suppliers.detail.fields.capabilities')}</dt>
      <dd>{v.capabilities && v.capabilities.length > 0 ? v.capabilities.join(', ') : dash}</dd>
    </dl>
  );

  const hidden = (decision: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="supplierId" value={s.id} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="expectedVersion" value={String(s.draft_submitted_version ?? 0)} />
    </>
  );

  return (
    <>
      {back}
      <h1>{s.name ?? s.code}</h1>
      <CatalogueAdminNav locale={locale} ctx={ctx} current="suppliers" />
      <p>
        <StatusChip status={s.status} label={c(`status.supplier.${s.status}`)} />{' '}
        {pending ? <span className="chip adm-count">{t('suppliers.awaitingDecision')}</span> : null}
      </p>
      <dl className="dl">
        <dt>{t('suppliers.code')}</dt>
        <dd>{s.code}</dd>
        <dt>{t('suppliers.submittedOn')}</dt>
        <dd>{s.submitted_at ? when(s.submitted_at) : dash}</dd>
        {s.decision_reason ? (
          <>
            <dt>{t('suppliers.detail.lastReason')}</dt>
            <dd>{s.decision_reason}</dd>
          </>
        ) : null}
        {s.suspended_reason ? (
          <>
            <dt>{t('suppliers.detail.suspendedReason')}</dt>
            <dd>{s.suspended_reason}</dd>
          </>
        ) : null}
      </dl>
      {s.reviewed_at ? (
        <p data-testid="supplier-reviewed">{reviewedSummary(cT, { checks: s.review_checks, reviewed_at: s.reviewed_at }, locale)}</p>
      ) : null}

      <h2>{pending ? t('suppliers.detail.submittedHeading') : t('suppliers.detail.draftHeading')}</h2>
      {publicFields(d)}
      {hasLive && pending ? (
        <>
          <h2>{t('suppliers.detail.liveHeading')}</h2>
          <p className="muted">{t('suppliers.detail.liveNote')}</p>
          {publicFields(live)}
        </>
      ) : null}

      <h2>{t('suppliers.detail.contactHeading')}</h2>
      <p className="muted">{t('suppliers.detail.contactNote')}</p>
      {s.private ? (
        <dl className="dl" data-testid="supplier-private">
          <dt>{t('suppliers.detail.fields.contactName')}</dt>
          <dd>{s.private.contact_name || dash}</dd>
          <dt>{t('suppliers.detail.fields.contactEmail')}</dt>
          <dd>{s.private.contact_email || dash}</dd>
          <dt>{t('suppliers.detail.fields.contactPhone')}</dt>
          <dd>{s.private.contact_phone || dash}</dd>
          <dt>{t('suppliers.detail.fields.registrationId')}</dt>
          <dd>{s.private.registration_id || dash}</dd>
          <dt>{t('suppliers.detail.fields.website')}</dt>
          <dd>{s.private.website || dash}</dd>
        </dl>
      ) : (
        <p>{t('suppliers.detail.noContact')}</p>
      )}

      <h2>{t('suppliers.detail.docsHeading')}</h2>
      <p className="muted">{t('suppliers.detail.docsNote')}</p>
      {s.documents.length === 0 ? (
        <p>{t('suppliers.detail.noDocs')}</p>
      ) : (
        <ul className="card-list" data-testid="supplier-docs">
          {s.documents.map((doc) => (
            <li key={doc.id} className="card" data-testid="supplier-doc">
              <strong>{doc.display_name}</strong>
              <br />
              {c(`docTypes.${doc.doc_type}`)} &middot; {kb(doc.size_bytes)} &middot; {doc.mime_type}
              <br />
              <StatusChip status={doc.scan_status === 'clean' ? 'approved' : doc.scan_status === 'infected' ? 'rejected' : 'pending'} label={c(`status.scan.${doc.scan_status}`)} />
              <br />
              {doc.scan_status === 'clean' ? (
                <a href={`/api/v1/suppliers/${s.id}/documents/${doc.id}`}>{t('suppliers.detail.openDoc')}</a>
              ) : (
                <span className="muted">{t('suppliers.detail.docNotOpen')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>{t('suppliers.detail.historyHeading')}</h2>
      {s.events.length === 0 ? (
        <p>{t('suppliers.detail.noHistory')}</p>
      ) : (
        <ol className="timeline" data-testid="supplier-events">
          {s.events.map((e, i) => (
            <li key={i} data-testid="supplier-event" data-kind={e.kind}>
              <strong>{t.has(`suppliers.events.${e.kind}`) ? t(`suppliers.events.${e.kind}`) : e.kind}</strong> &middot; {when(e.at)}
              {e.reason ? (
                <>
                  <br />
                  <span>
                    {t('common.reason')}: {e.reason}
                  </span>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {pending ? (
        <section aria-labelledby="decide-h">
          <h2 id="decide-h">{t('suppliers.detail.decideHeading')}</h2>
          <p>{t('suppliers.detail.decideIntro')}</p>

          <div className="card">
            <h3>{t('suppliers.detail.approveHeading')}</h3>
            <ActionForm action={reviewSupplierAction} submitLabel={t('suppliers.detail.approveButton')}>
              {hidden('approve')}
              <fieldset>
                <legend>{t('suppliers.detail.checksLegend')}</legend>
                <p className="hint">{t('suppliers.detail.checksHint')}</p>
                {SUPPLIER_REVIEW_CHECKS.map((k) => (
                  <div key={k} className="field check">
                    <input id={`chk-${k}`} name="checks" type="checkbox" value={k} />
                    <label htmlFor={`chk-${k}`}>{c(`verification.checks.${k}`)}</label>
                  </div>
                ))}
              </fieldset>
              <p className="hint">{t('suppliers.detail.approveDateNote')}</p>
              <TextArea id="approve-note" name="reason" label={t('suppliers.detail.noteOptional')} maxLength={1000} />
            </ActionForm>
          </div>

          <div className="card">
            <h3>{t('suppliers.detail.infoHeading')}</h3>
            <p className="hint">{t('suppliers.detail.infoHint')}</p>
            <ActionForm action={reviewSupplierAction} submitLabel={t('suppliers.detail.infoButton')} variant="secondary">
              {hidden('request_info')}
              <TextArea id="info-reason" name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
            </ActionForm>
          </div>

          <div className="card">
            <h3>{t('suppliers.detail.rejectHeading')}</h3>
            <p className="hint">{t('suppliers.detail.rejectHint')}</p>
            <ActionForm action={reviewSupplierAction} submitLabel={t('suppliers.detail.rejectButton')} variant="danger">
              {hidden('reject')}
              <TextArea id="reject-reason" name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
            </ActionForm>
          </div>
        </section>
      ) : null}

      {s.status === 'approved' ? (
        <section aria-labelledby="susp-h">
          <h2 id="susp-h">{t('suppliers.detail.suspendHeading')}</h2>
          <p>{t('suppliers.detail.suspendHint')}</p>
          <ActionForm action={suspendAction} submitLabel={t('suppliers.detail.suspendButton')} variant="danger">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="target" value="supplier" />
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="mode" value="suspend" />
            <TextArea id="susp-reason" name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
          </ActionForm>
        </section>
      ) : null}
      {s.status === 'suspended' ? (
        <section aria-labelledby="reinst-h">
          <h2 id="reinst-h">{t('suppliers.detail.reinstateHeading')}</h2>
          <p>{t('suppliers.detail.reinstateHint')}</p>
          <ActionForm action={suspendAction} submitLabel={t('suppliers.detail.reinstateButton')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="target" value="supplier" />
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="mode" value="reinstate" />
            <TextArea id="reinst-reason" name="reason" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
