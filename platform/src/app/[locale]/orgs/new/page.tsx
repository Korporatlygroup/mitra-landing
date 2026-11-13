import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { requireSession } from '@/server/session';
import { createOrgAction } from './actions';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'orgs.newTitle');
}

export default async function NewOrgPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSession({ locale, path: '/orgs/new', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale, namespace: 'orgs' });

  return (
    <>
      <h1>{t('newTitle')}</h1>
      <ActionForm action={createOrgAction} submitLabel={t('submit')}>
        <input type="hidden" name="locale" value={locale} />
        <fieldset>
          <legend>{t('typeLabel')}</legend>
          <div className="radio">
            <input id="type-business" type="radio" name="type" value="business" defaultChecked required />
            <label htmlFor="type-business">{t('typeBusiness')}</label>
          </div>
          <div className="radio">
            <input id="type-buyer" type="radio" name="type" value="buyer" />
            <label htmlFor="type-buyer">{t('typeBuyer')}</label>
          </div>
          <div className="radio">
            <input id="type-partner" type="radio" name="type" value="partner" aria-describedby="type-partner-hint" />
            <label htmlFor="type-partner">{t('typePartner')}</label>
          </div>
          <p id="type-partner-hint" className="hint">
            {t('typePartnerHint')}
          </p>
        </fieldset>
        <Field id="name" name="name" label={t('nameLabel')} hint={t('nameHint')} required minLength={2} maxLength={160} />
      </ActionForm>
    </>
  );
}
