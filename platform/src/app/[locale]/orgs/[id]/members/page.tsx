import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import MembersManager from '@/components/MembersManager';
import { Link } from '@/i18n/navigation';
import { uuidSchema } from '@/lib/schemas';
import { getOrg, getRolePermissions, listMembers, listPendingInvitations } from '@/server/services/orgs';
import { requireSession } from '@/server/session';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  return pageTitle((await params).locale, 'members.title');
}

export default async function MembersPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const s = await requireSession({ locale, path: `/orgs/${id}/members` });
  const t = await getTranslations({ locale });

  const mine = s.memberships.find((m) => m.org.id === id);
  const org = mine ? await getOrg(s.supabase, id) : null;
  if (!mine || !org) notFound();

  const perms = await getRolePermissions(s.supabase, mine.role);
  const canSeeInvites = perms.has(org.type === 'mitra' ? 'admin:users' : 'member:invite');
  const [members, invitations] = await Promise.all([
    listMembers(s.supabase, id),
    canSeeInvites ? listPendingInvitations(s.supabase, id) : Promise.resolve([]),
  ]);

  return (
    <>
      <nav aria-label={t('orgs.switcherLabel')} className="org-switch">
        <ul>
          {s.memberships.map((m) => (
            <li key={m.org.id}>
              <Link href={`/orgs/${m.org.id}/members`} locale={locale} aria-current={m.org.id === id ? 'page' : undefined}>
                {m.org.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <h1>{org.name}</h1>
      <p className="muted">
        {t(`orgTypes.${org.type}`)} &middot; {t('orgs.role')}: {t(`roles.${mine.role}`)}
      </p>
      {org.type === 'business' ? (
        <p>
          <Link href={`/orgs/${id}/business`} locale={locale}>
            {t('orgs.businessLink')}
          </Link>
        </p>
      ) : null}
      <MembersManager locale={locale} org={org} meId={s.user.id} myRole={mine.role} perms={perms} members={members} invitations={invitations} />
    </>
  );
}
