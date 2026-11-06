import type { Db } from './result';

export const AUDIT_ACTIONS = [
  'org.created',
  'org.renamed',
  'org.status_changed',
  'membership.added',
  'membership.role_changed',
  'membership.removed',
  'membership.reactivated',
  'invitation.created',
  'invitation.accepted',
  'invitation.revoked',
  'consent.granted',
  'consent.withdrawn',
  'auth.signup',
  'auth.login',
  'auth.logout',
  'auth.mfa_enrolled',
  'auth.mfa_verified',
  'auth.password_changed',
  'bootstrap.first_admin',
] as const;

export interface AuditRow {
  id: number;
  at: string;
  actor_user_id: string | null;
  org_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
}

/** Latest 200 rows visible to the caller (RLS decides which: org owners their org, MITRA audit:read everything). */
export async function listAudit(supabase: Db, action?: string): Promise<AuditRow[]> {
  let q = supabase
    .from('audit_log')
    .select('id, at, actor_user_id, org_id, action, entity_type, entity_id, details')
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (action) q = q.eq('action', action);
  const { data } = await q;
  return (data ?? []) as AuditRow[];
}
