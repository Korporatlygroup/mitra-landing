import { roleHas, type MemberRole, type OrgType } from './permissions';

export interface OrgMembership {
  role: MemberRole;
  org: { id: string; name: string; type: OrgType; status: 'active' | 'suspended' };
}

/** Organisations the user may post requests or send enquiries from (business or buyer orgs with request:post). A UI hint only; the database decides. */
export function eligibleBuyerOrgs<T extends OrgMembership>(memberships: T[]): T[] {
  return memberships.filter((m) => (m.org.type === 'business' || m.org.type === 'buyer') && m.org.status === 'active' && roleHas(m.role, 'request:post'));
}
