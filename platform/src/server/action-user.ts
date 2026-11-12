import { createClient } from '@/lib/supabase/server';

/** Signed-in user for a server action, validated with the Auth server (never from the session cookie alone). */
export async function actionUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}
