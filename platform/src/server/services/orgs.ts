import { isMemberRole, type MemberRole, type OrgType } from '@/lib/permissions';
import { failFrom, ok, type Db, type Result } from './result';

export interface OrgSummary {
  id: string;
  name: string;
  type: OrgType;
  status: 'active' | 'suspended';
}

export interface MyMembership {
  role: MemberRole;
  org: OrgSummary;
}

export interface MemberRow {
  userId: string;
  role: MemberRole;
  displayName: string;
  since: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
}

export async function listMyMemberships(supabase: Db, userId: string): Promise<MyMembership[]> {
  const { data } = await supabase
    .from('memberships')
    .select('role, organisations(id, name, type, status)')
    .eq('user_id', userId)
    .eq('status', 'active');
  const rows = (data ?? []) as unknown as { role: string; organisations: OrgSummary | OrgSummary[] | null }[];
  const out: MyMembership[] = [];
  for (const r of rows) {
    const org = Array.isArray(r.organisations) ? r.organisations[0] : r.organisations;
    if (org && isMemberRole(r.role)) out.push({ role: r.role, org });
  }
  return out.sort((a, b) => a.org.name.localeCompare(b.org.name));
}

export async function getOrg(supabase: Db, orgId: string): Promise<OrgSummary | null> {
  const { data } = await supabase.from('organisations').select('id, name, type, status').eq('id', orgId).maybeSingle();
  return (data as OrgSummary | null) ?? null;
}

export async function listMembers(supabase: Db, orgId: string): Promise<MemberRow[]> {
  const { data } = await supabase
    .from('memberships')
    .select('user_id, role, created_at')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as { user_id: string; role: string; created_at: string }[];
  if (rows.length === 0) return [];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', rows.map((r) => r.user_id));
  const names = new Map(((profiles ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  return rows
    .filter((r) => isMemberRole(r.role))
    .map((r) => ({
      userId: r.user_id,
      role: r.role as MemberRole,
      displayName: names.get(r.user_id) ?? '',
      since: r.created_at,
    }));
}

/** Only readable by member managers (RLS); empty for everyone else. */
export async function listPendingInvitations(supabase: Db, orgId: string): Promise<PendingInvitation[]> {
  const { data } = await supabase
    .from('invitations')
    .select('id, email, role, expires_at')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  return ((data ?? []) as { id: string; email: string; role: string; expires_at: string }[])
    .filter((r) => isMemberRole(r.role))
    .map((r) => ({ id: r.id, email: r.email, role: r.role as MemberRole, expiresAt: r.expires_at }));
}

/** Permissions of a role, read from the database seed (role_permissions). */
export async function getRolePermissions(supabase: Db, role: MemberRole): Promise<Set<string>> {
  const { data } = await supabase.from('role_permissions').select('permission').eq('role', role);
  return new Set(((data ?? []) as { permission: string }[]).map((r) => r.permission));
}

export async function createOrg(supabase: Db, type: 'business' | 'buyer' | 'partner', name: string): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('create_org', { p_type: type, p_name: name });
  return error ? failFrom(error) : ok(String(data));
}

export async function createInvitation(
  supabase: Db,
  orgId: string,
  email: string,
  role: MemberRole,
): Promise<Result<{ invitationId: string; token: string }>> {
  const { data, error } = await supabase.rpc('create_invitation', { p_org: orgId, p_email: email, p_role: role });
  if (error) return failFrom(error);
  const d = data as { invitation_id: string; token: string };
  return ok({ invitationId: d.invitation_id, token: d.token });
}

export async function acceptInvitation(supabase: Db, token: string): Promise<Result<{ orgId: string; role: MemberRole }>> {
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) return failFrom(error);
  const d = data as { org_id: string; role: MemberRole };
  return ok({ orgId: d.org_id, role: d.role });
}

export async function revokeInvitation(supabase: Db, invitationId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('revoke_invitation', { p_invitation: invitationId });
  return error ? failFrom(error) : ok(null);
}

export async function removeMember(supabase: Db, orgId: string, userId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('remove_member', { p_org: orgId, p_user: userId });
  return error ? failFrom(error) : ok(null);
}

export async function setMemberRole(supabase: Db, orgId: string, userId: string, role: MemberRole): Promise<Result<null>> {
  const { error } = await supabase.rpc('set_member_role', { p_org: orgId, p_user: userId, p_role: role });
  return error ? failFrom(error) : ok(null);
}
