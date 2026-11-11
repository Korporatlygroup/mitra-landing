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
  ],
  staff: ['business:edit', 'request:post', 'request:respond', 'enquiry:write', 'quote:send', 'lead:manage', 'review:write'],
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
  ],
  admin_ops: ['audit:read', 'report:view'],
  admin_review: ['verification:review', 'verification:decide', 'listing:review', 'review:moderate'],
  admin_content: ['programme:publish'],
  admin_support: ['case:reply', 'request:moderate'],
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

/** Mirrors private.requires_mfa. */
export function requiresMfa(role: MemberRole, orgType: OrgType): boolean {
  return isAdminRole(role) || (orgType === 'partner' && role === 'owner');
}

export function roleHas(role: MemberRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isMemberRole(v: string): v is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(v);
}
