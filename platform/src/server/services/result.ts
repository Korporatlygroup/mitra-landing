import type { SupabaseClient } from '@supabase/supabase-js';
import { mapRpcError, type RpcErrorLike } from '@/lib/errors';

export type Db = SupabaseClient;

/** Service functions never throw for expected failures: they return an `errorKey` (key in `errors.*`). */
export type Result<T> = { ok: true; data: T } | { ok: false; errorKey: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (errorKey: string): { ok: false; errorKey: string } => ({ ok: false, errorKey });
export const failFrom = (error: RpcErrorLike | null | undefined): { ok: false; errorKey: string } =>
  fail(mapRpcError(error));
