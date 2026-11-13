'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, type FormState } from '@/lib/form-state';
import { nonSecretValues, parseForm } from '@/lib/form';
import { createOrgSchema, localeSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { createOrg } from '@/server/services/orgs';

const schema = createOrgSchema.extend({ locale: localeSchema });

export async function createOrgAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return failure(parsed.errorKey, parsed.values);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failure('unauthenticated');

  const r = await createOrg(supabase, parsed.data.type, parsed.data.name);
  if (!r.ok) {
    // Missing consent: send the user to accept it, then bring them back here.
    if (r.errorKey === 'consent_required') {
      const l = parsed.data.locale;
      redirect(`/${l}/account?next=${encodeURIComponent(`/${l}/orgs/new`)}`);
    }
    return failure(r.errorKey, nonSecretValues(parsed.raw));
  }
  if (!z.uuid().safeParse(r.data).success) return failure('internal');
  redirect(`/${parsed.data.locale}/orgs/${r.data}/members`);
}
