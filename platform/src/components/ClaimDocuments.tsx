import { getTranslations } from 'next-intl/server';
import {
  removeDocumentAction,
  submitClaimAction,
  uploadDocumentAction,
  withdrawClaimAction,
} from '@/app/[locale]/orgs/[id]/business/actions';
import { CLAIM_DOC_TYPES, type ClaimType } from '@/lib/schemas';
import {
  EDITABLE_STATUSES,
  WITHDRAWABLE_STATUSES,
  type Claim,
  type DocumentRow,
} from '@/server/services/verification';
import ActionForm from './ActionForm';
import { FileField, SelectField, TextArea } from './Field';
import StatusChip from './StatusChip';

const SCAN_KEY: Record<DocumentRow['scan_status'], string> = {
  clean: 'scanClean',
  pending: 'scanPending',
  infected: 'scanInfected',
  failed: 'scanFailed',
};

/** Documents, upload, send-for-review and withdraw controls for one claim type (owner / manager view). */
export default async function ClaimDocuments({
  locale,
  orgId,
  claimType,
  claim,
  docs,
  canSubmit,
}: {
  locale: string;
  orgId: string;
  claimType: ClaimType;
  claim: Claim | null;
  docs: DocumentRow[];
  canSubmit: boolean;
}) {
  const t = await getTranslations({ locale });
  const status = claim?.status ?? 'none';
  const editable = EDITABLE_STATUSES.includes(status);
  const withdrawable = claim ? WITHDRAWABLE_STATUSES.includes(claim.status) : false;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="claimType" value={claimType} />
    </>
  );

  return (
    <section className="card" aria-labelledby={`claim-${claimType}`}>
      <h3 id={`claim-${claimType}`}>
        {t(`claimTypes.${claimType}`)} <StatusChip status={status} label={t(`claimStatus.${status}`)} />
      </h3>

      {docs.length === 0 ? (
        <p>{t('documents.none')}</p>
      ) : (
        <ul className="card-list">
          {docs.map((d) => (
            <li key={d.id} className="card">
              <p style={{ margin: 0 }}>
                <strong>{d.display_name}</strong> &middot; {t(`docTypes.${d.doc_type}`)}
              </p>
              <p style={{ margin: '4px 0' }}>{t(`documents.${SCAN_KEY[d.scan_status]}`)}</p>
              <p className="link-row">
                {d.scan_status === 'clean' ? <a href={`/api/v1/documents/${d.id}`}>{t('documents.download')}</a> : null}
              </p>
              {canSubmit && editable ? (
                <ActionForm action={removeDocumentAction} submitLabel={t('ob.s5.remove')} variant="danger" className="inline-form">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="orgId" value={orgId} />
                  <input type="hidden" name="docId" value={d.id} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canSubmit && editable ? (
        <>
          <ActionForm action={uploadDocumentAction} submitLabel={t('ob.s5.upload')} variant="secondary">
            {hidden}
            <SelectField id={`dt-${claimType}`} name="docType" label={t('ob.s5.docType')}>
              {CLAIM_DOC_TYPES[claimType].map((dt) => (
                <option key={dt} value={dt}>
                  {t(`docTypes.${dt}`)}
                </option>
              ))}
            </SelectField>
            <FileField
              id={`file-${claimType}`}
              name="file"
              label={t('ob.s5.file')}
              hint={t('ob.s5.fileHint')}
              accept="application/pdf,image/png,image/jpeg"
            />
          </ActionForm>

          <ActionForm action={submitClaimAction} submitLabel={claim && claim.version > 0 ? t('ver.resubmit') : t('ob.s5.submit')}>
            {hidden}
            <TextArea id={`note-${claimType}`} name="note" label={t('ob.s5.noteLabel')} hint={t('ob.s5.noteHint')} maxLength={1000} />
          </ActionForm>
        </>
      ) : null}

      {canSubmit && withdrawable && claim ? (
        <ActionForm action={withdrawClaimAction} submitLabel={t('ver.withdraw')} variant="danger" className="inline-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="claimId" value={claim.id} />
        </ActionForm>
      ) : null}
      {!editable && !withdrawable ? <p className="muted">{t('ob.s5.alreadySent')}</p> : null}
    </section>
  );
}
