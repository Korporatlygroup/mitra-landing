import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { signOutAction } from '@/app/[locale]/account/actions';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { invitationTokenSchema } from '@/lib/schemas';
import { acceptPartnerInvitation } from '@/server/services/p5-partner';
import { getOptionalUser } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'invite.title');
}

/**
 * Owner invitation for an organisation that MITRA set up as a partner. The general invitation page (/invite/<token>) uses the generic
 * accept function, which refuses these invitations, so the link in the email points here. Same flow and wording otherwise.
 */
export default async function PartnerInvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale });
  const { supabase, user } = await getOptionalUser();
  const validToken = invitationTokenSchema.safeParse(token).success;
  const here = `/${locale}/invite/partner/${token}`;

  if (!user && validToken) {
    const next = encodeURIComponent(here);
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
    const r = await acceptPartnerInvitation(supabase, token);
    if (r.ok) redirect(`/${locale}/orgs/${r.data.org_id}/partner`);
    // Missing consent: accept it on the account page, which returns here (same invitation link).
    if (r.errorKey === 'consent_required') redirect(`/${locale}/account?next=${encodeURIComponent(here)}`);
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
