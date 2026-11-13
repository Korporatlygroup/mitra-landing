import { notFound } from 'next/navigation';
import { uuidSchema } from '@/lib/schemas';
import { getOrg, getRolePermissions, type OrgSummary } from './services/orgs';
import { requireSession, type AppSession } from './session';

export interface BusinessContext {
  session: AppSession;
  org: OrgSummary;
  role: AppSession['memberships'][number]['role'];
  perms: Set<string>;
  /** Business-side permissions, from role_permissions (UI hints only; the database enforces). */
  canEdit: boolean;
  canSubmit: boolean;
  canRead: boolean;
}

/** Shared gate for /orgs/[id]/business/*: signed in, member of this business organisation. */
export async function requireBusinessContext(locale: string, orgId: string, path: string): Promise<BusinessContext> {
  if (!uuidSchema.safeParse(orgId).success) notFound();
  const session = await requireSession({ locale, path: `/orgs/${orgId}/business${path}` });
  const mine = session.memberships.find((m) => m.org.id === orgId);
  const org = mine ? await getOrg(session.supabase, orgId) : null;
  if (!mine || !org || org.type !== 'business') notFound();
  const perms = await getRolePermissions(session.supabase, mine.role);
  return {
    session,
    org,
    role: mine.role,
    perms,
    canEdit: perms.has('business:edit'),
    canSubmit: perms.has('verification:submit'),
    canRead: perms.has('verification:read'),
  };
}
