import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { signOutAction } from '@/app/[locale]/account/actions';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { invitationTokenSchema } from '@/lib/schemas';
import { acceptInvitation } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'invite.title');
}

export default async function InvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale });
  const { supabase, user } = await getOptionalUser();
  const validToken = invitationTokenSchema.safeParse(token).success;

  if (!user && validToken) {
    const next = encodeURIComponent(`/${locale}/invite/${token}`);
    return (
      <>
        <h1>{t('invite.title')}</h1>
        <p>{t('invite.signedOutHint')}</p>
        <p className="link-row">
          <Link href={`/login?next=${next}`} locale={locale} className="btn btn-primary">
            {t('invite.signIn')}
          </Link>
          <Link href="/signup" locale={locale} className="btn btn-secondary">
            {t('invite.signUp')}
          </Link>
        </p>
      </>
    );
  }

  let errorKey = 'invalid_invitation';
  if (user && supabase && validToken) {
    const r = await acceptInvitation(supabase, token);
    if (r.ok) redirect(`/${locale}/orgs`);
    // Missing consent: accept it on the account page, which returns here (same invitation link).
    if (r.errorKey === 'consent_required') {
      redirect(`/${locale}/account?next=${encodeURIComponent(`/${locale}/invite/${token}`)}`);
    }
    errorKey = r.errorKey;
  }

  return (
    <>
      <h1>{t('invite.failedTitle')}</h1>
      <p role="alert" className="message message-error">
        <strong>{t('common.error')}: </strong>
        {t(`errors.${errorKey}`)}
      </p>
      <p>{t('invite.failedHint')}</p>
      <p className="link-row">
        {user ? (
          <>
            <Link href="/orgs" locale={locale} className="btn btn-primary">
              {t('invite.toOrgs')}
            </Link>
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button type="submit" className="btn btn-secondary">
                {t('invite.signOut')}
              </button>
            </form>
          </>
        ) : (
          <Link href="/login" locale={locale} className="btn btn-primary">
            {t('invite.signIn')}
          </Link>
        )}
      </p>
    </>
  );
}
