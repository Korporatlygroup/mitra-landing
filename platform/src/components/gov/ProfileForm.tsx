'use client';

import { useTranslations } from 'next-intl';
import { saveGovProfileAction } from '@/app/[locale]/business-help/actions';
import ActionForm from '@/components/ActionForm';
import { GOV_NEEDS } from '@/lib/gov-ui';
import type { GovProfile } from '@/server/services/gov';

/**
 * Step 1 and 2 of the guided finder. Every question is optional ("Not sure" is a valid answer) so nobody is forced through a long
 * assessment. Community, citizenship and age are marked optional and explained: they are used only when a programme publishes
 * a rule about them and are never shown outside the organisation. The values are sent by POST, never put in the address bar.
 */
export default function ProfileForm({ locale, orgId, profile, need }: { locale: string; orgId: string; profile: GovProfile | null; need: string | null }) {
  const t = useTranslations('gov');
  const v = profile ?? ({ version: 0 } as Partial<GovProfile>);
  const sel = (name: string, label: string, options: string[], current?: string | null, group = 'f') => (
    <div className="field">
      <label htmlFor={`gp-${name}`}>{label}</label>
      <select id={`gp-${name}`} name={name} defaultValue={current ?? ''}>
        <option value="">{t('f.unsure')}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {t(`${group}.${o}`)}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <ActionForm action={saveGovProfileAction} submitLabel={t('find.save')}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="version" value={String(v.version ?? 0)} />
      <fieldset>
        <legend>{t('find.step1')}</legend>
        <div className="field">
          <label htmlFor="gp-need">{t('find.step1')}</label>
          <select id="gp-need" name="need" defaultValue={need ?? v.needs?.[0] ?? ''}>
            <option value="">{t('find.anyNeed')}</option>
            {GOV_NEEDS.map((n) => (
              <option key={n} value={n}>
                {t(`need.${n}`)}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t('find.step2')}</legend>
        <p className="muted">{t('find.skip')}</p>
        {sel('business_size', t('f.size'), ['micro', 'small', 'medium'], v.business_size)}
        <div className="field">
          <label htmlFor="gp-employees">{t('f.employees')}</label>
          <input id="gp-employees" name="employees" type="number" inputMode="numeric" min={0} max={100000} defaultValue={v.employees ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="gp-years">{t('f.years')}</label>
          <input id="gp-years" name="years_operating" type="number" inputMode="numeric" min={0} max={200} defaultValue={v.years_operating ?? ''} />
        </div>
        {sel('registration', t('f.registration'), ['registered', 'licensed', 'none'], v.registration)}
        <div className="field">
          <label htmlFor="gp-state">{t('f.state')}</label>
          <input id="gp-state" name="state" type="text" maxLength={60} defaultValue={v.state ?? ''} autoComplete="off" />
        </div>
      </fieldset>
      <fieldset>
        <legend>{t('f.community')}</legend>
        <p className="muted">{t('find.sensitive')}</p>
        {sel('community', t('f.community'), ['indian', 'other', 'prefer_not'], v.community)}
        {sel('citizenship', t('f.citizenship'), ['malaysian', 'other', 'prefer_not'], v.citizenship)}
        <div className="field">
          <label htmlFor="gp-age">{t('f.age')}</label>
          <input id="gp-age" name="owner_age" type="number" inputMode="numeric" min={16} max={100} defaultValue={v.owner_age ?? ''} />
        </div>
      </fieldset>
    </ActionForm>
  );
}
