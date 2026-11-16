// Static analysis: which top-level message namespaces do the CLIENT components reachable from each route area use?
// The locale layout sends the browser only the small base set; each area layout adds the rest (src/i18n/client-namespaces.ts).
// Sending the whole catalogue made every page ~200 KB of serialized data and cost Cloudflare Free-plan CPU (10 ms per request).
// Usage: node scripts/client-namespaces.mjs   (prints JSON); the unit test imports analyse().
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const localeDir = join(src, 'app', '[locale]');

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mjs)$/.test(n) ? [p] : [];
  });

const tryFiles = (base) => [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((f) => existsSync(f) && statSync(f).isFile());

function resolveImport(from, spec) {
  if (spec.startsWith('@/')) return tryFiles(join(src, spec.slice(2)));
  if (spec.startsWith('.')) return tryFiles(resolve(dirname(from), spec));
  return undefined;
}

// The English catalogue, merged the way src/i18n/messages.ts does (used to check that a dotted string really is a message path).
const isTree = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const mergeTree = (...ps) => {
  const o = {};
  for (const p of ps) for (const [k, v] of Object.entries(p)) o[k] = isTree(o[k]) && isTree(v) ? mergeTree(o[k], v) : v;
  return o;
};
let catalogue;
const loadCatalogue = () => {
  if (catalogue) return catalogue;
  const rd = (f) => JSON.parse(readFileSync(join(root, 'messages', f), 'utf8'));
  catalogue = mergeTree(rd('en.json'), rd('p5/partner.en.json'), rd('p5/buyer.en.json'), rd('p5/admin.en.json'), rd('p5/common.en.json'), rd('p6/en.json'), rd('rd/rd.en.json'), rd('p7/user.en.json'), rd('p7/admin.en.json'));
  return catalogue;
};
const hasPath = (p) => p.split('.').reduce((t, k) => (isTree(t) ? t[k] : undefined), loadCatalogue()) !== undefined;

// Server actions answer with a message KEY (state.messageKey) that the browser translates: failure() gives `errors.<code>`, success('x.y')
// and a few direct messageKey values give others. Every dotted string in a server-side file that is a real message path is included.
let actionKeyCache;
function actionKeys() {
  if (actionKeyCache) return actionKeyCache;
  const out = new Set(['errors']);
  const files = walk(src).filter((f) => /[\\/]server[\\/]|actions\.tsx?$|[\\/]lib[\\/](?:form-state|errors)\.ts$/.test(f));
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)(\$\{)?['"`]?/g)) {
      const p = m[2] ? m[1].replace(/\.$/, '') : m[1];
      if (!/^[a-z]/.test(p) || !hasPath(p.split('.').slice(0, 1).join('.'))) continue;
      // keep the longest prefix that exists (a literal such as 'p5partner.import.done' or a template prefix)
      const parts = p.split('.');
      while (parts.length && !hasPath(parts.join('.'))) parts.pop();
      if (parts.length >= 2 || (parts.length === 1 && m[2])) out.add(parts.join('.'));
    }
  }
  actionKeyCache = out;
  return out;
}

const cache = new Map();
function info(file) {
  if (cache.has(file)) return cache.get(file);
  const text = readFileSync(file, 'utf8');
  const client = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(text);
  const imports = [...text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g)]
    .map((m) => resolveImport(file, m[1] ?? m[2] ?? m[3]))
    .filter(Boolean);
  const roots = new Set();
  const dynamic = [];
  if (client) {
    let noNs = false;
    for (const m of text.matchAll(/useTranslations\(\s*([^)]*)\)/g)) {
      const arg = m[1].trim();
      if (!arg) noNs = true;
      else {
        const lit = /^['"`]([A-Za-z0-9_.]+)['"`]/.exec(arg);
        if (lit) roots.add(lit[1]);
        else dynamic.push(`${relative(root, file)}: useTranslations(${arg})`);
      }
    }
    if (noNs) {
      // No namespace: the keys are written out in full. A literal key is one path; a template key keeps the literal prefix.
      for (const m of text.matchAll(/\bt(?:\.\w+)?\(\s*(['"`])([A-Za-z0-9_.]+)(\$\{)?/g)) {
        const path = m[3] ? m[2].replace(/\.$/, '') : m[2];
        if (path.includes('.') || m[3]) roots.add(path);
      }
      for (const m of text.matchAll(/\bt(?:\.\w+)?\(\s*([A-Za-z_][\w.]*)\s*[,)]/g)) {
        // ActionForm's FormMessage translates the key a server action returned: the keys are collected below.
        if (file.endsWith('ActionForm.tsx')) roots.add('@actions');
        else dynamic.push(`${relative(root, file)}: t(${m[1]}) with a variable key`);
      }
    }
    if (/useMessages\(/.test(text) && !file.endsWith('MessagesExtension.tsx')) dynamic.push(`${relative(root, file)}: useMessages()`);
  }
  const out = { client, imports, roots, dynamic };
  cache.set(file, out);
  return out;
}

function reach(entries) {
  const seen = new Set();
  const stack = [...entries];
  const roots = new Set();
  const dynamic = [];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const i = info(f);
    i.roots.forEach((r) => roots.add(r));
    dynamic.push(...i.dynamic);
    stack.push(...i.imports);
  }
  return { roots, dynamic };
}

/** True when `path` equals or lies below one of `set`. */
const covered = (set, path) => [...set].some((p) => path === p || path.startsWith(`${p}.`));
/** Drops every path that lies below another path in the list; sorted. */
const minimal = (set) => [...set].filter((p) => ![...set].some((q) => q !== p && p.startsWith(`${q}.`))).sort();

export function analyse() {
  const layout = join(localeDir, 'layout.tsx');
  const base = reach([layout]);
  const areas = {};
  const dynamic = [...base.dynamic];
  for (const name of readdirSync(localeDir)) {
    const p = join(localeDir, name);
    const files = statSync(p).isDirectory() ? walk(p) : name.endsWith('.tsx') ? [p] : [];
    if (name === 'layout.tsx' || !files.length) continue;
    const key = name.endsWith('.tsx') ? name.replace(/\.tsx$/, '') : name;
    const r = reach(files);
    dynamic.push(...r.dynamic);
    areas[key] = minimal(r.roots).filter((x) => !covered(base.roots, x));
  }
  return { base: minimal(base.roots), areas, actions: minimal(actionKeys()), dynamic: [...new Set(dynamic)] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = analyse();
  if (process.argv.includes('--write')) {
    const areas = Object.fromEntries(Object.entries(result.areas).filter(([, v]) => v.length));
    const body =
      `// GENERATED by \`node scripts/client-namespaces.mjs --write\` (checked by tests/unit/client-namespaces.test.ts). Do not edit by hand.\n` +
      `// Message paths the browser needs: BASE_PATHS for every page (header and menus), AREA_PATHS for the route area that uses more.\n` +
      `export const BASE_PATHS: string[] = ${JSON.stringify(result.base, null, 2)};\n\n` +
      `export const AREA_PATHS: Record<string, string[]> = ${JSON.stringify(areas, null, 2)};\n\n` +
      `// What server actions can answer with (state.messageKey); an area that lists "@actions" gets all of these.\n` +
      `export const ACTION_PATHS: string[] = ${JSON.stringify(result.actions, null, 2)};\n`;
    writeFileSync(join(src, 'i18n', 'client-namespaces.ts'), body);
    console.log('wrote src/i18n/client-namespaces.ts', result.dynamic.length ? `\nNOT ANALYSABLE (review by hand):\n${result.dynamic.join('\n')}` : '');
  } else console.log(JSON.stringify(result, null, 1));
}
