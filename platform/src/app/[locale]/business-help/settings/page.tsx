import { getTranslations } from 'next-intl/server';
import { setGovPrefsAction } from '../actions';
import ActionForm from '@/components/ActionForm';
import { REMINDER_DAY_CHOICES } from '@/lib/gov-ui';
import { pageTitle } from '@/lib/metadata';
import { getGovPrefs } from '@/server/services/gov';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.settings.title');
}

const CATS = ['new_match', 'opens', 'deadline', 'rule_change', 'unavailable', 'reminder'] as const;

/** Notification choices for the signed-in person: categories, channels, pause and how often. Unsubscribing from email is remembered. */
export default async function GovSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await requireSession({ locale, path: '/business-help/settings' });
  const t = await getTranslations({ locale, namespace: 'gov' });
  const r = await getGovPrefs(session.supabase);
  const prefs = r.ok ? r.data : null;
  const chosenDays = prefs?.reminder_days ?? [14, 3];
  const paused = prefs?.paused_until && new Date(prefs.paused_until) > new Date() ? prefs.paused_until.slice(0, 10) : '';
  return (
    <>
      <h1>{t('settings.title')}</h1>
      <p>{t('settings.intro')}</p>
      <ActionForm action={setGovPrefsAction} submitLabel={t('settings.save')}>
        <fieldset>
          <legend>{t('settings.categories')}</legend>
          {CATS.map((c) => (
            <div className="field field-check" key={c}>
              <input id={`gs-${c}`} type="checkbox" name={c} defaultChecked={prefs ? prefs[c] : true} />
              <label htmlFor={`gs-${c}`}>{t(`settings.${c}`)}</label>
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('settings.reminderDays')}</legend>
          <p className="muted">{t('settings.reminderDaysHint')}</p>
          {REMINDER_DAY_CHOICES.map((d) => (
            <div className="field field-check" key={d}>
              <input id={`gs-rd-${d}`} type="checkbox" name={`rd_${d}`} defaultChecked={chosenDays.includes(d)} />
              <label htmlFor={`gs-rd-${d}`}>{t('settings.daysBefore', { n: d })}</label>
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('settings.channels')}</legend>
          <div className="field field-check">
            <input id="gs-inapp" type="checkbox" name="channel_in_app" defaultChecked={prefs ? prefs.channel_in_app : true} />
            <label htmlFor="gs-inapp">{t('settings.inApp')}</label>
          </div>
          <div className="field field-check">
            <input id="gs-email" type="checkbox" name="channel_email" defaultChecked={prefs ? prefs.channel_email : false} />
            <label htmlFor="gs-email">{t('settings.email')}</label>
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="gs-freq">{t('settings.frequency')}</label>
          <select id="gs-freq" name="frequency" defaultValue={prefs?.frequency ?? 'immediate'}>
            {(['immediate', 'daily', 'weekly'] as const).map((f) => (
              <option key={f} value={f}>
                {t(`settings.${f}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="gs-pause">{t('settings.pause')}</label>
          <input id="gs-pause" type="date" name="paused_until" defaultValue={paused} />
        </div>
      </ActionForm>
    </>
  );
}
