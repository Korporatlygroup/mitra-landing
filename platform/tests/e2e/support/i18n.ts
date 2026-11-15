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
    const merge = (a: Tree, b: Tree): Tree => {
      for (const [k, v] of Object.entries(b)) {
        const cur = a[k];
        a[k] = typeof cur === 'object' && typeof v === 'object' ? merge(cur, v) : v;
      }
      return a;
    };
    const withP5 = ['partner', 'buyer', 'admin', 'common'].reduce((acc, x) => merge(acc, read(`p5/${x}.${locale}.json`)), read(`${locale}.json`));
    merge(withP5, read(`p6/${locale}.json`));
    // redesign strings (messages/rd/rd.<locale>.json, built by scripts/rd/build-messages.cjs)
    const withRd = merge(withP5, read(`rd/rd.${locale}.json`));
    // Phase 7 completion strings (messages/p7/<area>.<locale>.json) extend the gov namespace
    cache[locale] = ['user', 'admin'].reduce((acc, x) => merge(acc, read(`p7/${x}.${locale}.json`)), withRd);
  }
  let cur: string | Tree | undefined = cache[locale];
  for (const part of key.split('.')) cur = typeof cur === 'object' ? cur[part] : undefined;
  if (typeof cur !== 'string') throw new Error(`Missing message ${locale}:${key}`);
  return cur.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
