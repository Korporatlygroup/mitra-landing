import { cookies } from 'next/headers';
import { cache } from 'react';
import { listSellerRequests, type SellerInboxRow } from './services/directory';
import { getProfile } from './services/auth';
import { listMyMemberships, type MyMembership, type OrgSummary } from './services/orgs';
import { listNotifications, type NotificationRow } from './services/verification';
import { getOptionalUser } from './session';

export type WorkspaceKind = 'business' | 'partner' | 'buyer';
export const ACTIVE_ORG_COOKIE = 'inok_org';

export interface WorkspaceOrg {
  id: string;
  name: string;
  type: 'business' | 'partner' | 'buyer';
  home: string;
}

export interface Workspace {
  user: { id: string; email: string; name: string };
  kind: WorkspaceKind;
  org: OrgSummary | null;
  orgs: WorkspaceOrg[];
  /** Hints for the menu badges; the database decides everything. */
  newRequests: number;
  unread: number;
  latest: NotificationRow[];
  isReviewed: boolean;
}

export const homeFor = (m: { id: string; type: string }) => (m.type === 'business' ? `/orgs/${m.id}/business` : m.type === 'partner' ? `/orgs/${m.id}/partner` : '/requests');

const isNew = (r: SellerInboxRow) => r.match_status === 'invited' && r.request_status === 'open';

/** The signed-in shell context. Never redirects: a signed-out visitor gets null and the page's own gate does the redirect. */
export const getWorkspace = cache(async (orgId?: string): Promise<Workspace | null> => {
  const { supabase, user } = await getOptionalUser();
  if (!supabase || !user) return null;
  const [profile, memberships] = await Promise.all([getProfile(supabase, user.id), listMyMemberships(supabase, user.id)]);
  const usable = memberships.filter((m) => m.org.type === 'business' || m.org.type === 'partner' || m.org.type === 'buyer') as MyMembership[];
  const jar = await cookies();
  const wanted = orgId ?? jar.get(ACTIVE_ORG_COOKIE)?.value;
  const chosen =
    usable.find((m) => m.org.id === wanted) ?? usable.find((m) => m.org.type === 'business') ?? usable.find((m) => m.org.type === 'partner') ?? usable.find((m) => m.org.type === 'buyer') ?? null;
  const kind: WorkspaceKind = chosen ? (chosen.org.type as WorkspaceKind) : 'buyer';

  const [notes, requests] = await Promise.all([
    listNotifications(supabase, { limit: 30 }),
    chosen && kind === 'business' ? listSellerRequests(supabase, chosen.org.id, 'all') : Promise.resolve([] as SellerInboxRow[]),
  ]);
  const unread = notes.filter((n) => !n.read_at);
  return {
    user: { id: user.id, email: user.email ?? '', name: profile.display_name || user.email || '' },
    kind,
    org: chosen?.org ?? null,
    orgs: usable.map((m) => ({ id: m.org.id, name: m.org.name, type: m.org.type as WorkspaceOrg['type'], home: homeFor(m.org) })),
    newRequests: requests.filter(isNew).length,
    unread: unread.length,
    latest: notes.slice(0, 3),
    isReviewed: false,
  };
});
