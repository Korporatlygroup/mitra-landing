'use client';

import { useTranslations } from 'next-intl';
import { removeSupplierDocumentAction } from '@/app/[locale]/orgs/[id]/partner/suppliers/actions';
import StatusChip from '@/components/StatusChip';
import { SUPPLIER_DOC_TYPE_LIST } from '@/lib/schemas';
import type { SupplierDocument } from '@/server/services/p5-types';
import FileUploader from './FileUploader';
import PartnerForm from './PartnerForm';

const MAX_BYTES = 10 * 1024 * 1024;
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Evidence upload and list for one supplier. Uploading a document does not mean MITRA has checked it: the scan status only says whether the
 * file passed the safety check. Documents already sent for review are locked and cannot be removed.
 */
export default function SupplierDocuments({ orgId, supplierId, docs, canEdit, locale }: { orgId: string; supplierId: string; docs: SupplierDocument[]; canEdit: boolean; locale: string }) {
  const t = useTranslations('p5partner.docs');
  const tc = useTranslations('p5common');
  return (
    <div>
      {docs.length === 0 ? <p>{t('none')}</p> : null}
      {docs.length > 0 ? (
        <ul className="card-list" aria-label={t('listLabel')}>
          {docs.map((d) => (
            <li key={d.id} className="card" data-testid="supplier-doc">
              <p style={{ margin: 0 }}>
                <strong>{d.display_name}</strong>
              </p>
              <p className="muted" style={{ margin: '0 0 6px' }}>
                {tc(`docTypes.${d.doc_type}`)} &middot; {kb(d.size_bytes)}
              </p>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip status={d.scan_status === 'clean' ? 'approved' : d.scan_status === 'infected' ? 'rejected' : 'needs_info'} label={tc(`status.scan.${d.scan_status}`)} />
                {d.locked ? <span className="muted"> &middot; {t('locked')}</span> : null}
              </p>
              {d.scan_status === 'pending' ? <p className="hint">{t('pendingHint')}</p> : null}
              <div className="link-row">
                {d.scan_status === 'clean' ? (
                  <a href={`/api/v1/suppliers/${supplierId}/documents/${d.id}`} className="btn btn-secondary">
                    {t('download')}
                  </a>
                ) : null}
              </div>
              {canEdit && !d.locked ? (
                <PartnerForm action={removeSupplierDocumentAction} submitLabel={t('remove')} variant="danger" className="inline-form">
                  <input type="hidden" name="docId" value={d.id} />
                </PartnerForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <FileUploader
          endpoint={`/api/v1/suppliers/${supplierId}/documents`}
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
          types={['application/pdf', 'image/png', 'image/jpeg']}
          typesLabel="PDF, PNG, JPEG"
          maxBytes={MAX_BYTES}
          label={t('fileLabel')}
          hint={t('fileHint')}
          button={t('upload')}
          successText={(s) => (s === 'clean' ? t('uploadedClean') : t('uploadedPending'))}
        >
          <div className="field">
            <label htmlFor={`doctype-${orgId}`}>{t('typeLabel')}</label>
            <select id={`doctype-${orgId}`} name="docType" defaultValue="business_registration">
              {SUPPLIER_DOC_TYPE_LIST.map((x) => (
                <option key={x} value={x}>
                  {tc(`docTypes.${x}`)}
                </option>
              ))}
            </select>
          </div>
        </FileUploader>
      ) : null}
      <p className="hint" lang={locale}>
        {t('notVerification')}
      </p>
    </div>
  );
}
