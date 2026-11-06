import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');

export function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

export function walk(dir: string, exts = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.includes(path.extname(name))) out.push(full);
  }
  return out;
}

export function migrations(): { file: string; text: string }[] {
  const dir = path.join(ROOT, 'supabase/migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(path.join(dir, f), 'utf8') }));
}

export function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') Object.assign(out, flatten(v, key));
      else out[key] = v;
    }
  }
  return out;
}
