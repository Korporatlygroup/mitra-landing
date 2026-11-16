'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failure, success, type FormState } from '@/lib/form-state';
import { nonSecretValues, parseForm } from '@/lib/form';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { changePasswordSchema, consentSchema, localeSchema, marketingSchema, privacyRequestSchema, profileSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { recordAuthEvent } from '@/server/privileged';
import { changePassword, signOut, updateProfile } from '@/server/services/auth';
import { grantConsents } from '@/server/services/consent';
import { setMarketingConsent, submitPrivacyRequest } from '@/server/services/privacy';

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = localeSchema.catch('en').parse(formData.get('locale'));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await recordAuthEvent(data.user.id, 'auth.logout');
  await signOut(supabase);
  redirect(`/${locale}`);
}

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(profileSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey, parsed.values);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');
  const r = await updateProfile(supabase, data.user.id, parsed.data);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(parsed.raw));
  revalidatePath('/', 'layout');
  // Switching language moves the user to the matching locale of this page.
  redirect(`/${parsed.data.language}/account?saved=1`);
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(changePasswordSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');
  const r = await changePassword(supabase, parsed.data.password);
  if (!r.ok) {
    // Users with an authenticator app must step up to aal2 before changing the password.
    if (r.errorKey === 'mfa_required') {
      const locale = localeSchema.catch('en').parse(formData.get('locale'));
      redirect(`/${locale}/mfa/verify?next=${encodeURIComponent(`/${locale}/account`)}`);
    }
    return failure(r.errorKey);
  }
  await recordAuthEvent(data.user.id, 'auth.password_changed');
  return success('account.passwordChanged');
}

/** Accept the current terms and privacy notice (RPC grant_consent), then return to where the user was. */
export async function grantConsentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(consentSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');
  const r = await grantConsents(supabase);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  redirect(safeRedirectPath(parsed.data.next, `/${parsed.data.locale}/account`));
}

/** Turns the optional marketing consent on or off. Never affects access to any feature. */
export async function setMarketingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(marketingSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');
  const r = await setMarketingConsent(supabase, parsed.data.marketing);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath(`/${parsed.data.locale}/account`);
  return success('account.marketingSaved');
}

/** Records a data request (access, correction, deletion, portability, consent withdrawal or complaint) for staff to answer. */
export async function submitPrivacyRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(privacyRequestSchema, formData);
  if (!parsed.ok) return failure(parsed.errorKey, parsed.values);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');
  const r = await submitPrivacyRequest(supabase, parsed.data.type, parsed.data.details);
  if (!r.ok) return failure(r.errorKey, nonSecretValues(parsed.raw));
  revalidatePath(`/${parsed.data.locale}/account`);
  return success('account.requestSent');
}
