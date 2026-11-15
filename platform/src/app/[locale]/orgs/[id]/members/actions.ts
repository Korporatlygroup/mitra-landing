'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSiteUrl } from '@/lib/env';
import { failure, success, type FormState } from '@/lib/form-state';
import { nonSecretValues, parseForm } from '@/lib/form';
import {
  inviteSchema,
  localeSchema,
  removeMemberSchema,
  revokeInvitationSchema,
  setRoleSchema,
} from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { buildInviteEmail } from '@/server/invite-email';
import { getMailer } from '@/server/mailer';
import {
  createInvitation,
  getOrg,
  removeMember,
  revokeInvitation,
  setMemberRole,
} from '@/server/services/orgs';

const withLocale = <T extends z.ZodRawShape>(s: z.ZodObject<T>) => s.extend({ locale: localeSchema });

/** The database raises one key (last_owner) for both the last owner and the last super administrator. */
async function refine(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, key: string) {
  if (key !== 'last_owner') return key;
  const org = await getOrg(supabase, orgId);
  return org?.type === 'mitra' ? 'last_admin' : key;
}

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

/** Creates the invitation (database enforces who may) and emails the one-time link. The token is never stored or logged. */
export async function inviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(withLocale(inviteSchema), formData);
  if (!parsed.ok) return failure(parsed.errorKey, parsed.values);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const { orgId, email, role, locale } = parsed.data;

  const created = await createInvitation(supabase, orgId, email, role);
  if (!created.ok) return failure(created.errorKey, nonSecretValues(parsed.raw));

  const org = await getOrg(supabase, orgId);
  try {
    const link = `${getSiteUrl()}/${locale}/invite/${created.data.token}`;
    await getMailer().send(buildInviteEmail({ to: email, orgName: org?.name ?? 'INOK', role, link }));
  } catch (e) {
    // Never log the message: it could echo the link. The invitation stays pending and can be cancelled.
    console.error('invitation email failed', e instanceof Error ? e.name : 'error');
    revalidatePath('/', 'layout');
    return failure('email_failed');
  }
  revalidatePath('/', 'layout');
  return success('members.invited');
}

export async function revokeInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(withLocale(revokeInvitationSchema), formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const r = await revokeInvitation(supabase, parsed.data.invitationId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('members.revoked');
}

export async function setRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(withLocale(setRoleSchema), formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const r = await setMemberRole(supabase, parsed.data.orgId, parsed.data.userId, parsed.data.role);
  if (!r.ok) return failure(await refine(supabase, parsed.data.orgId, r.errorKey));
  revalidatePath('/', 'layout');
  return success('members.roleChanged');
}

export async function removeMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(withLocale(removeMemberSchema), formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const r = await removeMember(supabase, parsed.data.orgId, parsed.data.userId);
  if (!r.ok) return failure(await refine(supabase, parsed.data.orgId, r.errorKey));
  revalidatePath('/', 'layout');
  return success('members.removed');
}

/** Leaving = removing yourself. The user id comes from the verified session, not from the form. */
export async function leaveOrgAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(withLocale(z.object({ orgId: removeMemberSchema.shape.orgId })), formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const r = await removeMember(supabase, parsed.data.orgId, user.id);
  if (!r.ok) return failure(await refine(supabase, parsed.data.orgId, r.errorKey));
  revalidatePath('/', 'layout');
  redirect(`/${parsed.data.locale}/orgs`);
}
