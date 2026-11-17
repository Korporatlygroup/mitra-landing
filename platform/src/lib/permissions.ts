/** Mirrors the seed in supabase/migrations/20260701000003_permissions.sql EXACTLY (checked by a unit test). */

export const ORG_ROLES = ['owner', 'manager', 'staff', 'viewer'] as const;
export const ADMIN_ROLES = ['admin_review', 'admin_content', 'admin_support', 'admin_ops', 'admin_super'] as const;
export const MEMBER_ROLES = [...ORG_ROLES, ...ADMIN_ROLES] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type OrgType = 'business' | 'buyer' | 'partner' | 'mitra';

export const ROLE_PERMISSIONS: Record<MemberRole, readonly string[]> = {
  owner: [
    'org:manage',
    'member:invite',
    'member:remove',
    'member:set_role',
    'audit:read',
    'business:edit',
    'verification:submit',
    'verification:read',
    'listing:publish',
    'request:post',
    'request:respond',
    'enquiry:write', 'quote:send', 'lead:manage', 'review:write',
    'supplier:manage', 'catalogue:manage', 'sourcing:respond', 'assist:manage',
  ],
  manager: [
    'member:invite',
    'member:remove',
    'member:set_role',
    'business:edit',
    'verification:submit',
    'verification:read',
    'listing:publish',
    'request:post',
    'request:respond',
    'enquiry:write', 'quote:send', 'lead:manage', 'review:write',
    'supplier:manage', 'catalogue:manage', 'sourcing:respond', 'assist:manage',
  ],
  staff: [
    'business:edit', 'request:post', 'request:respond', 'enquiry:write', 'quote:send', 'lead:manage', 'review:write',
    'supplier:manage', 'catalogue:manage', 'sourcing:respond', 'assist:manage',
  ],
  viewer: [],
  admin_super: [
    'admin:users',
    'audit:read',
    'org:manage',
    'verification:review',
    'programme:publish',
    'case:reply',
    'report:view',
    'verification:decide',
    'listing:review',
    'request:moderate',
    'review:moderate',
    'supplier:review',
    'catalogue:review',
    'partner:manage',
    'catalogue:moderate',
    'gov:source_admin',
    'gov:review',
    'gov:publish',
    'gov:view',
    'privacy:handle',
  ],
  admin_ops: ['audit:read', 'report:view', 'gov:source_admin', 'gov:view'],
  admin_review: ['verification:review', 'verification:decide', 'listing:review', 'review:moderate', 'supplier:review', 'catalogue:review', 'partner:manage', 'gov:review', 'gov:view'],
  admin_content: ['programme:publish', 'gov:publish', 'gov:view'],
  admin_support: ['case:reply', 'request:moderate', 'catalogue:moderate'],
};

/** Mirrors private.role_rank. */
export function roleRank(role: MemberRole): number {
  switch (role) {
    case 'owner':
      return 4;
    case 'manager':
      return 3;
    case 'staff':
      return 2;
    case 'viewer':
      return 1;
    default:
      return 0;
  }
}

export function isAdminRole(role: string): boolean {
  return role.startsWith('admin_');
}

/**
 * Mirrors private.requires_mfa. `adminMfa` is the project's administrator policy (public.admin_mfa_required(); default true).
 * Partner owners always need MFA.
 */
export function requiresMfa(role: MemberRole, orgType: OrgType, adminMfa = true): boolean {
  return (isAdminRole(role) && adminMfa) || (orgType === 'partner' && role === 'owner');
}

export function roleHas(role: MemberRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isMemberRole(v: string): v is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(v);
}

// ---- Phase 5 helpers (UI hints only: the database enforces every permission) ---------------------------------------

/** A permission set as returned by getRolePermissions(). */
export type PermissionSet = ReadonlySet<string> | readonly string[];
const has = (perms: PermissionSet, p: string) => (Array.isArray(perms) ? (perms as readonly string[]).includes(p) : (perms as ReadonlySet<string>).has(p));

/** Add or edit suppliers and their documents, submit them for review (partner owner, manager, staff). */
export const canManageSuppliers = (perms: PermissionSet) => has(perms, 'supplier:manage');
/** Add or edit products, upload images, import catalogues, publish or unpublish. */
export const canManageCatalogue = (perms: PermissionSet) => has(perms, 'catalogue:manage');
/** Respond to buyer requests. */
export const canRespondToSourcing = (perms: PermissionSet) => has(perms, 'sourcing:respond');
/** MITRA reviewer: decide on suppliers and products. */
export const canReviewCatalogue = (perms: PermissionSet) => has(perms, 'supplier:review') || has(perms, 'catalogue:review');
/** MITRA moderator: pause suppliers or products, handle product reports. */
export const canModerateCatalogue = (perms: PermissionSet) => has(perms, 'catalogue:moderate');
/** MITRA: approve, pause or provision partner organisations. */
export const canManagePartners = (perms: PermissionSet) => has(perms, 'partner:manage');
