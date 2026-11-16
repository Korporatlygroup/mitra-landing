import { failFrom, ok, type Db, type Result } from './result';

export const PRIVACY_REQUEST_TYPES = ['access', 'correction', 'deletion', 'portability', 'consent_withdrawal', 'complaint', 'other'] as const;
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export interface MyPrivacyRequest {
  id: string;
  request_type: PrivacyRequestType;
  status: 'open' | 'in_progress' | 'completed' | 'rejected';
  due_at: string;
  response_note: string | null;
  created_at: string;
}

export interface AdminPrivacyRequest extends MyPrivacyRequest {
  details: string;
  overdue: boolean;
  requester_email: string | null;
}

/** True when the user holds an un-withdrawn marketing consent. Optional: never needed for any feature. */
export async function hasMarketingConsent(supabase: Db, userId: string): Promise<boolean> {
  const { data } = await supabase.from('consents').select('id').eq('user_id', userId).eq('purpose', 'marketing').is('withdrawn_at', null).limit(1);
  return (data ?? []).length > 0;
}

export async function setMarketingConsent(supabase: Db, on: boolean): Promise<Result<null>> {
  const { error } = await supabase.rpc('set_marketing_consent', { p_on: on });
  return error ? failFrom(error) : ok(null);
}

export async function submitPrivacyRequest(supabase: Db, type: PrivacyRequestType, details: string): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('submit_privacy_request', { p_type: type, p_details: details });
  return error ? failFrom(error) : ok(String(data));
}

export async function listMyPrivacyRequests(supabase: Db): Promise<MyPrivacyRequest[]> {
  const { data } = await supabase.rpc('list_my_privacy_requests');
  return (data ?? []) as MyPrivacyRequest[];
}

export async function adminListPrivacyRequests(supabase: Db, status: string): Promise<Result<AdminPrivacyRequest[]>> {
  const { data, error } = await supabase.rpc('admin_list_privacy_requests', { p_status: status });
  return error ? failFrom(error) : ok((data ?? []) as AdminPrivacyRequest[]);
}

export async function adminUpdatePrivacyRequest(supabase: Db, id: string, status: string, note: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('admin_update_privacy_request', { p_id: id, p_status: status, p_note: note });
  return error ? failFrom(error) : ok(null);
}
