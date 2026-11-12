import { getRolePermissions } from './services/orgs';
import { requireSession } from './session';

/**
 * Gate for every /admin/catalogue page. Signed in; admin roles always need aal2 (requireSession redirects to MFA first).
 * The flags are UI hints so a person only sees what they may use: the database enforces every permission again.
 */
export async function requireCatalogueAdmin(locale: string, path: string) {
  const session = await requireSession({ locale, path });
  const mine = session.memberships.find((m) => m.org.type === 'mitra');
  const perms = mine ? await getRolePermissions(session.supabase, mine.role) : new Set<string>();
  const canReviewSuppliers = perms.has('supplier:review');
  const canReviewProducts = perms.has('catalogue:review');
  const canModerate = perms.has('catalogue:moderate');
  const canManagePartners = perms.has('partner:manage');
  // catalogue_stats accepts report:view, supplier:review, catalogue:review or catalogue:moderate.
  const canStats = perms.has('report:view') || canReviewSuppliers || canReviewProducts || canModerate;
  return {
    session,
    perms,
    isStaff: Boolean(mine),
    canReviewSuppliers,
    canReviewProducts,
    canModerate,
    canManagePartners,
    canStats,
    /** Anything at all in the catalogue admin area. */
    any: canStats || canManagePartners,
  };
}
export type CatalogueAdminContext = Awaited<ReturnType<typeof requireCatalogueAdmin>>;
