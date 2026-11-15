import { getRolePermissions } from './services/orgs';
import { requireSession } from './session';

/**
 * Gate for every /admin/business-help page. Signed in; admin roles always need aal2 (requireSession redirects to MFA first).
 * The flags are UI hints so a person only sees what they may use: the database enforces every permission again.
 */
export async function requireGovAdmin(locale: string, path: string) {
  const session = await requireSession({ locale, path });
  const mine = session.memberships.find((m) => m.org.type === 'mitra');
  const perms = mine ? await getRolePermissions(session.supabase, mine.role) : new Set<string>();
  return {
    session,
    canView: perms.has('gov:view'),
    canReview: perms.has('gov:review'),
    canPublish: perms.has('gov:publish'),
    canSources: perms.has('gov:source_admin'),
  };
}
export type GovAdminContext = Awaited<ReturnType<typeof requireGovAdmin>>;
