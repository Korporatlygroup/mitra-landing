import { getTranslations } from 'next-intl/server';
import MembersManager from '@/components/MembersManager';
import PartnerForm from '@/components/partner/PartnerForm';
import { TextInput } from '@/components/partner/fields';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { statusTone } from '@/lib/partner-ui';
import { requirePartnerContext } from '@/server/partner-context';
import { listMembers, listPendingInvitations } from '@/server/services/orgs';
import { saveProfileAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.nav.settings');
}

export default async function PartnerSettingsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requirePartnerContext(locale, id, '/settings');
  const t = await getTranslations({ locale, namespace: 'p5partner.settings' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const tg = await getTranslations({ locale, namespace: 'p5partner.gate' });
  const canInvite = ctx.perms.has('member:invite');
  const [members, invitations] = await Promise.all([listMembers(ctx.session.supabase, id), canInvite ? listPendingInvitations(ctx.session.supabase, id) : Promise.resolve([])]);
  const profile = ctx.profile;
  return (
    <>
      <h1>{t('title')}</h1>

      <section aria-labelledby="profile-h">
        <h2 id="profile-h">{t('profileTitle')}</h2>
        {profile ? (
          <p>
            <StatusChip status={statusTone(profile.status)} label={tc(`status.partner.${profile.status}`)} />
          </p>
        ) : (
          <p>{tg('noProfileBody')}</p>
        )}
        {profile?.status === 'pending' ? <p className="hint">{tg('pendingBody')}</p> : null}
        {ctx.perms.has('org:manage') ? (
          <PartnerForm action={saveProfileAction} submitLabel={tc('buttons.saveChanges')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orgId" value={id} />
            <TextInput id="displayName" name="displayName" label={tg('displayName')} hint={t('displayNameHint')} defaultValue={profile?.display_name ?? ctx.org.name} required maxLength={120} />
            <TextInput id="contactEmail" name="contactEmail" type="email" label={tg('contactEmail')} hint={tg('contactEmailHint')} defaultValue={profile?.contact_email ?? ''} required autoComplete="email" />
          </PartnerForm>
        ) : (
          <dl className="dl">
            <dt>{tg('displayName')}</dt>
            <dd>{profile?.display_name ?? ctx.org.name}</dd>
            <dt>{tg('contactEmail')}</dt>
            <dd>{profile?.contact_email ?? '-'}</dd>
          </dl>
        )}
      </section>

      <section aria-labelledby="staff-h">
        <h2 id="staff-h">{t('staffTitle')}</h2>
        <p className="hint">{t('staffIntro')}</p>
        <MembersManager locale={locale} org={ctx.org} meId={ctx.session.user.id} myRole={ctx.role} perms={ctx.perms} members={members} invitations={invitations} />
      </section>

      <section aria-labelledby="lang-h">
        <h2 id="lang-h">{t('languageTitle')}</h2>
        <p>{t('languageBody')}</p>
        <p>
          <Link href="/account" locale={locale} className="btn btn-secondary">
            {t('languageLink')}
          </Link>
        </p>
      </section>
    </>
  );
}
