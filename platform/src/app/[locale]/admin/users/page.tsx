import { getTranslations } from 'next-intl/server';
import MembersManager from '@/components/MembersManager';
import { getRolePermissions, listMembers, listPendingInvitations } from '@/server/services/orgs';
import { requireSession } from '@/server/session';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'admin.usersTitle');
}

export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Admin roles always require aal2 (requireSession redirects to MFA enrol/verify first).
  const s = await requireSession({ locale, path: '/admin/users' });
  const t = await getTranslations({ locale, namespace: 'admin' });

  const mine = s.memberships.find((m) => m.org.type === 'mitra');
  const perms = mine ? await getRolePermissions(s.supabase, mine.role) : new Set<string>();
  if (!mine || !perms.has('admin:users')) {
    return (
      <>
        <h1>{t('usersTitle')}</h1>
        <p role="alert" className="message message-error">
          {t('noAccess')}
        </p>
      </>
    );
  }

  const [members, invitations] = await Promise.all([listMembers(s.supabase, mine.org.id), listPendingInvitations(s.supabase, mine.org.id)]);
  return (
    <>
      <h1>{t('usersTitle')}</h1>
      <p>{t('usersIntro')}</p>
      <MembersManager locale={locale} org={mine.org} meId={s.user.id} myRole={mine.role} perms={perms} members={members} invitations={invitations} />
    </>
  );
}
