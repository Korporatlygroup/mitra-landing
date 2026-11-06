import fs from 'node:fs';
import path from 'node:path';
import { platformDir } from './env';

type Tree = { [k: string]: string | Tree };
const cache: Record<string, Tree> = {};

/** Looks a message up by dotted key in messages/<locale>.json (read at run time; the app owns the files). */
export function msg(locale: 'en' | 'ta', key: string, vars: Record<string, string> = {}): string {
  cache[locale] ??= JSON.parse(fs.readFileSync(path.join(platformDir, 'messages', `${locale}.json`), 'utf8')) as Tree;
  let cur: string | Tree | undefined = cache[locale];
  for (const part of key.split('.')) cur = typeof cur === 'object' ? cur[part] : undefined;
  if (typeof cur !== 'string') throw new Error(`Missing message ${locale}:${key}`);
  return cur.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
