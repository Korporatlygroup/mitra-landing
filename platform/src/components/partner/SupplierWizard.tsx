import { getTranslations } from 'next-intl/server';
import {
  saveSupplierStep1Action,
  saveSupplierStep2Action,
  saveSupplierStep3Action,
  submitSupplierAction,
} from '@/app/[locale]/orgs/[id]/partner/suppliers/actions';
import { Link } from '@/i18n/navigation';
import { supplierMissing, supplierUnderReview } from '@/lib/partner-ui';
import { PRODUCT_CATEGORY_SLUGS } from '@/lib/schemas';
import type { SupplierDetail } from '@/server/services/p5-types';
import { CheckInput, SelectInput, TextAreaInput, TextInput } from './fields';
import PartnerForm from './PartnerForm';
import SupplierDocuments from './SupplierDocuments';

export const SUPPLIER_STEPS = 4;

/** The four-step supplier form. `detail` is null while creating (step 1 only). Contact fields are private and labelled as such. */
export default async function SupplierWizard({ locale, orgId, detail, step }: { locale: string; orgId: string; detail: SupplierDetail | null; step: number }) {
  const t = await getTranslations({ locale, namespace: 'p5partner.supplierForm' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const base = `/orgs/${orgId}/partner/suppliers`;
  const sid = detail?.id;
  const draft = detail?.draft ?? {};
  const priv = detail?.private;
  const editBase = sid ? `${base}/${sid}/edit` : `${base}/new`;
  const reload = sid ? `/${locale}${editBase}?step=${step}` : undefined;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      {sid ? <input type="hidden" name="supplierId" value={sid} /> : null}
      {detail ? <input type="hidden" name="expectedVersion" value={detail.draft_version} /> : null}
    </>
  );
  const extra = [{ label: tc('buttons.saveDraft'), value: 'stay' }];
  const names = [t('s1.title'), t('s2.title'), t('s3.title'), t('s4.title')];
  const missing = detail ? supplierMissing(detail) : [];
  const approved = detail?.status === 'approved';
  const underReview = detail ? supplierUnderReview(detail) : false;

  const nav = (
    <nav aria-label={t('stepsLabel')}>
      <ol className="steps">
        {names.map((n, i) => (
          <li key={n} aria-current={i + 1 === step ? 'step' : undefined}>
            {sid ? (
              <Link href={`${editBase}?step=${i + 1}`} locale={locale}>
                {i + 1}. {n}
              </Link>
            ) : (
              <span>
                {i + 1}. {n}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );

  let body: React.ReactNode;
  if (step === 1) {
    body = (
      <PartnerForm action={saveSupplierStep1Action} submitLabel={t('saveContinue')} extra={extra} reloadHref={reload}>
        {hidden}
        {sid ? null : <TextInput id="code" name="code" label={t('s1.code')} hint={t('s1.codeHint')} optionalLabel={tt('optional')} maxLength={30} />}
        <TextInput id="name" name="name" label={t('s1.name')} hint={t('s1.nameHint')} defaultValue={draft.name ?? ''} required maxLength={160} />
        <TextInput id="country" name="country" label={t('s1.country')} defaultValue={draft.country ?? 'India'} required maxLength={60} />
        <TextInput id="state_city" name="state_city" label={t('s1.stateCity')} hint={t('s1.stateCityHint')} optionalLabel={tt('optional')} defaultValue={draft.state_city ?? ''} maxLength={100} />
        <SelectInput id="main_category" name="main_category" label={t('s1.category')} defaultValue={draft.main_category ?? ''} required>
          <option value="">{t('s1.categoryChoose')}</option>
          {PRODUCT_CATEGORY_SLUGS.map((s) => (
            <option key={s} value={s}>
              {tc(`categories.${s}`)}
            </option>
          ))}
        </SelectInput>
      </PartnerForm>
    );
  } else if (step === 2) {
    body = (
      <PartnerForm action={saveSupplierStep2Action} submitLabel={t('saveContinue')} extra={extra} reloadHref={reload}>
        {hidden}
        <TextAreaInput id="description" name="description" label={t('s2.description')} hint={t('s2.descriptionHint')} defaultValue={draft.description ?? ''} required maxLength={2000} rows={6} />
        <TextAreaInput id="capabilities" name="capabilities" label={t('s2.capabilities')} hint={t('s2.capabilitiesHint')} optionalLabel={tt('optional')} defaultValue={(draft.capabilities ?? []).join('\n')} rows={4} />
      </PartnerForm>
    );
  } else if (step === 3) {
    body = (
      <>
        <h3>{t('s3.contactTitle')}</h3>
        <p className="message message-ok" style={{ borderStyle: 'dashed' }}>
          {t('s3.privacy')}
        </p>
        <PartnerForm action={saveSupplierStep3Action} submitLabel={t('saveContinue')} extra={extra} reloadHref={reload}>
          {hidden}
          <TextInput id="contact_name" name="contact_name" label={t('s3.contactName')} defaultValue={priv?.contact_name ?? ''} maxLength={120} autoComplete="off" />
          <TextInput id="contact_email" name="contact_email" type="email" label={t('s3.contactEmail')} hint={t('s3.contactHint')} optionalLabel={tt('optional')} defaultValue={priv?.contact_email ?? ''} autoComplete="off" />
          <TextInput id="contact_phone" name="contact_phone" type="tel" label={t('s3.contactPhone')} optionalLabel={tt('optional')} defaultValue={priv?.contact_phone ?? ''} autoComplete="off" />
          <TextInput id="registration_id" name="registration_id" label={t('s3.registration')} hint={t('s3.registrationHint')} optionalLabel={tt('optional')} defaultValue={priv?.registration_id ?? ''} maxLength={60} />
          <CheckInput id="registration_not_sure" name="registration_not_sure" label={t('s3.notSure')} />
          <TextInput id="website" name="website" type="url" label={t('s3.website')} hint={t('s3.websiteHint')} optionalLabel={tt('optional')} defaultValue={priv?.website ?? ''} maxLength={200} />
        </PartnerForm>
        <h3 id="evidence">{t('s3.docsTitle')}</h3>
        <p>{t('s3.docsIntro')}</p>
        {sid && detail ? <SupplierDocuments orgId={orgId} supplierId={sid} docs={detail.documents} canEdit={!underReview || approved} locale={locale} /> : null}
      </>
    );
  } else {
    body = detail ? (
      <>
        <p>{t('s4.intro')}</p>
        <dl className="dl">
          <dt>{t('s1.name')}</dt>
          <dd>{draft.name ?? '-'}</dd>
          <dt>{t('s1.country')}</dt>
          <dd>{[draft.country, draft.state_city].filter(Boolean).join(', ') || '-'}</dd>
          <dt>{t('s1.category')}</dt>
          <dd>{draft.main_category ? tc(`categories.${draft.main_category}`) : '-'}</dd>
          <dt>{t('s2.description')}</dt>
          <dd>{draft.description ?? '-'}</dd>
          <dt>{t('s2.capabilities')}</dt>
          <dd>{(draft.capabilities ?? []).join(', ') || '-'}</dd>
          <dt>{t('s3.contactName')}</dt>
          <dd>{priv?.contact_name ?? '-'}</dd>
          <dt>{t('s3.registration')}</dt>
          <dd>{priv?.registration_id || t('s3.notProvided')}</dd>
          <dt>{t('s3.docsTitle')}</dt>
          <dd>{detail.documents.length}</dd>
        </dl>
        <p className="hint">{t('s4.privateNote')}</p>
        {missing.length > 0 ? (
          <div className="message message-error" role="status">
            <p style={{ margin: '0 0 6px' }}>
              <strong>{t('s4.missingTitle')}</strong>
            </p>
            <ul style={{ margin: 0 }}>
              {missing.map((m) => (
                <li key={m}>{t(`missing.${m}`)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {approved ? <p className="hint">{t('s4.approvedNote')}</p> : null}
        {underReview ? (
          <p className="message message-ok">{t('s4.alreadyUnderReview')}</p>
        ) : missing.length === 0 ? (
          <PartnerForm action={submitSupplierAction} submitLabel={approved ? t('s4.submitChanges') : tc('buttons.submitForReview')} reloadHref={reload}>
            {hidden}
          </PartnerForm>
        ) : null}
      </>
    ) : null;
  }

  return (
    <>
      <p id="progress-label">
        <strong>{tt('stepOf', { n: step, total: SUPPLIER_STEPS })}</strong>
      </p>
      <progress max={SUPPLIER_STEPS} value={step} aria-labelledby="progress-label" />
      {nav}
      <h2 style={{ marginTop: '1rem' }}>{names[step - 1]}</h2>
      {body}
      <p className="link-row">
        {step > 1 && sid ? (
          <Link href={`${editBase}?step=${step - 1}`} locale={locale} className="btn btn-secondary">
            {tt('previous')}
          </Link>
        ) : null}
        {step > 1 && step < SUPPLIER_STEPS && sid ? (
          <Link href={`${editBase}?step=${step + 1}`} locale={locale} className="btn btn-secondary">
            {tt('skipStep')}
          </Link>
        ) : null}
      </p>
    </>
  );
}
