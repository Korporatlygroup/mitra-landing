import fs from 'node:fs';
import path from 'node:path';
import { platformDir } from './env';

type Tree = { [k: string]: string | Tree };
const cache: Record<string, Tree> = {};

/** Looks a message up by dotted key in messages/<locale>.json (read at run time; the app owns the files). */
export function msg(locale: 'en' | 'ta' | 'ms', key: string, vars: Record<string, string> = {}): string {
  if (!cache[locale]) {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(platformDir, 'messages', f), 'utf8')) as Tree;
    // main file plus the Phase 5 area files (messages/p5/<area>.<locale>.json), merged by top-level namespace like src/i18n/messages.ts
    cache[locale] = Object.assign(read(`${locale}.json`), ...['partner', 'buyer', 'admin', 'common'].map((x) => read(`p5/${x}.${locale}.json`)));
  }
  let cur: string | Tree | undefined = cache[locale];
  for (const part of key.split('.')) cur = typeof cur === 'object' ? cur[part] : undefined;
  if (typeof cur !== 'string') throw new Error(`Missing message ${locale}:${key}`);
  return cur.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
