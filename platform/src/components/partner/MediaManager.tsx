'use client';

import { useLocale, useTranslations } from 'next-intl';
import { removeMediaAction, updateMediaAction } from '@/app/[locale]/orgs/[id]/partner/products/actions';
import StatusChip from '@/components/StatusChip';
import type { MyProductMedia } from '@/server/services/p5-types';
import FileUploader from './FileUploader';
import PartnerForm from './PartnerForm';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Product pictures: upload with a preview of what is stored, a short description (alt text) for each, remove. A picture is only shown to
 * buyers after it passed the file check AND the product was approved with it; until then the partner sees it here and nowhere else.
 */
export default function MediaManager({ orgId, productId, media, canEdit }: { orgId: string; productId: string; media: MyProductMedia[]; canEdit: boolean }) {
  const t = useTranslations('p5partner.media');
  const tc = useTranslations('p5common');
  const locale = useLocale();
  return (
    <div>
      <p className="hint">{t('visibility')}</p>
      {media.length === 0 ? <p>{t('none')}</p> : null}
      <ul className="p5-grid" aria-label={t('listLabel')}>
        {media.map((m, i) => (
          <li key={m.id} className="card" data-testid="product-media">
            {m.scan_status === 'clean' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="p5-thumb" src={`/api/v1/catalogue-media/${m.id}`} alt={m.alt ?? ''} width={320} height={240} loading="lazy" />
            ) : (
              <p className="p5-thumb placeholder" role="img" aria-label={t('waitingAlt')}>
                {t('waiting')}
              </p>
            )}
            <p style={{ margin: '6px 0' }}>
              <StatusChip
                status={m.scan_status === 'clean' ? 'approved' : m.scan_status === 'infected' ? 'rejected' : 'needs_info'}
                label={tc(`status.scan.${(m.scan_status ?? 'pending') as 'pending'}`)}
              />
            </p>
            {canEdit ? (
              <>
                <PartnerForm action={updateMediaAction} submitLabel={t('saveAlt')} variant="secondary" className="form">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="orgId" value={orgId} />
                  <input type="hidden" name="mediaId" value={m.id} />
                  <input type="hidden" name="sort" value={m.sort ?? i} />
                  <div className="field">
                    <label htmlFor={`alt-${m.id}`}>{t('altLabel')}</label>
                    <p id={`alt-${m.id}-hint`} className="hint">
                      {t('altHint')}
                    </p>
                    <input id={`alt-${m.id}`} name="alt" type="text" defaultValue={m.alt ?? ''} maxLength={200} required aria-describedby={`alt-${m.id}-hint`} />
                  </div>
                </PartnerForm>
                <PartnerForm action={removeMediaAction} submitLabel={t('remove')} variant="danger" className="inline-form">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="orgId" value={orgId} />
                  <input type="hidden" name="mediaId" value={m.id} />
                </PartnerForm>
              </>
            ) : (
              <p className="muted">{m.alt}</p>
            )}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <FileUploader
          endpoint={`/api/v1/products/${productId}/media`}
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          types={['image/png', 'image/jpeg', 'image/webp']}
          typesLabel="PNG, JPEG, WebP"
          maxBytes={MAX_BYTES}
          label={t('fileLabel')}
          hint={t('fileHint')}
          button={t('upload')}
          successText={(s) => (s === 'clean' ? t('uploadedClean') : t('uploadedPending'))}
        >
          <div className="field">
            <label htmlFor="new-alt">{t('altLabel')}</label>
            <p id="new-alt-hint" className="hint">
              {t('altHint')}
            </p>
            <input id="new-alt" name="alt" type="text" maxLength={200} aria-describedby="new-alt-hint" />
          </div>
        </FileUploader>
      ) : null}
    </div>
  );
}
