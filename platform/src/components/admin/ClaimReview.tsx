import { getFormatter, getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import StatusChip from '@/components/StatusChip';
import { scanNowAction, startReviewAction } from '@/app/[locale]/admin/verification/actions';
import type { Db } from '@/server/services/result';
import { getClaim, getOrgName, listAttachedDocuments, listEvents } from '@/server/services/verification';
import DecisionForm from './DecisionForm';

/** One verification claim for a reviewer: snapshot, owner note, documents, decision, history. Used by the full page and by the queue drawer. */
export default async function ClaimReview({ claimId, locale, db, canDecide, headingLevel = 2 }: { claimId: string; locale: string; db: Db; canDecide: boolean; headingLevel?: 1 | 2 }) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const claim = await getClaim(db, claimId);
  if (!claim) return <p className="message message-error">{t('adm2.noClaim')}</p>;
  const [orgName, docs, events] = await Promise.all([getOrgName(db, claim.org_id), listAttachedDocuments(db, claim.id, claim.version), listEvents(db, [claim.id])]);
  const open = claim.status === 'submitted' || claim.status === 'in_review';
  const H = headingLevel === 1 ? 'h1' : 'h2';
  // Sections sit one level below the title: h2 on the full page, h3 inside the queue drawer.
  const S = headingLevel === 1 ? 'h2' : 'h3';
  const hiddenIds = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="claimId" value={claim.id} />
    </>
  );
  const fields = t.raw('adminVer.fields') as Record<string, string>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <H style={{ margin: 0, fontSize: '1.4rem' }}>
          {orgName} &middot; {t(`claimTypes.${claim.claim_type}`)}
        </H>
        <p style={{ margin: '6px 0 0' }}>
          <StatusChip status={claim.status} label={t(`claimStatus.${claim.status}`)} /> &middot; {t('adminVer.version', { n: claim.version })}
        </p>
      </div>

      <section>
        <S style={{ margin: '0 0 8px' }}>{t('adminVer.snapshotTitle')}</S>
        <dl className="dl">
          {Object.entries(claim.snapshot ?? {}).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k in fields ? t(`adminVer.fields.${k}`) : k}</dt>
              <dd>{v === null ? '-' : String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <S style={{ margin: '0 0 8px' }}>{t('adminVer.ownerNote')}</S>
        <div className="notice">{claim.owner_note ?? t('adminVer.noNote')}</div>
        {claim.decision_reason ? (
          <p>
            <strong>{t('adminVer.decisionReason')}:</strong> {claim.decision_reason}
          </p>
        ) : null}
      </section>

      <section>
        <S style={{ margin: '0 0 8px' }}>{t('adminVer.docsTitle')}</S>
        {docs.length === 0 ? (
          <p>{t('adminVer.noDocs')}</p>
        ) : (
          <ul className="card-list">
            {docs.map((d) => (
              <li key={d.id} className="card" style={{ boxShadow: 'none' }}>
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
        {docs.some((d) => d.scan_status === 'pending' || d.scan_status === 'failed') ? <ActionForm action={scanNowAction} submitLabel={t('adminVer.scanNow')} variant="secondary" className="inline-form" /> : null}
      </section>

      {claim.status === 'submitted' ? (
        <ActionForm action={startReviewAction} submitLabel={t('adminVer.startReview')} variant="secondary">
          {hiddenIds}
        </ActionForm>
      ) : null}

      {open && canDecide ? (
        <section>
          <h3 style={{ margin: '0 0 8px' }}>{t('adminVer.decisionTitle')}</h3>
          <DecisionForm claimId={claim.id} version={claim.version} />
        </section>
      ) : open ? (
        <p className="muted">{t('adminVer.readOnly')}</p>
      ) : null}

      <section>
        <S style={{ margin: '0 0 8px' }}>{t('adminVer.historyTitle')}</S>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <strong>{t(`events.${e.event}`)}</strong>
              <br />
              <span className="muted">{fmt.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
