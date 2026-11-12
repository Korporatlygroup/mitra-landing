import { notFound } from 'next/navigation';
import { canManageCatalogue, canManageSuppliers, canRespondToSourcing } from '@/lib/permissions';
import { uuidSchema } from '@/lib/schemas';
import { getPartnerProfile, type PartnerProfileRow } from './services/p5-partner';
import { getOrg, getRolePermissions, type OrgSummary } from './services/orgs';
import { requireSession, type AppSession } from './session';

export interface PartnerContext {
  session: AppSession;
  org: OrgSummary;
  role: AppSession['memberships'][number]['role'];
  perms: Set<string>;
  /** Null until the partner profile exists. */
  profile: PartnerProfileRow | null;
  /** True once MITRA has approved the partner. Partner write RPCs fail with `partner_not_approved` otherwise. */
  approved: boolean;
  /** Permission hints for the UI only; the database enforces. */
  canManageSuppliers: boolean;
  canManageCatalogue: boolean;
  canRespond: boolean;
}

/**
 * Shared gate for /orgs/[id]/partner/*: signed in (MFA required for partner owners, via requireSession), and a member of this
 * `partner` organisation. Every partner PAGE must call it (a layout is not re-run on client navigation between pages).
 * `path` is the locale-less path below `/orgs/[id]/partner` (for the post-login redirect), e.g. `/suppliers` or ''.
 */
export async function requirePartnerContext(locale: string, orgId: string, path: string): Promise<PartnerContext> {
  if (!uuidSchema.safeParse(orgId).success) notFound();
  const session = await requireSession({ locale, path: `/orgs/${orgId}/partner${path}` });
  const mine = session.memberships.find((m) => m.org.id === orgId);
  const org = mine ? await getOrg(session.supabase, orgId) : null;
  if (!mine || !org || org.type !== 'partner') notFound();
  const [perms, profile] = await Promise.all([getRolePermissions(session.supabase, mine.role), getPartnerProfile(session.supabase, orgId)]);
  return {
    session,
    org,
    role: mine.role,
    perms,
    profile,
    approved: profile?.status === 'approved',
    canManageSuppliers: canManageSuppliers(perms),
    canManageCatalogue: canManageCatalogue(perms),
    canRespond: canRespondToSourcing(perms),
  };
}
