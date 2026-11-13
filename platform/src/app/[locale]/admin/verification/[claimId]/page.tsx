import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { TextArea } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { requireReviewer } from '@/server/reviewer';
import {
  getClaim,
  getOrgName,
  listAttachedDocuments,
  listEvents,
} from '@/server/services/verification';
import { decideAction, scanNowAction, startReviewAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adminVer.title');
}

export default async function AdminClaimPage({ params }: { params: Promise<{ locale: string; claimId: string }> }) {
  const { locale, claimId } = await params;
  if (!uuidSchema.safeParse(claimId).success) notFound();
  const { session, canReview, canDecide } = await requireReviewer(locale, `/admin/verification/${claimId}`);
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });

  if (!canReview) {
    return (
      <p role="alert" className="message message-error">
        {t('adminVer.noAccess')}
      </p>
    );
  }

  const db = session.supabase;
  const claim = await getClaim(db, claimId);
  if (!claim) notFound();
  const [orgName, docs, events] = await Promise.all([
    getOrgName(db, claim.org_id),
    listAttachedDocuments(db, claim.id, claim.version),
    listEvents(db, [claim.id]),
  ]);
  const open = claim.status === 'submitted' || claim.status === 'in_review';
  const hiddenIds = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="claimId" value={claim.id} />
    </>
  );

  return (
    <>
      <p>
        <Link href="/admin/verification" locale={locale}>
          {t('adminVer.back')}
        </Link>
      </p>
      <h1>
        {orgName} &middot; {t(`claimTypes.${claim.claim_type}`)}
      </h1>
      <p>
        <StatusChip status={claim.status} label={t(`claimStatus.${claim.status}`)} /> &middot; {t('adminVer.version', { n: claim.version })}
      </p>

      <h2>{t('adminVer.snapshotTitle')}</h2>
      <dl className="dl">
        {Object.entries(claim.snapshot ?? {}).map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k in (t.raw('adminVer.fields') as Record<string, string>) ? t(`adminVer.fields.${k}`) : k}</dt>
            <dd>{v === null ? '-' : String(v)}</dd>
          </div>
        ))}
      </dl>

      <h2>{t('adminVer.ownerNote')}</h2>
      <p>{claim.owner_note ?? t('adminVer.noNote')}</p>
      {claim.decision_reason ? (
        <p>
          <strong>{t('adminVer.decisionReason')}:</strong> {claim.decision_reason}
        </p>
      ) : null}

      <h2>{t('adminVer.docsTitle')}</h2>
      {docs.length === 0 ? (
        <p>{t('adminVer.noDocs')}</p>
      ) : (
        <ul className="card-list">
          {docs.map((d) => (
            <li key={d.id} className="card">
              <strong>{d.display_name}</strong> &middot; {t(`docTypes.${d.doc_type}`)}
              <br />
              {t('adminVer.scan')}: {t(`documents.${{ clean: 'scanClean', pending: 'scanPending', infected: 'scanInfected', failed: 'scanFailed' }[d.scan_status]}`)}
              <br />
              {d.scan_status === 'clean' ? <a href={`/api/v1/documents/${d.id}`}>{t('adminVer.download')}</a> : null}
            </li>
          ))}
        </ul>
      )}
      {open && docs.length > 0 && docs.some((d) => d.scan_status !== 'clean') ? (
        <p role="alert" className="message message-error">
          <strong>{t('common.error')}: </strong>
          {t('adminVer.evidenceWarning')}
        </p>
      ) : null}
      {docs.some((d) => d.scan_status === 'pending' || d.scan_status === 'failed') ? (
        <ActionForm action={scanNowAction} submitLabel={t('adminVer.scanNow')} variant="secondary" className="inline-form" />
      ) : null}

      {claim.status === 'submitted' ? (
        <ActionForm action={startReviewAction} submitLabel={t('adminVer.startReview')} variant="secondary">
          {hiddenIds}
        </ActionForm>
      ) : null}

      {open && canDecide ? (
        <>
          <h2>{t('adminVer.decisionTitle')}</h2>
          <ActionForm action={decideAction} submitLabel={t('adminVer.saveDecision')}>
            {hiddenIds}
            <input type="hidden" name="expectedVersion" value={claim.version} />
            <fieldset>
              <legend>{t('adminVer.decisionTitle')}</legend>
              <div className="radio">
                <input id="d-approve" type="radio" name="decision" value="approve" required />
                <label htmlFor="d-approve">{t('adminVer.approve')}</label>
              </div>
              <div className="radio">
                <input id="d-reject" type="radio" name="decision" value="reject" />
                <label htmlFor="d-reject">{t('adminVer.reject')}</label>
              </div>
              <div className="radio">
                <input id="d-info" type="radio" name="decision" value="request_info" />
                <label htmlFor="d-info">{t('adminVer.requestInfo')}</label>
              </div>
            </fieldset>
            <TextArea id="reason" name="reason" label={t('adminVer.reason')} hint={t('adminVer.reasonHint')} required maxLength={1000} />
          </ActionForm>
        </>
      ) : open ? (
        <p className="muted">{t('adminVer.readOnly')}</p>
      ) : null}

      <h2>{t('adminVer.historyTitle')}</h2>
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <strong>{t(`events.${e.event}`)}</strong>
            <br />
            <span className="muted">{fmt.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</span>
          </li>
        ))}
      </ol>
    </>
  );
}
