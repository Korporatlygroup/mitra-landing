import type { SupabaseClient } from '@supabase/supabase-js';
import { mapRpcError, rpcErrorDetail, type RpcErrorLike } from '@/lib/errors';

export type Db = SupabaseClient;

/** Service functions never throw for expected failures: they return an `errorKey` (key in `errors.*`). */
/** `detail` (Phase 5) is the field name or 1-based index after ':' in a validator key, when there is one. */
export type Result<T> = { ok: true; data: T } | { ok: false; errorKey: string; detail?: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (errorKey: string): { ok: false; errorKey: string; detail?: string } => ({ ok: false, errorKey });
export const failFrom = (error: RpcErrorLike | null | undefined): { ok: false; errorKey: string; detail?: string } => {
  const detail = rpcErrorDetail(error);
  return detail ? { ok: false, errorKey: mapRpcError(error), detail } : fail(mapRpcError(error));
};
