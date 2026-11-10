import { getRolePermissions } from './services/orgs';
import { requireSession } from './session';

/** Gate for /admin/verification/*: signed in, aal2 (requireSession enforces it for admin roles), reviewer permissions. */
export async function requireReviewer(locale: string, path: string) {
  const session = await requireSession({ locale, path });
  const mine = session.memberships.find((m) => m.org.type === 'mitra');
  const perms = mine ? await getRolePermissions(session.supabase, mine.role) : new Set<string>();
  return {
    session,
    canReview: perms.has('verification:review'),
    canDecide: perms.has('verification:decide'),
  };
}
