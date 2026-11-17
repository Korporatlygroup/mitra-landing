import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/Field';
import WorkspaceShell from '@/components/workspace/WorkspaceShell';
import { requireSession } from '@/server/session';
import { createOrgAction } from './actions';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'orgs.newTitle');
}

export default async function NewOrgPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  const sp = await searchParams;
  // The purpose only preselects an option. buy -> individual buyer; sell and both -> a business (which can both buy and sell).
  const purpose = sp.purpose === 'buy' || sp.purpose === 'sell' || sp.purpose === 'both' ? sp.purpose : null;
  const defaultType = purpose === 'buy' ? 'buyer' : 'business';
  await requireSession({ locale, path: '/orgs/new', requireMfaIfNeeded: false });
  const t = await getTranslations({ locale, namespace: 'orgs' });

  return (
    <WorkspaceShell locale={locale}>
      <h1>{t('newTitle')}</h1>
      {purpose === 'both' ? <p className="hint">{t('purposeNote')}</p> : null}
      <ActionForm action={createOrgAction} submitLabel={t('submit')}>
        <input type="hidden" name="locale" value={locale} />
        <fieldset>
          <legend>{t('typeLabel')}</legend>
          <div className="radio">
            <input id="type-business" type="radio" name="type" value="business" defaultChecked={defaultType === 'business'} required />
            <label htmlFor="type-business">{t('typeBusiness')}</label>
          </div>
          <div className="radio">
            <input id="type-buyer" type="radio" name="type" value="buyer" defaultChecked={defaultType === 'buyer'} />
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
    </WorkspaceShell>
  );
}
