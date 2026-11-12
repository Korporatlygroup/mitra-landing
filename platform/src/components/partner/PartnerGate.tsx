import { getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/p5-format';
import { statusTone } from '@/lib/partner-ui';
import type { PartnerContext } from '@/server/partner-context';
import { saveProfileAction } from '@/app/[locale]/orgs/[id]/partner/settings/actions';
import PartnerForm from './PartnerForm';
import { TextInput } from './fields';

/**
 * What a partner sees until MITRA has approved the organisation (or after it was paused): a clear status page with what to do next,
 * never a dead end. Shown by every partner page that needs an approved partner. Viewing settings and notifications still works.
 */
export default async function PartnerGate({ ctx, locale }: { ctx: PartnerContext; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'p5partner.gate' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const base = `/orgs/${ctx.org.id}/partner`;
  const profile = ctx.profile;

  if (!profile) {
    const canCreate = ctx.perms.has('org:manage');
    return (
      <section aria-labelledby="gate-h">
        <h1 id="gate-h">{t('noProfileTitle')}</h1>
        <p>{t('noProfileBody')}</p>
        {canCreate ? (
          <PartnerForm action={saveProfileAction} submitLabel={t('saveProfile')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orgId" value={ctx.org.id} />
            <TextInput id="displayName" name="displayName" label={t('displayName')} hint={t('displayNameHint')} defaultValue={ctx.org.name} required maxLength={160} />
            <TextInput id="contactEmail" name="contactEmail" type="email" label={t('contactEmail')} hint={t('contactEmailHint')} defaultValue={ctx.session.user.email} required autoComplete="email" />
          </PartnerForm>
        ) : (
          <p className="message message-error">{t('askOwner')}</p>
        )}
      </section>
    );
  }

  const suspended = profile.status === 'suspended';
  return (
    <section aria-labelledby="gate-h" data-testid="partner-gate">
      <h1 id="gate-h">{suspended ? t('suspendedTitle') : t('pendingTitle')}</h1>
      <p>
        <StatusChip status={statusTone(profile.status)} label={tc(`status.partner.${profile.status}`)} />
      </p>
      <p>{suspended ? t('suspendedBody') : t('pendingBody')}</p>
      {profile.decision_reason && suspended ? (
        <p className="message message-error">
          <strong>{t('reasonLabel')}: </strong>
          {profile.decision_reason}
          {profile.decided_at ? ` (${formatDate(profile.decided_at, locale)})` : ''}
        </p>
      ) : null}
      <h2>{t('whatNow')}</h2>
      <ul>
        {(suspended ? ['s1', 's2'] : ['p1', 'p2', 'p3']).map((k) => (
          <li key={k}>{t(`steps.${k}`)}</li>
        ))}
      </ul>
      <p className="link-row">
        <Link href={`${base}/settings`} locale={locale} className="btn btn-secondary">
          {t('checkDetails')}
        </Link>
        <Link href={`${base}/notifications`} locale={locale} className="btn btn-secondary">
          {tt('seeNotifications')}
        </Link>
      </p>
    </section>
  );
}
