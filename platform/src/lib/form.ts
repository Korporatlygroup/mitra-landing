import type { z } from 'zod';
import { SCHEMA_ERROR_KEYS } from './schemas';

/** Reads plain string fields from FormData (files and framework fields are skipped). */
export function formToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === 'string' && !k.startsWith('$ACTION')) out[k] = v;
  }
  return out;
}

const SECRET_FIELDS = new Set(['password', 'currentPassword', 'code']);

export function nonSecretValues(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !SECRET_FIELDS.has(k)));
}

export type Parsed<T> =
  | { ok: true; data: T; raw: Record<string, string> }
  | { ok: false; errorKey: string; values: Record<string, string> };

export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): Parsed<z.output<S>> {
  const raw = formToObject(formData);
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data, raw };
  const msg = r.error.issues[0]?.message ?? 'invalid_input';
  const errorKey = (SCHEMA_ERROR_KEYS as readonly string[]).includes(msg) ? msg : 'invalid_input';
  return { ok: false, errorKey, values: nonSecretValues(raw) };
}
