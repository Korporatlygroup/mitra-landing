import { failFrom, ok, type Db, type Result } from './result';

export const dismissCard = async (db: Db, orgId: string, key: string): Promise<Result<null>> => {
  const { error } = await db.rpc('dash_dismiss', { p_org: orgId, p_key: key });
  return error ? failFrom(error) : ok(null);
};

/** Card keys this user dismissed for this organisation less than seven days ago. */
export async function activeDismissals(db: Db, orgId: string): Promise<Set<string>> {
  const { data } = await db.rpc('dash_active_dismissals', { p_org: orgId });
  return new Set(Array.isArray(data) ? (data as string[]) : []);
}
